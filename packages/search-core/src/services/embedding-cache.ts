import { createLogger } from "@engram/logger";
import { RERANK_CONFIG } from "../config";
import {
	computeHitRate,
	embeddingCacheCount,
	embeddingCacheHitRate,
	embeddingCacheSize,
	recordEmbeddingCacheEviction,
	recordEmbeddingCacheHit,
	recordEmbeddingCacheMiss,
} from "./cache-metrics";

export interface EmbeddingCacheOptions {
	maxSizeBytes?: number; // Default: 1GB (1024 * 1024 * 1024)
	ttlMs?: number; // Default: 1 hour (3600000)
}

export interface CachedEmbedding {
	id: string;
	embeddings: Float32Array[];
	sizeBytes: number;
	createdAt: number;
	lastAccessedAt: number;
}

interface CacheEntry {
	embeddings: Float32Array[];
	sizeBytes: number;
	createdAt: number;
	lastAccessedAt: number;
}

/**
 * In-memory LRU cache for ColBERT document embeddings.
 *
 * Features:
 * - LRU eviction when size limit is reached (O(1) operations)
 * - TTL-based expiration (default: 1 hour)
 * - Size tracking in bytes
 * - Hit rate metrics
 *
 * Implementation uses Map's insertion order for O(1) LRU operations:
 * - On access: delete and re-insert to move to end
 * - On eviction: iterate from start (oldest entries)
 *
 * This cache prevents redundant re-encoding of frequently accessed documents,
 * significantly improving reranking performance for repeated queries.
 */
export class EmbeddingCache {
	private cache: Map<string, CacheEntry> = new Map();
	// Note: We now use Map's insertion order for LRU tracking (O(1) operations)
	// instead of maintaining a separate array (O(n) indexOf/splice)
	private currentSizeBytes = 0;
	private readonly maxSizeBytes: number;
	private readonly ttlMs: number;
	private hits = 0;
	private misses = 0;
	private evictions = 0;
	private logger = createLogger({ component: "EmbeddingCache" });

	constructor(options?: EmbeddingCacheOptions) {
		this.maxSizeBytes = options?.maxSizeBytes ?? RERANK_CONFIG.cache.maxCacheSize;
		this.ttlMs = options?.ttlMs ?? RERANK_CONFIG.cache.documentRepresentationTTL * 1000;

		this.logger.info({
			msg: "EmbeddingCache initialized",
			maxSizeBytes: this.maxSizeBytes,
			ttlMs: this.ttlMs,
		});
	}

	/**
	 * Get cached embedding, returns null if not found or expired.
	 */
	get(documentId: string): Float32Array[] | null {
		const entry = this.cache.get(documentId);

		if (!entry) {
			this.misses++;
			recordEmbeddingCacheMiss();
			this.updateMetrics();
			return null;
		}

		// Check if entry has expired
		const now = Date.now();
		if (now - entry.createdAt > this.ttlMs) {
			// Entry expired, remove it
			this.remove(documentId);
			this.misses++;
			recordEmbeddingCacheMiss();
			this.updateMetrics();
			return null;
		}

		// Update access time and LRU order
		entry.lastAccessedAt = now;
		this.updateAccessOrder(documentId);

		this.hits++;
		recordEmbeddingCacheHit();
		this.updateMetrics();
		return entry.embeddings;
	}

	/**
	 * Store embedding in cache.
	 * Evicts oldest entries if size limit is exceeded.
	 */
	set(documentId: string, embeddings: Float32Array[]): void {
		// Calculate size of embeddings
		const sizeBytes = this.calculateSize(embeddings);

		// Check if already cached (update scenario)
		const existing = this.cache.get(documentId);
		if (existing) {
			// Update existing entry
			this.currentSizeBytes -= existing.sizeBytes;
			this.currentSizeBytes += sizeBytes;

			existing.embeddings = embeddings;
			existing.sizeBytes = sizeBytes;
			existing.lastAccessedAt = Date.now();

			this.updateAccessOrder(documentId);
			return;
		}

		// Evict if necessary to make room (O(1) per eviction using Map iteration)
		while (this.currentSizeBytes + sizeBytes > this.maxSizeBytes && this.cache.size > 0) {
			const oldestId = this.getOldestKey();
			if (oldestId) {
				this.remove(oldestId);
				this.evictions++;
				recordEmbeddingCacheEviction();
			} else {
				break;
			}
		}

		// Add new entry
		const now = Date.now();
		this.cache.set(documentId, {
			embeddings,
			sizeBytes,
			createdAt: now,
			lastAccessedAt: now,
		});

		// No need to track accessOrder separately - Map maintains insertion order
		this.currentSizeBytes += sizeBytes;
		this.updateMetrics();
	}

	/**
	 * Invalidate specific document (on update).
	 */
	invalidate(documentId: string): void {
		this.remove(documentId);
	}

	/**
	 * Clear entire cache.
	 */
	clear(): void {
		this.cache.clear();
		this.currentSizeBytes = 0;
		this.hits = 0;
		this.misses = 0;
		this.evictions = 0;

		this.logger.info({ msg: "Cache cleared" });
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): { size: number; count: number; hitRate: number } {
		const total = this.hits + this.misses;
		const hitRate = total > 0 ? this.hits / total : 0;

		return {
			size: this.currentSizeBytes,
			count: this.cache.size,
			hitRate,
		};
	}

	/**
	 * Get detailed metrics for monitoring.
	 */
	getMetrics() {
		const stats = this.getStats();
		return {
			hits: this.hits,
			misses: this.misses,
			evictions: this.evictions,
			maxSize: this.maxSizeBytes,
			...stats,
		};
	}

	/**
	 * Remove an entry from the cache.
	 * O(1) operation using Map's delete.
	 */
	private remove(documentId: string): void {
		const entry = this.cache.get(documentId);
		if (!entry) return;

		this.cache.delete(documentId);
		this.currentSizeBytes -= entry.sizeBytes;
		// No need to update accessOrder - we use Map's insertion order
	}

	/**
	 * Update LRU access order.
	 * O(1) operation: delete and re-insert to move to end of Map's iteration order.
	 */
	private updateAccessOrder(documentId: string): void {
		const entry = this.cache.get(documentId);
		if (entry) {
			// Delete and re-insert to move to end of Map's insertion order
			this.cache.delete(documentId);
			this.cache.set(documentId, entry);
		}
	}

	/**
	 * Get the oldest entry key (first in Map's iteration order).
	 * O(1) operation using Map.keys().next().
	 */
	private getOldestKey(): string | undefined {
		return this.cache.keys().next().value;
	}

	/**
	 * Calculate size of embeddings in bytes.
	 * Float32Array uses 4 bytes per element.
	 */
	private calculateSize(embeddings: Float32Array[]): number {
		let totalBytes = 0;
		for (const embedding of embeddings) {
			totalBytes += embedding.length * 4; // 4 bytes per float32
		}
		return totalBytes;
	}

	/**
	 * Update Prometheus metrics with current cache state.
	 */
	private updateMetrics(): void {
		embeddingCacheSize.set(this.currentSizeBytes);
		embeddingCacheCount.set(this.cache.size);
		const hitRate = computeHitRate(this.hits, this.misses);
		embeddingCacheHitRate.set(hitRate);
	}
}
