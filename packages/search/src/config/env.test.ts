import { envBool, envNum, envStr } from "@engram/common";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_TIER_CONFIGS, rerankerConfig } from "./index";

/**
 * Tests for environment variable handling in search-core config.
 *
 * Note: The env helper functions (envBool, envNum, envStr) are now provided
 * by @engram/common. These tests verify the integration with the reranker config.
 */
describe("env", () => {
	// Store original env
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear relevant env vars before each test
		delete process.env.RERANKER_ENABLED;
		delete process.env.RERANKER_DEFAULT_TIER;
		delete process.env.RERANKER_TIMEOUT_MS;
		delete process.env.RERANKER_FAST_MODEL;
		delete process.env.RERANKER_CACHE_ENABLED;
		delete process.env.RERANKER_AB_ROLLOUT;
		delete process.env.XAI_API_KEY;
	});

	afterEach(() => {
		// Restore original env
		process.env = { ...originalEnv };
	});

	describe("envBool from @engram/common", () => {
		test("should return default when env var not set", () => {
			expect(envBool("NONEXISTENT_VAR", true)).toBe(true);
			expect(envBool("NONEXISTENT_VAR", false)).toBe(false);
		});

		test("should parse 'true' as true", () => {
			process.env.TEST_BOOL = "true";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		test("should parse 'TRUE' as true (case insensitive)", () => {
			process.env.TEST_BOOL = "TRUE";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		test("should parse '1' as true", () => {
			process.env.TEST_BOOL = "1";
			expect(envBool("TEST_BOOL", false)).toBe(true);
		});

		test("should parse 'false' as false", () => {
			process.env.TEST_BOOL = "false";
			expect(envBool("TEST_BOOL", true)).toBe(false);
		});

		test("should parse '0' as false", () => {
			process.env.TEST_BOOL = "0";
			expect(envBool("TEST_BOOL", true)).toBe(false);
		});
	});

	describe("envNum from @engram/common", () => {
		test("should return default when env var not set", () => {
			expect(envNum("NONEXISTENT_VAR", 42)).toBe(42);
		});

		test("should parse valid integer", () => {
			process.env.TEST_NUM = "123";
			expect(envNum("TEST_NUM", 0)).toBe(123);
		});

		test("should parse negative integer", () => {
			process.env.TEST_NUM = "-456";
			expect(envNum("TEST_NUM", 0)).toBe(-456);
		});

		test("should return default for invalid number", () => {
			process.env.TEST_NUM = "not_a_number";
			expect(envNum("TEST_NUM", 42)).toBe(42);
		});

		test("should return default for empty string", () => {
			process.env.TEST_NUM = "";
			expect(envNum("TEST_NUM", 42)).toBe(42);
		});
	});

	describe("envStr from @engram/common", () => {
		test("should return default when env var not set", () => {
			expect(envStr("NONEXISTENT_VAR", "default")).toBe("default");
		});

		test("should return env var value when set", () => {
			process.env.TEST_STR = "hello world";
			expect(envStr("TEST_STR", "default")).toBe("hello world");
		});

		test("should return empty string if env var is empty", () => {
			process.env.TEST_STR = "";
			expect(envStr("TEST_STR", "default")).toBe("");
		});
	});

	describe("rerankerConfig defaults", () => {
		test("should have default values when no env vars set", () => {
			// These test the defaults in the consolidated config
			expect(rerankerConfig.enabled).toBe(true);
			expect(rerankerConfig.defaultTier).toBe("fast");
			expect(rerankerConfig.timeoutMs).toBe(500);
		});

		test("should have valid tier configs", () => {
			expect(rerankerConfig.tiers.fast.model).toBe(DEFAULT_TIER_CONFIGS.fast.model);
			expect(rerankerConfig.tiers.accurate.model).toBe(DEFAULT_TIER_CONFIGS.accurate.model);
			expect(rerankerConfig.tiers.code.model).toBe(DEFAULT_TIER_CONFIGS.code.model);
			expect(rerankerConfig.tiers.llm.model).toBe(DEFAULT_TIER_CONFIGS.llm.model);
		});

		test("should preserve regex patterns in routing config", () => {
			expect(rerankerConfig.routing.codePatterns).toBeInstanceOf(Array);
			expect(rerankerConfig.routing.codePatterns[0]).toBeInstanceOf(RegExp);
			expect(rerankerConfig.routing.agenticPatterns).toBeInstanceOf(Array);
			expect(rerankerConfig.routing.agenticPatterns[0]).toBeInstanceOf(RegExp);
		});
	});
});
