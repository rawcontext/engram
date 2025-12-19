import { Counter, Gauge } from "prom-client";

/**
 * Prometheus metrics for caching observability.
 *
 * These metrics enable monitoring of:
 * - Cache hit/miss rates
 * - Cache eviction frequency
 * - Cache size and utilization
 * - Cache performance by type (embedding vs query)
 */

// =============================================================================
// Embedding Cache Metrics
// =============================================================================

/**
 * Embedding cache hits counter
 * Tracks successful cache lookups for document embeddings
 */
export const embeddingCacheHits = new Counter({
	name: "engram_embedding_cache_hits_total",
	help: "Total embedding cache hits",
});

/**
 * Embedding cache misses counter
 * Tracks failed cache lookups for document embeddings
 */
export const embeddingCacheMisses = new Counter({
	name: "engram_embedding_cache_misses_total",
	help: "Total embedding cache misses",
});

/**
 * Embedding cache evictions counter
 * Tracks LRU evictions when cache size limit is reached
 */
export const embeddingCacheEvictions = new Counter({
	name: "engram_embedding_cache_evictions_total",
	help: "Total embedding cache evictions",
});

/**
 * Embedding cache size gauge
 * Tracks current cache size in bytes
 */
export const embeddingCacheSize = new Gauge({
	name: "engram_embedding_cache_size_bytes",
	help: "Current embedding cache size in bytes",
});

/**
 * Embedding cache entry count gauge
 * Tracks number of cached embeddings
 */
export const embeddingCacheCount = new Gauge({
	name: "engram_embedding_cache_entries_count",
	help: "Current number of cached embeddings",
});

/**
 * Embedding cache hit rate gauge
 * Computed metric showing cache effectiveness (0-1)
 */
export const embeddingCacheHitRate = new Gauge({
	name: "engram_embedding_cache_hit_rate",
	help: "Embedding cache hit rate (hits / total requests)",
});

// =============================================================================
// Query Cache Metrics
// =============================================================================

/**
 * Query cache hits counter
 * Tracks successful cache lookups for reranked query results
 */
export const queryCacheHits = new Counter({
	name: "engram_query_cache_hits_total",
	help: "Total query cache hits",
});

/**
 * Query cache misses counter
 * Tracks failed cache lookups for reranked query results
 */
export const queryCacheMisses = new Counter({
	name: "engram_query_cache_misses_total",
	help: "Total query cache misses",
});

/**
 * Query cache hit rate gauge
 * Computed metric showing cache effectiveness (0-1)
 * Target: 30%+ hit rate
 */
export const queryCacheHitRate = new Gauge({
	name: "engram_query_cache_hit_rate",
	help: "Query cache hit rate (hits / total requests)",
});

/**
 * Query cache errors counter
 * Tracks Redis connection/operation errors
 * Used to monitor graceful degradation
 */
export const queryCacheErrors = new Counter({
	name: "engram_query_cache_errors_total",
	help: "Total query cache errors (Redis failures)",
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute hit rate from hits and misses.
 * Returns 0 if no requests have been made.
 */
export function computeHitRate(hits: number, misses: number): number {
	const total = hits + misses;
	return total > 0 ? hits / total : 0;
}

/**
 * Update embedding cache metrics from cache stats.
 * Should be called periodically or after cache operations.
 */
export function updateEmbeddingCacheMetrics(stats: {
	hits: number;
	misses: number;
	evictions: number;
	size: number;
	count: number;
}): void {
	// Set gauges
	embeddingCacheSize.set(stats.size);
	embeddingCacheCount.set(stats.count);

	// Compute and set hit rate
	const hitRate = computeHitRate(stats.hits, stats.misses);
	embeddingCacheHitRate.set(hitRate);

	// Note: Counters (hits, misses, evictions) are incremented
	// directly in EmbeddingCache, not here
}

/**
 * Update query cache metrics from cache stats.
 * Should be called periodically or after cache operations.
 */
export function updateQueryCacheMetrics(stats: { hits: number; misses: number }): void {
	// Compute and set hit rate
	const hitRate = computeHitRate(stats.hits, stats.misses);
	queryCacheHitRate.set(hitRate);

	// Note: Counters (hits, misses, errors) are incremented
	// directly in QueryCache, not here
}

/**
 * Record embedding cache hit.
 * Call this from EmbeddingCache.get() on successful lookup.
 */
export function recordEmbeddingCacheHit(): void {
	embeddingCacheHits.inc();
}

/**
 * Record embedding cache miss.
 * Call this from EmbeddingCache.get() on failed lookup.
 */
export function recordEmbeddingCacheMiss(): void {
	embeddingCacheMisses.inc();
}

/**
 * Record embedding cache eviction.
 * Call this from EmbeddingCache when LRU eviction occurs.
 */
export function recordEmbeddingCacheEviction(): void {
	embeddingCacheEvictions.inc();
}

/**
 * Record query cache hit.
 * Call this from QueryCache.get() on successful lookup.
 */
export function recordQueryCacheHit(): void {
	queryCacheHits.inc();
}

/**
 * Record query cache miss.
 * Call this from QueryCache.get() on failed lookup.
 */
export function recordQueryCacheMiss(): void {
	queryCacheMisses.inc();
}

/**
 * Record query cache error.
 * Call this from QueryCache when Redis operations fail.
 */
export function recordQueryCacheError(): void {
	queryCacheErrors.inc();
}
