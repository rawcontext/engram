import { z } from "zod";
import type { RerankerTier } from "../models/schema";
import type { RerankerConfig } from "./index";

/**
 * Zod schema for TierConfig validation.
 * Uses passthrough to allow additional fields like maxLatencyMs.
 */
const TierConfigSchema = z
	.object({
		model: z.string().min(1, "Model name cannot be empty"),
		maxCandidates: z
			.number()
			.int()
			.positive("maxCandidates must be positive")
			.max(1000, "maxCandidates cannot exceed 1000"),
		batchSize: z
			.number()
			.int()
			.positive("batchSize must be positive")
			.max(128, "batchSize cannot exceed 128"),
		enabled: z.boolean(),
	})
	.passthrough();

/**
 * Zod schema for RoutingConfig validation.
 */
const RoutingConfigSchema = z.object({
	complexThreshold: z
		.number()
		.int()
		.min(0, "complexThreshold must be non-negative")
		.max(1000, "complexThreshold cannot exceed 1000"),
	codePatternWeight: z
		.number()
		.min(0, "codePatternWeight must be at least 0")
		.max(1, "codePatternWeight cannot exceed 1"),
	latencyBudgetDefault: z
		.number()
		.int()
		.positive("latencyBudgetDefault must be positive")
		.max(10000, "latencyBudgetDefault cannot exceed 10000ms"),
	codePatterns: z.array(z.instanceof(RegExp)),
	agenticPatterns: z.array(z.instanceof(RegExp)),
});

/**
 * Zod schema for CacheConfig validation.
 * Uses passthrough to allow additional cache-related fields.
 */
const CacheConfigSchema = z
	.object({
		embeddingCacheMaxSize: z
			.number()
			.int()
			.positive("embeddingCacheMaxSize must be positive")
			.max(1000000, "embeddingCacheMaxSize cannot exceed 1,000,000"),
		embeddingCacheTTLMs: z
			.number()
			.int()
			.positive("embeddingCacheTTLMs must be positive")
			.max(86400000, "embeddingCacheTTLMs cannot exceed 24 hours"),
		queryCacheTTLMs: z
			.number()
			.int()
			.positive("queryCacheTTLMs must be positive")
			.max(3600000, "queryCacheTTLMs cannot exceed 1 hour"),
		queryCacheEnabled: z.boolean(),
	})
	.passthrough();

/**
 * Zod schema for RateLimitConfig validation.
 */
const RateLimitConfigSchema = z.object({
	requestsPerHour: z
		.number()
		.int()
		.positive("requestsPerHour must be positive")
		.max(10000, "requestsPerHour cannot exceed 10,000"),
	budgetLimit: z
		.number()
		.int()
		.positive("budgetLimit must be positive")
		.max(1000000, "budgetLimit cannot exceed $10,000"),
	costPerRequest: z
		.number()
		.positive("costPerRequest must be positive")
		.max(1000, "costPerRequest cannot exceed $10"),
});

/**
 * Zod schema for ABTestingConfig validation.
 */
const ABTestingConfigSchema = z.object({
	enabled: z.boolean(),
	rolloutPercentage: z
		.number()
		.int()
		.min(0, "rolloutPercentage must be at least 0")
		.max(100, "rolloutPercentage cannot exceed 100"),
});

/**
 * Complete Zod schema for RerankerConfig validation.
 * Uses passthrough to allow additional fields like depth.
 */
const RerankerConfigSchema = z
	.object({
		enabled: z.boolean(),
		defaultTier: z.enum(["fast", "accurate", "code", "llm"]),
		timeoutMs: z
			.number()
			.int()
			.positive("timeoutMs must be positive")
			.max(30000, "timeoutMs cannot exceed 30 seconds"),
		tiers: z.object({
			fast: TierConfigSchema,
			accurate: TierConfigSchema,
			code: TierConfigSchema,
			llm: TierConfigSchema,
		}),
		routing: RoutingConfigSchema,
		cache: CacheConfigSchema,
		rateLimit: RateLimitConfigSchema,
		abTesting: ABTestingConfigSchema,
	})
	.passthrough();

/**
 * Validation error details.
 */
export interface ValidationError {
	path: string;
	message: string;
	code: string;
}

/**
 * Validation result.
 */
export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

/**
 * Validate a reranker configuration object.
 *
 * @param config - Configuration to validate
 * @returns Validation result with errors if invalid
 */
export function validateConfig(config: unknown): ValidationResult {
	const result = RerankerConfigSchema.safeParse(config);

	if (result.success) {
		return { valid: true, errors: [] };
	}

	// Handle Zod v4 error structure (uses 'issues' not 'errors')
	const issues = result.error?.issues ?? [];

	const errors: ValidationError[] = issues.map((issue) => ({
		path: issue.path.join("."),
		message: issue.message,
		code: issue.code,
	}));

	return { valid: false, errors };
}

/**
 * Validate and assert a reranker configuration.
 * Throws an error if validation fails.
 *
 * @param config - Configuration to validate
 * @throws {Error} If validation fails
 */
export function assertValidConfig(config: unknown): asserts config is RerankerConfig {
	const result = validateConfig(config);

	if (!result.valid) {
		const errorMessages = result.errors.map((err) => `  - ${err.path}: ${err.message}`).join("\n");

		throw new Error(`Invalid reranker configuration:\n${errorMessages}`);
	}
}

/**
 * Known valid model names for local rerankers (Transformers.js).
 */
const KNOWN_LOCAL_MODELS = [
	"Xenova/ms-marco-MiniLM-L-6-v2",
	"Xenova/bge-reranker-base",
	"jinaai/jina-reranker-v2-base-multilingual",
	"BAAI/bge-reranker-base",
	"BAAI/bge-reranker-large",
];

/**
 * Known valid LLM model names (xAI API).
 */
const KNOWN_LLM_MODELS = [
	"grok-4-1-fast-reasoning",
	"grok-beta",
	"grok-vision-beta",
	"grok-2-latest",
];

/**
 * Validate that model names are recognized.
 *
 * @param config - Reranker configuration
 * @returns Validation result with warnings for unknown models
 */
export function validateModelNames(config: RerankerConfig): ValidationResult {
	const errors: ValidationError[] = [];

	// Check local models
	const localTiers: Array<RerankerTier> = ["fast", "accurate", "code"];
	for (const tier of localTiers) {
		const model = config.tiers[tier].model;
		if (!KNOWN_LOCAL_MODELS.includes(model)) {
			errors.push({
				path: `tiers.${tier}.model`,
				message: `Unknown local model: ${model}. Known models: ${KNOWN_LOCAL_MODELS.join(", ")}`,
				code: "unknown_model",
			});
		}
	}

	// Check LLM model
	const llmModel = config.tiers.llm.model;
	if (!KNOWN_LLM_MODELS.includes(llmModel)) {
		errors.push({
			path: "tiers.llm.model",
			message: `Unknown LLM model: ${llmModel}. Known models: ${KNOWN_LLM_MODELS.join(", ")}`,
			code: "unknown_model",
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validate business logic constraints.
 *
 * @param config - Reranker configuration
 * @returns Validation result with errors if constraints violated
 */
export function validateBusinessLogic(config: RerankerConfig): ValidationResult {
	const errors: ValidationError[] = [];

	// Ensure at least one tier is enabled
	const enabledTiers = Object.values(config.tiers).filter((tier) => tier.enabled);
	if (enabledTiers.length === 0 && config.enabled) {
		errors.push({
			path: "tiers",
			message: "At least one reranker tier must be enabled when reranking is enabled",
			code: "no_enabled_tiers",
		});
	}

	// Ensure default tier is enabled
	const defaultTierConfig = config.tiers[config.defaultTier];
	if (!defaultTierConfig.enabled && config.enabled) {
		errors.push({
			path: "defaultTier",
			message: `Default tier '${config.defaultTier}' must be enabled`,
			code: "default_tier_disabled",
		});
	}

	// Validate maxCandidates hierarchy (llm < others)
	if (config.tiers.llm.maxCandidates > config.tiers.fast.maxCandidates) {
		errors.push({
			path: "tiers.llm.maxCandidates",
			message: "LLM tier maxCandidates should be less than or equal to fast tier",
			code: "invalid_candidate_hierarchy",
		});
	}

	// Validate A/B testing rollout when enabled
	if (config.abTesting.enabled && config.abTesting.rolloutPercentage === 0) {
		errors.push({
			path: "abTesting.rolloutPercentage",
			message: "A/B testing rollout percentage must be greater than 0 when enabled",
			code: "invalid_rollout",
		});
	}

	// Validate rate limiting is reasonable
	if (config.rateLimit.budgetLimit < config.rateLimit.costPerRequest) {
		errors.push({
			path: "rateLimit.budgetLimit",
			message:
				"Budget limit must be at least equal to cost per request (allows at least 1 request)",
			code: "invalid_budget",
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Perform comprehensive validation of reranker configuration.
 * Includes schema validation, model name validation, and business logic validation.
 *
 * @param config - Configuration to validate
 * @returns Comprehensive validation result
 */
export function validateComprehensive(config: unknown): ValidationResult {
	// First, validate schema
	const schemaResult = validateConfig(config);
	if (!schemaResult.valid) {
		return schemaResult;
	}

	// Type assertion is safe here due to schema validation
	const validConfig = config as RerankerConfig;

	// Validate model names (warnings only)
	const modelResult = validateModelNames(validConfig);

	// Validate business logic
	const businessResult = validateBusinessLogic(validConfig);

	// Combine all errors
	const allErrors = [...modelResult.errors, ...businessResult.errors];

	return { valid: allErrors.length === 0, errors: allErrors };
}
