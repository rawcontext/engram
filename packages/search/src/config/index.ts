/**
 * Consolidated configuration for the Engram search-core package.
 *
 * This module provides comprehensive configuration management including:
 * - Type-safe configuration interfaces
 * - Environment variable loading with helpers from @engram/common
 * - Runtime configuration updates with hot reload
 * - Schema validation using Zod
 * - Business logic validation
 *
 * Example usage:
 * ```ts
 * import { searchConfig, rerankerConfig, RuntimeConfig } from '@engram/search/config';
 *
 * // Access static configuration
 * const limit = searchConfig.retrieval.defaultLimit;
 * const tier = rerankerConfig.defaultTier;
 *
 * // Get runtime configuration
 * const config = RuntimeConfig.get();
 *
 * // Update configuration at runtime
 * RuntimeConfig.update({ defaultTier: 'accurate' });
 *
 * // Watch for configuration changes
 * const unwatch = RuntimeConfig.watch((newConfig) => {
 *   console.log('Config updated:', newConfig);
 * });
 * ```
 *
 * @module @engram/search/config
 */

import { envBool, envFloat, envNum, envStr } from "@engram/common";
import type { RerankerTier } from "../models/schema";

// =============================================================================
// Search Configuration
// =============================================================================

/**
 * Core search configuration with score thresholds and limits.
 * Uses environment variables with sensible defaults.
 */
export const searchConfig = {
	/** Minimum score thresholds by search strategy */
	minScore: {
		// Tuned for e5-small (cosine similarity)
		// e5-small scores are usually between 0.7 and 0.9 for relevant items.
		// < 0.75 is often irrelevant noise.
		dense: envFloat("SEARCH_MIN_SCORE_DENSE", 0.75),

		// Sparse (BM25/SPLADE) scores are unbounded but usually normalized or relative.
		// For Qdrant sparse, it depends on payload.
		sparse: envFloat("SEARCH_MIN_SCORE_SPARSE", 0.1),

		// RRF/Hybrid fusion score (0-1 usually)
		hybrid: envFloat("SEARCH_MIN_SCORE_HYBRID", 0.5),
	},

	/** Result limits */
	limits: {
		maxResults: envNum("SEARCH_MAX_RESULTS", 100),
		defaultResults: envNum("SEARCH_DEFAULT_RESULTS", 10),
	},

	/** Retrieval settings */
	retrieval: {
		defaultLimit: envNum("RETRIEVAL_DEFAULT_LIMIT", 10),
		maxLimit: envNum("RETRIEVAL_MAX_LIMIT", 100),
		scoreThreshold: envFloat("RETRIEVAL_SCORE_THRESHOLD", 0.7),
	},

	/** Cache settings */
	cache: {
		enabled: envBool("SEARCH_CACHE_ENABLED", true),
		ttlSeconds: envNum("SEARCH_CACHE_TTL", 300),
	},
} as const;

export type SearchConfig = typeof searchConfig;
export type SearchMinScoreConfig = typeof searchConfig.minScore;
export type SearchLimitsConfig = typeof searchConfig.limits;
export type RetrievalConfig = typeof searchConfig.retrieval;
export type SearchCacheConfig = typeof searchConfig.cache;

// Backward compatibility exports
export const DEFAULT_SEARCH_CONFIG = searchConfig;

// =============================================================================
// Reranker Configuration Types
// =============================================================================

/**
 * Tier-specific configuration for a reranker model.
 */
export interface TierConfig {
	/** Model identifier (Hugging Face model ID or API model name) */
	model: string;
	/** Maximum latency in milliseconds for this tier */
	maxLatencyMs: number;
	/** Batch size for processing (local models only) */
	batchSize: number;
	/** Maximum number of candidates to rerank in this tier */
	maxCandidates: number;
	/** Whether this tier is enabled */
	enabled: boolean;
}

/**
 * Query routing heuristics configuration.
 */
export interface RoutingConfig {
	/** Regex patterns that indicate code queries */
	codePatterns: RegExp[];
	/** Character count threshold for "complex" queries */
	complexThreshold: number;
	/** Regex patterns that indicate agentic/tool queries */
	agenticPatterns: RegExp[];
	/** Weight for code pattern matching (0-1) */
	codePatternWeight: number;
	/** Default latency budget in milliseconds */
	latencyBudgetDefault: number;
}

/**
 * Caching configuration for reranker system.
 */
export interface RerankerCacheConfig {
	/** TTL for query result cache in seconds */
	queryResultTTL: number;
	/** TTL for document representation cache in seconds */
	documentRepresentationTTL: number;
	/** Maximum cache size in bytes */
	maxCacheSize: number;
	/** Maximum size of embedding cache (number of entries) */
	embeddingCacheMaxSize: number;
	/** Embedding cache TTL in milliseconds */
	embeddingCacheTTLMs: number;
	/** Query cache TTL in milliseconds */
	queryCacheTTLMs: number;
	/** Enable query result caching */
	queryCacheEnabled: boolean;
}

/**
 * Rate limiting configuration for LLM tier.
 */
export interface RateLimitConfig {
	/** Maximum requests per hour per user */
	requestsPerHour: number;
	/** Budget limit in cents */
	budgetLimit: number;
	/** Cost per request in cents */
	costPerRequest: number;
}

/**
 * A/B testing configuration for gradual rollout.
 */
export interface ABTestingConfig {
	/** Enable A/B testing */
	enabled: boolean;
	/** Percentage of users with reranking enabled (0-100) */
	rolloutPercentage: number;
}

/**
 * Complete configuration for the reranking system.
 */
export interface RerankerConfig {
	// Global settings
	/** Enable/disable reranking globally */
	enabled: boolean;
	/** Default tier to use if auto-routing is disabled */
	defaultTier: RerankerTier;
	/** Default depth for reranking - how many candidates to fetch */
	depth: number;
	/** Timeout for reranking operations in milliseconds */
	timeoutMs: number;

	// Tier-specific settings
	tiers: Record<RerankerTier, TierConfig>;

	// Routing settings
	routing: RoutingConfig;

	// Caching settings
	cache: RerankerCacheConfig;

	// Rate limiting (primarily for LLM tier)
	rateLimit: RateLimitConfig;

	// A/B testing
	abTesting: ABTestingConfig;
}

// =============================================================================
// Reranker Configuration Values
// =============================================================================

/**
 * Default tier configuration values.
 */
export const DEFAULT_TIER_CONFIGS: Record<RerankerTier, TierConfig> = {
	fast: {
		model: envStr("RERANKER_FAST_MODEL", "Xenova/ms-marco-MiniLM-L-6-v2"),
		maxLatencyMs: 50,
		batchSize: envNum("RERANKER_FAST_BATCH_SIZE", 16),
		maxCandidates: envNum("RERANKER_FAST_MAX_CANDIDATES", 50),
		enabled: envBool("RERANKER_FAST_ENABLED", true),
	},
	accurate: {
		model: envStr("RERANKER_ACCURATE_MODEL", "Xenova/bge-reranker-base"),
		maxLatencyMs: 150,
		batchSize: envNum("RERANKER_ACCURATE_BATCH_SIZE", 8),
		maxCandidates: envNum("RERANKER_ACCURATE_MAX_CANDIDATES", 30),
		enabled: envBool("RERANKER_ACCURATE_ENABLED", true),
	},
	code: {
		model: envStr("RERANKER_CODE_MODEL", "jinaai/jina-reranker-v2-base-multilingual"),
		maxLatencyMs: 150,
		batchSize: envNum("RERANKER_CODE_BATCH_SIZE", 8),
		maxCandidates: envNum("RERANKER_CODE_MAX_CANDIDATES", 30),
		enabled: envBool("RERANKER_CODE_ENABLED", true),
	},
	llm: {
		model: envStr("RERANKER_LLM_MODEL", "grok-4-1-fast-reasoning"),
		maxLatencyMs: 2000,
		batchSize: 1, // Always 1 for LLM
		maxCandidates: envNum("RERANKER_LLM_MAX_CANDIDATES", 10),
		enabled: envBool("RERANKER_LLM_ENABLED", true),
	},
};

/**
 * Default routing configuration.
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
	codePatterns: [
		/\w+\.\w+\(/, // method calls: foo.bar()
		/function\s+\w+/, // function declarations
		/class\s+\w+/, // class declarations
		/import\s+/, // import statements
		/export\s+/, // export statements
		/const\s+\w+\s*=/, // variable declarations
		/interface\s+\w+/, // interface declarations
		/type\s+\w+/, // type declarations
	],
	complexThreshold: envNum("RERANKER_COMPLEXITY_THRESHOLD", 50),
	agenticPatterns: [/tool|function|call|execute|invoke|run/i],
	codePatternWeight: envFloat("RERANKER_CODE_PATTERN_WEIGHT", 0.8),
	latencyBudgetDefault: envNum("RERANKER_LATENCY_BUDGET", 500),
};

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: RerankerCacheConfig = {
	queryResultTTL: envNum("RERANKER_QUERY_CACHE_TTL", 300), // 5 minutes
	documentRepresentationTTL: envNum("RERANKER_DOC_CACHE_TTL", 3600), // 1 hour
	maxCacheSize: envNum("RERANKER_MAX_CACHE_SIZE", 1024 * 1024 * 1024), // 1GB
	embeddingCacheMaxSize: envNum("RERANKER_EMBEDDING_CACHE_MAX_SIZE", 10000),
	embeddingCacheTTLMs: envNum("RERANKER_EMBEDDING_CACHE_TTL_MS", 3600000), // 1 hour
	queryCacheTTLMs: envNum("RERANKER_QUERY_CACHE_TTL_MS", 300000), // 5 minutes
	queryCacheEnabled: envBool("RERANKER_CACHE_ENABLED", true),
};

/**
 * Default rate limit configuration.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
	requestsPerHour: envNum("RERANKER_RATE_LIMIT_REQUESTS_PER_HOUR", 100),
	budgetLimit: envNum("RERANKER_RATE_LIMIT_BUDGET", 1000), // $10
	costPerRequest: envNum("RERANKER_RATE_LIMIT_COST_PER_REQUEST", 5), // 5 cents
};

/**
 * Default A/B testing configuration.
 */
export const DEFAULT_AB_TESTING_CONFIG: ABTestingConfig = {
	enabled: envBool("RERANKER_AB_ENABLED", false),
	rolloutPercentage: envNum("RERANKER_AB_ROLLOUT", 100),
};

/**
 * Complete reranker configuration with environment variable overrides.
 */
export const rerankerConfig: RerankerConfig = {
	enabled: envBool("RERANKER_ENABLED", true),
	defaultTier: envStr("RERANKER_DEFAULT_TIER", "fast") as RerankerTier,
	depth: envNum("RERANKER_DEPTH", 30),
	timeoutMs: envNum("RERANKER_TIMEOUT_MS", 500),
	tiers: DEFAULT_TIER_CONFIGS,
	routing: DEFAULT_ROUTING_CONFIG,
	cache: DEFAULT_CACHE_CONFIG,
	rateLimit: DEFAULT_RATE_LIMIT_CONFIG,
	abTesting: DEFAULT_AB_TESTING_CONFIG,
};

// Backward compatibility: RERANK_CONFIG alias
export const RERANK_CONFIG = rerankerConfig;
export const DEFAULT_RERANKER_CONFIG = rerankerConfig;

// =============================================================================
// Runtime Configuration Management
// =============================================================================

export { RuntimeConfig } from "./runtime-config";

// =============================================================================
// Validation Utilities
// =============================================================================

export type { ValidationError, ValidationResult } from "./validation";
export {
	assertValidConfig,
	validateBusinessLogic,
	validateComprehensive,
	validateConfig,
	validateModelNames,
} from "./validation";

// =============================================================================
// Re-export types for backward compatibility
// =============================================================================

// Re-export CacheConfig type alias for backward compatibility
export type CacheConfig = RerankerCacheConfig;
