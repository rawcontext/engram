import { describe, expect, test } from "vitest";
import {
	DEFAULT_AB_TESTING_CONFIG,
	DEFAULT_CACHE_CONFIG,
	DEFAULT_RATE_LIMIT_CONFIG,
	DEFAULT_RERANKER_CONFIG,
	DEFAULT_ROUTING_CONFIG,
	DEFAULT_TIER_CONFIGS,
} from "./index";

describe("reranker-config", () => {
	describe("DEFAULT_TIER_CONFIGS", () => {
		test("should have all required tiers", () => {
			expect(DEFAULT_TIER_CONFIGS).toHaveProperty("fast");
			expect(DEFAULT_TIER_CONFIGS).toHaveProperty("accurate");
			expect(DEFAULT_TIER_CONFIGS).toHaveProperty("code");
			expect(DEFAULT_TIER_CONFIGS).toHaveProperty("llm");
		});

		test("should have valid fast tier config", () => {
			const fast = DEFAULT_TIER_CONFIGS.fast;
			expect(fast.model).toBe("Xenova/ms-marco-MiniLM-L-6-v2");
			expect(fast.maxCandidates).toBe(50);
			expect(fast.batchSize).toBe(16);
			expect(fast.enabled).toBe(true);
		});

		test("should have valid accurate tier config", () => {
			const accurate = DEFAULT_TIER_CONFIGS.accurate;
			expect(accurate.model).toBe("Xenova/bge-reranker-base");
			expect(accurate.maxCandidates).toBe(30);
			expect(accurate.batchSize).toBe(8);
			expect(accurate.enabled).toBe(true);
		});

		test("should have valid code tier config", () => {
			const code = DEFAULT_TIER_CONFIGS.code;
			expect(code.model).toBe("jinaai/jina-reranker-v2-base-multilingual");
			expect(code.maxCandidates).toBe(30);
			expect(code.batchSize).toBe(8);
			expect(code.enabled).toBe(true);
		});

		test("should have valid llm tier config", () => {
			const llm = DEFAULT_TIER_CONFIGS.llm;
			expect(llm.model).toBe("grok-4-1-fast-reasoning");
			expect(llm.maxCandidates).toBe(10);
			expect(llm.batchSize).toBe(1);
			expect(llm.enabled).toBe(true);
		});

		test("should have LLM maxCandidates less than other tiers", () => {
			expect(DEFAULT_TIER_CONFIGS.llm.maxCandidates).toBeLessThan(
				DEFAULT_TIER_CONFIGS.fast.maxCandidates,
			);
			expect(DEFAULT_TIER_CONFIGS.llm.maxCandidates).toBeLessThanOrEqual(
				DEFAULT_TIER_CONFIGS.accurate.maxCandidates,
			);
			expect(DEFAULT_TIER_CONFIGS.llm.maxCandidates).toBeLessThanOrEqual(
				DEFAULT_TIER_CONFIGS.code.maxCandidates,
			);
		});
	});

	describe("DEFAULT_ROUTING_CONFIG", () => {
		test("should have valid routing thresholds", () => {
			expect(DEFAULT_ROUTING_CONFIG.complexThreshold).toBe(50);
			expect(DEFAULT_ROUTING_CONFIG.codePatternWeight).toBe(0.8);
			expect(DEFAULT_ROUTING_CONFIG.latencyBudgetDefault).toBe(500);
		});

		test("should have code patterns", () => {
			expect(DEFAULT_ROUTING_CONFIG.codePatterns).toBeInstanceOf(Array);
			expect(DEFAULT_ROUTING_CONFIG.codePatterns.length).toBeGreaterThan(0);
			expect(DEFAULT_ROUTING_CONFIG.codePatterns[0]).toBeInstanceOf(RegExp);
		});

		test("should have agentic patterns", () => {
			expect(DEFAULT_ROUTING_CONFIG.agenticPatterns).toBeInstanceOf(Array);
			expect(DEFAULT_ROUTING_CONFIG.agenticPatterns.length).toBeGreaterThan(0);
			expect(DEFAULT_ROUTING_CONFIG.agenticPatterns[0]).toBeInstanceOf(RegExp);
		});

		test("code patterns should match code syntax", () => {
			const patterns = DEFAULT_ROUTING_CONFIG.codePatterns;

			// Test method calls
			expect(patterns.some((p) => p.test("foo.bar()"))).toBe(true);

			// Test function declarations
			expect(patterns.some((p) => p.test("function myFunc()"))).toBe(true);

			// Test class declarations
			expect(patterns.some((p) => p.test("class MyClass"))).toBe(true);

			// Test import statements
			expect(patterns.some((p) => p.test("import React from 'react'"))).toBe(true);

			// Test variable declarations
			expect(patterns.some((p) => p.test("const x = 5"))).toBe(true);
		});
	});

	describe("DEFAULT_CACHE_CONFIG", () => {
		test("should have valid cache settings", () => {
			expect(DEFAULT_CACHE_CONFIG.embeddingCacheMaxSize).toBe(10000);
			expect(DEFAULT_CACHE_CONFIG.embeddingCacheTTLMs).toBe(3600000); // 1 hour
			expect(DEFAULT_CACHE_CONFIG.queryCacheTTLMs).toBe(300000); // 5 minutes
			expect(DEFAULT_CACHE_CONFIG.queryCacheEnabled).toBe(true);
		});

		test("should have reasonable TTL values", () => {
			// Embedding cache should be longer than query cache
			expect(DEFAULT_CACHE_CONFIG.embeddingCacheTTLMs).toBeGreaterThan(
				DEFAULT_CACHE_CONFIG.queryCacheTTLMs,
			);
		});
	});

	describe("DEFAULT_RATE_LIMIT_CONFIG", () => {
		test("should have valid rate limit settings", () => {
			expect(DEFAULT_RATE_LIMIT_CONFIG.requestsPerHour).toBe(100);
			expect(DEFAULT_RATE_LIMIT_CONFIG.budgetLimit).toBe(1000); // $10
			expect(DEFAULT_RATE_LIMIT_CONFIG.costPerRequest).toBe(5); // 5 cents
		});

		test("should allow at least one request within budget", () => {
			const { budgetLimit, costPerRequest } = DEFAULT_RATE_LIMIT_CONFIG;
			expect(budgetLimit).toBeGreaterThanOrEqual(costPerRequest);
		});
	});

	describe("DEFAULT_AB_TESTING_CONFIG", () => {
		test("should have valid A/B testing settings", () => {
			expect(DEFAULT_AB_TESTING_CONFIG.enabled).toBe(false);
			expect(DEFAULT_AB_TESTING_CONFIG.rolloutPercentage).toBe(100);
		});

		test("should have rollout percentage in valid range", () => {
			expect(DEFAULT_AB_TESTING_CONFIG.rolloutPercentage).toBeGreaterThanOrEqual(0);
			expect(DEFAULT_AB_TESTING_CONFIG.rolloutPercentage).toBeLessThanOrEqual(100);
		});
	});

	describe("DEFAULT_RERANKER_CONFIG", () => {
		test("should have all required top-level properties", () => {
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("enabled");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("defaultTier");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("timeoutMs");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("tiers");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("routing");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("cache");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("rateLimit");
			expect(DEFAULT_RERANKER_CONFIG).toHaveProperty("abTesting");
		});

		test("should have reranking enabled by default", () => {
			expect(DEFAULT_RERANKER_CONFIG.enabled).toBe(true);
		});

		test("should have fast as default tier", () => {
			expect(DEFAULT_RERANKER_CONFIG.defaultTier).toBe("fast");
		});

		test("should have reasonable timeout", () => {
			expect(DEFAULT_RERANKER_CONFIG.timeoutMs).toBe(500);
			expect(DEFAULT_RERANKER_CONFIG.timeoutMs).toBeGreaterThan(0);
			expect(DEFAULT_RERANKER_CONFIG.timeoutMs).toBeLessThan(10000);
		});

		test("should include all tier configs", () => {
			expect(DEFAULT_RERANKER_CONFIG.tiers).toEqual(DEFAULT_TIER_CONFIGS);
		});

		test("should include routing config", () => {
			expect(DEFAULT_RERANKER_CONFIG.routing).toEqual(DEFAULT_ROUTING_CONFIG);
		});

		test("should include cache config", () => {
			expect(DEFAULT_RERANKER_CONFIG.cache).toEqual(DEFAULT_CACHE_CONFIG);
		});

		test("should include rate limit config", () => {
			expect(DEFAULT_RERANKER_CONFIG.rateLimit).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
		});

		test("should include A/B testing config", () => {
			expect(DEFAULT_RERANKER_CONFIG.abTesting).toEqual(DEFAULT_AB_TESTING_CONFIG);
		});
	});
});
