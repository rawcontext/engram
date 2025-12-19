import { createHash } from "node:crypto";
import { createLogger } from "@engram/logger";
import { RERANK_CONFIG } from "../config";
import type { BatchedRerankResult } from "./batched-reranker";
import {
	computeHitRate,
	queryCacheHitRate,
	recordQueryCacheError,
	recordQueryCacheHit,
	recordQueryCacheMiss,
} from "./cache-metrics";

export interface QueryCacheOptions {
	redisUrl?: string; // Default: REDIS_URL env var
	ttlSeconds?: number; // Default: 300 (5 minutes)
	keyPrefix?: string; // Default: "rerank:"
}

export interface CacheKey {
	query: string;
	filters?: Record<string, unknown>;
	rerankTier?: string;
	limit?: number;
}

/**
 * Redis-backed cache for reranked query results.
 *
 * Features:
 * - Redis persistence for distributed caching
 * - Graceful degradation when Redis unavailable
 * - TTL-based expiration (default: 5 minutes)
 * - Cache key hashing for consistent lookups
 *
 * Target: 30%+ hit rate for repeated queries
 */
export class QueryCache {
	private redis: any = null;
	private readonly ttlSeconds: number;
	private readonly keyPrefix: string;
	private readonly redisUrl?: string;
	private logger = createLogger({ component: "QueryCache" });
	private initializationAttempted = false;
	private initializationFailed = false;
	private hits = 0;
	private misses = 0;

	constructor(options?: QueryCacheOptions) {
		this.redisUrl = options?.redisUrl ?? process.env.REDIS_URL;
		this.ttlSeconds = options?.ttlSeconds ?? RERANK_CONFIG.cache.queryResultTTL;
		this.keyPrefix = options?.keyPrefix ?? "rerank:";

		// Lazy initialization - only connect when first used
		this.logger.info({
			msg: "QueryCache initialized (lazy mode)",
			ttlSeconds: this.ttlSeconds,
			keyPrefix: this.keyPrefix,
			redisConfigured: !!this.redisUrl,
		});
	}

	/**
	 * Initialize Redis connection (lazy).
	 * Returns true if successful, false if Redis unavailable.
	 */
	private async initialize(): Promise<boolean> {
		if (this.initializationAttempted) {
			return !this.initializationFailed;
		}

		this.initializationAttempted = true;

		if (!this.redisUrl) {
			this.logger.warn({
				msg: "Redis URL not configured, query cache disabled",
				hint: "Set REDIS_URL environment variable to enable query caching",
			});
			this.initializationFailed = true;
			return false;
		}

		try {
			// Dynamic import of ioredis
			const { default: Redis } = await import("ioredis");

			this.redis = new Redis(this.redisUrl, {
				// Graceful error handling
				lazyConnect: true,
				retryStrategy: (times: number) => {
					// Give up after 3 retries
					if (times > 3) {
						return null;
					}
					return Math.min(times * 100, 1000);
				},
				maxRetriesPerRequest: 3,
			});

			// Connect and handle errors
			await this.redis.connect();

			this.redis.on("error", (error: Error) => {
				this.logger.warn({
					msg: "Redis connection error, cache degraded",
					error: error.message,
				});
			});

			this.logger.info({ msg: "Redis connected successfully" });
			return true;
		} catch (error) {
			this.logger.warn({
				msg: "Failed to initialize Redis, query cache disabled",
				error: error instanceof Error ? error.message : String(error),
			});
			this.initializationFailed = true;
			this.redis = null;
			return false;
		}
	}

	/**
	 * Generate cache key from query params.
	 * Uses SHA256 hash for consistent, compact keys.
	 */
	private generateKey(params: CacheKey): string {
		// Normalize params for consistent hashing
		const normalized = {
			query: params.query.trim().toLowerCase(),
			filters: params.filters ?? {},
			rerankTier: params.rerankTier ?? "default",
			limit: params.limit ?? 10,
		};

		// Create deterministic JSON string
		const data = JSON.stringify(normalized, Object.keys(normalized).sort());

		// Hash for compact key
		const hash = createHash("sha256").update(data).digest("hex");

		return `${this.keyPrefix}${hash}`;
	}

	/**
	 * Get cached results.
	 * Returns null if not found or Redis unavailable.
	 */
	async get(params: CacheKey): Promise<BatchedRerankResult[] | null> {
		// Initialize Redis if not already done
		if (!this.redis) {
			const initialized = await this.initialize();
			if (!initialized) {
				this.misses++;
				recordQueryCacheMiss();
				this.updateMetrics();
				return null; // Graceful degradation
			}
		}

		try {
			const key = this.generateKey(params);
			const cached = await this.redis.get(key);

			if (!cached) {
				this.misses++;
				recordQueryCacheMiss();
				this.updateMetrics();
				return null;
			}

			// Parse cached JSON
			const results = JSON.parse(cached) as BatchedRerankResult[];

			this.logger.debug({
				msg: "Cache hit",
				key,
				resultCount: results.length,
			});

			this.hits++;
			recordQueryCacheHit();
			this.updateMetrics();

			return results;
		} catch (error) {
			// Graceful degradation on error
			this.logger.warn({
				msg: "Cache get failed, degrading gracefully",
				error: error instanceof Error ? error.message : String(error),
			});
			recordQueryCacheError();
			this.misses++;
			recordQueryCacheMiss();
			this.updateMetrics();
			return null;
		}
	}

	/**
	 * Cache results.
	 * Silently fails if Redis unavailable.
	 */
	async set(params: CacheKey, results: BatchedRerankResult[]): Promise<void> {
		// Initialize Redis if not already done
		if (!this.redis) {
			const initialized = await this.initialize();
			if (!initialized) {
				return; // Graceful degradation
			}
		}

		try {
			const key = this.generateKey(params);
			const serialized = JSON.stringify(results);

			await this.redis.setex(key, this.ttlSeconds, serialized);

			this.logger.debug({
				msg: "Cached results",
				key,
				resultCount: results.length,
				ttlSeconds: this.ttlSeconds,
			});
		} catch (error) {
			// Graceful degradation on error
			this.logger.warn({
				msg: "Cache set failed, continuing without caching",
				error: error instanceof Error ? error.message : String(error),
			});
			recordQueryCacheError();
		}
	}

	/**
	 * Invalidate by pattern (e.g., all queries for a document).
	 * Pattern uses Redis SCAN for safe iteration.
	 */
	async invalidatePattern(pattern: string): Promise<void> {
		// Initialize Redis if not already done
		if (!this.redis) {
			const initialized = await this.initialize();
			if (!initialized) {
				return; // Graceful degradation
			}
		}

		try {
			const fullPattern = `${this.keyPrefix}${pattern}`;
			let cursor = "0";
			let keysDeleted = 0;

			do {
				// SCAN for keys matching pattern
				const [nextCursor, keys] = await this.redis.scan(
					cursor,
					"MATCH",
					fullPattern,
					"COUNT",
					100,
				);
				cursor = nextCursor;

				if (keys.length > 0) {
					await this.redis.del(...keys);
					keysDeleted += keys.length;
				}
			} while (cursor !== "0");

			this.logger.info({
				msg: "Invalidated cache pattern",
				pattern: fullPattern,
				keysDeleted,
			});
		} catch (error) {
			// Graceful degradation on error
			this.logger.warn({
				msg: "Cache invalidation failed",
				pattern,
				error: error instanceof Error ? error.message : String(error),
			});
			recordQueryCacheError();
		}
	}

	/**
	 * Clear all cache entries with this prefix.
	 */
	async clear(): Promise<void> {
		await this.invalidatePattern("*");
	}

	/**
	 * Disconnect from Redis.
	 * Call on application shutdown.
	 */
	async disconnect(): Promise<void> {
		if (this.redis) {
			try {
				await this.redis.quit();
				this.logger.info({ msg: "Redis connection closed" });
			} catch (error) {
				this.logger.warn({
					msg: "Error disconnecting from Redis",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	/**
	 * Check if Redis is available.
	 */
	isAvailable(): boolean {
		return this.redis !== null && !this.initializationFailed;
	}

	/**
	 * Update Prometheus metrics with current cache stats.
	 */
	private updateMetrics(): void {
		const hitRate = computeHitRate(this.hits, this.misses);
		queryCacheHitRate.set(hitRate);
	}
}
