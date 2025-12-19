import { describe, expect, test } from "vitest";
import {
	assertValidConfig,
	DEFAULT_RERANKER_CONFIG,
	validateBusinessLogic,
	validateComprehensive,
	validateConfig,
	validateModelNames,
} from "./index";

describe("validation", () => {
	describe("validateConfig", () => {
		test("should validate default config", () => {
			const result = validateConfig(DEFAULT_RERANKER_CONFIG);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test("should reject config with missing required fields", () => {
			const invalidConfig = {
				enabled: true,
				// Missing defaultTier, timeoutMs, etc.
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		test("should reject config with invalid types", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: "yes", // Should be boolean
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "enabled")).toBe(true);
		});

		test("should reject config with invalid tier", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				defaultTier: "super_fast", // Invalid tier
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "defaultTier")).toBe(true);
		});

		test("should reject config with negative timeoutMs", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				timeoutMs: -100,
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "timeoutMs")).toBe(true);
		});

		test("should reject config with excessive timeoutMs", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				timeoutMs: 60000, // > 30 seconds
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "timeoutMs")).toBe(true);
		});

		test("should reject config with empty model name", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						model: "",
					},
				},
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path.includes("fast.model"))).toBe(true);
		});

		test("should reject config with invalid maxCandidates", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						maxCandidates: 0,
					},
				},
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path.includes("fast.maxCandidates"))).toBe(true);
		});

		test("should reject config with excessive maxCandidates", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						maxCandidates: 2000,
					},
				},
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path.includes("fast.maxCandidates"))).toBe(true);
		});

		test("should reject config with invalid rolloutPercentage", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				abTesting: {
					enabled: true,
					rolloutPercentage: 150, // > 100
				},
			};

			const result = validateConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path.includes("rolloutPercentage"))).toBe(true);
		});

		test("should provide detailed error messages", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				timeoutMs: -100,
			};

			const result = validateConfig(invalidConfig);

			expect(result.errors[0]).toHaveProperty("path");
			expect(result.errors[0]).toHaveProperty("message");
			expect(result.errors[0]).toHaveProperty("code");
		});
	});

	describe("assertValidConfig", () => {
		test("should not throw for valid config", () => {
			expect(() => assertValidConfig(DEFAULT_RERANKER_CONFIG)).not.toThrow();
		});

		test("should throw for invalid config", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: "yes",
			};

			expect(() => assertValidConfig(invalidConfig)).toThrow("Invalid reranker configuration");
		});

		test("should include error details in exception", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: "yes",
			};

			try {
				assertValidConfig(invalidConfig);
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(error.message).toContain("enabled");
			}
		});
	});

	describe("validateModelNames", () => {
		test("should validate default config models", () => {
			const result = validateModelNames(DEFAULT_RERANKER_CONFIG);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test("should warn about unknown local model", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						model: "unknown/custom-model",
					},
				},
			};

			const result = validateModelNames(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "tiers.fast.model")).toBe(true);
			expect(result.errors.some((err) => err.code === "unknown_model")).toBe(true);
		});

		test("should warn about unknown LLM model", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					llm: {
						...DEFAULT_RERANKER_CONFIG.tiers.llm,
						model: "unknown-llm-model",
					},
				},
			};

			const result = validateModelNames(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.path === "tiers.llm.model")).toBe(true);
			expect(result.errors.some((err) => err.code === "unknown_model")).toBe(true);
		});

		test("should validate all known local models", () => {
			const knownModels = [
				"Xenova/ms-marco-MiniLM-L-6-v2",
				"Xenova/bge-reranker-base",
				"jinaai/jina-reranker-v2-base-multilingual",
				"BAAI/bge-reranker-base",
				"BAAI/bge-reranker-large",
			];

			for (const model of knownModels) {
				const config = {
					...DEFAULT_RERANKER_CONFIG,
					tiers: {
						...DEFAULT_RERANKER_CONFIG.tiers,
						fast: {
							...DEFAULT_RERANKER_CONFIG.tiers.fast,
							model,
						},
					},
				};

				const result = validateModelNames(config);
				expect(result.errors.filter((err) => err.path === "tiers.fast.model")).toHaveLength(0);
			}
		});

		test("should validate all known LLM models", () => {
			const knownModels = [
				"grok-4-1-fast-reasoning",
				"grok-beta",
				"grok-vision-beta",
				"grok-2-latest",
			];

			for (const model of knownModels) {
				const config = {
					...DEFAULT_RERANKER_CONFIG,
					tiers: {
						...DEFAULT_RERANKER_CONFIG.tiers,
						llm: {
							...DEFAULT_RERANKER_CONFIG.tiers.llm,
							model,
						},
					},
				};

				const result = validateModelNames(config);
				expect(result.errors.filter((err) => err.path === "tiers.llm.model")).toHaveLength(0);
			}
		});
	});

	describe("validateBusinessLogic", () => {
		test("should validate default config", () => {
			const result = validateBusinessLogic(DEFAULT_RERANKER_CONFIG);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test("should reject config with all tiers disabled when reranking enabled", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: true,
				tiers: {
					fast: { ...DEFAULT_RERANKER_CONFIG.tiers.fast, enabled: false },
					accurate: { ...DEFAULT_RERANKER_CONFIG.tiers.accurate, enabled: false },
					code: { ...DEFAULT_RERANKER_CONFIG.tiers.code, enabled: false },
					llm: { ...DEFAULT_RERANKER_CONFIG.tiers.llm, enabled: false },
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "no_enabled_tiers")).toBe(true);
		});

		test("should accept config with all tiers disabled when reranking disabled", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: false,
				tiers: {
					fast: { ...DEFAULT_RERANKER_CONFIG.tiers.fast, enabled: false },
					accurate: { ...DEFAULT_RERANKER_CONFIG.tiers.accurate, enabled: false },
					code: { ...DEFAULT_RERANKER_CONFIG.tiers.code, enabled: false },
					llm: { ...DEFAULT_RERANKER_CONFIG.tiers.llm, enabled: false },
				},
			};

			const result = validateBusinessLogic(config);

			// No error for no_enabled_tiers when reranking is disabled
			expect(result.errors.some((err) => err.code === "no_enabled_tiers")).toBe(false);
		});

		test("should reject config with disabled default tier", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: true,
				defaultTier: "fast" as const,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: { ...DEFAULT_RERANKER_CONFIG.tiers.fast, enabled: false },
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "default_tier_disabled")).toBe(true);
		});

		test("should reject config with LLM maxCandidates > fast maxCandidates", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					llm: {
						...DEFAULT_RERANKER_CONFIG.tiers.llm,
						maxCandidates: 100,
					},
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						maxCandidates: 50,
					},
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "invalid_candidate_hierarchy")).toBe(true);
		});

		test("should reject A/B testing enabled with 0% rollout", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				abTesting: {
					enabled: true,
					rolloutPercentage: 0,
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "invalid_rollout")).toBe(true);
		});

		test("should accept A/B testing disabled with 0% rollout", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				abTesting: {
					enabled: false,
					rolloutPercentage: 0,
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.errors.some((err) => err.code === "invalid_rollout")).toBe(false);
		});

		test("should reject budget limit less than cost per request", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				rateLimit: {
					...DEFAULT_RERANKER_CONFIG.rateLimit,
					budgetLimit: 3, // 3 cents
					costPerRequest: 5, // 5 cents
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "invalid_budget")).toBe(true);
		});

		test("should accept budget limit equal to cost per request", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				rateLimit: {
					...DEFAULT_RERANKER_CONFIG.rateLimit,
					budgetLimit: 5,
					costPerRequest: 5,
				},
			};

			const result = validateBusinessLogic(config);

			expect(result.errors.some((err) => err.code === "invalid_budget")).toBe(false);
		});
	});

	describe("validateComprehensive", () => {
		test("should validate default config", () => {
			const result = validateComprehensive(DEFAULT_RERANKER_CONFIG);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test("should catch schema validation errors", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: "yes",
			};

			const result = validateComprehensive(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		test("should catch business logic errors", () => {
			const invalidConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: true,
				tiers: {
					fast: { ...DEFAULT_RERANKER_CONFIG.tiers.fast, enabled: false },
					accurate: { ...DEFAULT_RERANKER_CONFIG.tiers.accurate, enabled: false },
					code: { ...DEFAULT_RERANKER_CONFIG.tiers.code, enabled: false },
					llm: { ...DEFAULT_RERANKER_CONFIG.tiers.llm, enabled: false },
				},
			};

			const result = validateComprehensive(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "no_enabled_tiers")).toBe(true);
		});

		test("should catch model name warnings", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				tiers: {
					...DEFAULT_RERANKER_CONFIG.tiers,
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						model: "unknown/model",
					},
				},
			};

			const result = validateComprehensive(config);

			expect(result.valid).toBe(false);
			expect(result.errors.some((err) => err.code === "unknown_model")).toBe(true);
		});

		test("should return all errors from all validators", () => {
			const config = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: true,
				tiers: {
					fast: {
						...DEFAULT_RERANKER_CONFIG.tiers.fast,
						model: "unknown/model",
						enabled: false,
					},
					accurate: { ...DEFAULT_RERANKER_CONFIG.tiers.accurate, enabled: false },
					code: { ...DEFAULT_RERANKER_CONFIG.tiers.code, enabled: false },
					llm: { ...DEFAULT_RERANKER_CONFIG.tiers.llm, enabled: false },
				},
			};

			const result = validateComprehensive(config);

			expect(result.valid).toBe(false);
			// Should have both model name error and no_enabled_tiers error
			expect(result.errors.length).toBeGreaterThanOrEqual(2);
		});
	});
});
