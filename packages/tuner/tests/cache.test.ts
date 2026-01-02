import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { EvaluationCache } from "../src/executor/cache.js";
import type { TrialMetrics } from "../src/executor/trial-runner.js";

const TEST_CACHE_DIR = ".test-tuner-cache";

describe("EvaluationCache", () => {
	let cache: EvaluationCache;

	beforeEach(async () => {
		cache = new EvaluationCache(TEST_CACHE_DIR);
		// Clear any existing cache
		await cache.clear();
	});

	afterEach(async () => {
		// Clean up test cache directory
		try {
			await rm(TEST_CACHE_DIR, { recursive: true });
		} catch {
			// Ignore if doesn't exist
		}
	});

	describe("get/set", () => {
		it("should return null for uncached params", async () => {
			const result = await cache.get({ foo: 1, bar: 2 });
			expect(result).toBeNull();
		});

		it("should cache and retrieve metrics", async () => {
			const params = { reranker: { depth: 30 }, abstention: { threshold: 0.5 } };
			const metrics: TrialMetrics = {
				ndcg: 0.85,
				mrr: 0.72,
				hitRate: 0.9,
				p50Latency: 50,
				p95Latency: 100,
			};

			await cache.set(params, metrics);
			const result = await cache.get(params);

			expect(result).toEqual(metrics);
		});

		it("should treat equivalent params the same regardless of order", async () => {
			const params1 = { a: 1, b: 2, c: 3 };
			const params2 = { c: 3, a: 1, b: 2 };

			const metrics: TrialMetrics = { ndcg: 0.5 };

			await cache.set(params1, metrics);
			const result = await cache.get(params2);

			expect(result).toEqual(metrics);
		});

		it("should distinguish different param values", async () => {
			const params1 = { depth: 30 };
			const params2 = { depth: 50 };

			const metrics1: TrialMetrics = { ndcg: 0.8 };
			const metrics2: TrialMetrics = { ndcg: 0.9 };

			await cache.set(params1, metrics1);
			await cache.set(params2, metrics2);

			expect(await cache.get(params1)).toEqual(metrics1);
			expect(await cache.get(params2)).toEqual(metrics2);
		});

		it("should handle nested objects", async () => {
			const params = {
				reranker: { enabled: true, depth: 30, tiers: { fast: { maxCandidates: 100 } } },
				abstention: { minRetrievalScore: 0.3 },
			};
			const metrics: TrialMetrics = { ndcg: 0.7, mrr: 0.6 };

			await cache.set(params, metrics);
			const result = await cache.get(params);

			expect(result).toEqual(metrics);
		});
	});

	describe("has", () => {
		it("should return false for uncached params", async () => {
			const result = await cache.has({ foo: 1 });
			expect(result).toBe(false);
		});

		it("should return true for cached params", async () => {
			const params = { depth: 30 };
			await cache.set(params, { ndcg: 0.8 });

			const result = await cache.has(params);
			expect(result).toBe(true);
		});
	});

	describe("statistics", () => {
		it("should track hits and misses", async () => {
			const params = { x: 1 };
			await cache.set(params, { ndcg: 0.5 });

			// Miss
			await cache.get({ y: 2 });
			// Hit
			await cache.get(params);
			// Another miss
			await cache.get({ z: 3 });
			// Another hit
			await cache.get(params);

			const stats = await cache.getStats();
			expect(stats.hits).toBe(2);
			expect(stats.misses).toBe(2);
			expect(stats.hitRate).toBe(0.5);
		});

		it("should count entries", async () => {
			await cache.set({ a: 1 }, { ndcg: 0.1 });
			await cache.set({ b: 2 }, { ndcg: 0.2 });
			await cache.set({ c: 3 }, { ndcg: 0.3 });

			const stats = await cache.getStats();
			expect(stats.entries).toBe(3);
		});

		it("should return 0 hit rate when no lookups", async () => {
			const stats = await cache.getStats();
			expect(stats.hitRate).toBe(0);
		});
	});

	describe("clear", () => {
		it("should remove all cached entries", async () => {
			await cache.set({ a: 1 }, { ndcg: 0.1 });
			await cache.set({ b: 2 }, { ndcg: 0.2 });

			let stats = await cache.getStats();
			expect(stats.entries).toBe(2);

			await cache.clear();

			stats = await cache.getStats();
			expect(stats.entries).toBe(0);
		});

		it("should reset statistics", async () => {
			await cache.set({ a: 1 }, { ndcg: 0.1 });
			await cache.get({ a: 1 }); // hit
			await cache.get({ b: 2 }); // miss

			await cache.clear();

			const stats = await cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);
		});
	});

	describe("resetStats", () => {
		it("should reset only statistics, not cache entries", async () => {
			await cache.set({ a: 1 }, { ndcg: 0.1 });
			await cache.get({ a: 1 }); // hit
			await cache.get({ b: 2 }); // miss

			cache.resetStats();

			const stats = await cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);
			expect(stats.entries).toBe(1); // Entry still there
		});
	});

	describe("edge cases", () => {
		it("should handle empty params object", async () => {
			const metrics: TrialMetrics = { ndcg: 0.5 };

			await cache.set({}, metrics);
			const result = await cache.get({});

			expect(result).toEqual(metrics);
		});

		it("should handle params with boolean values", async () => {
			const params = { enabled: true, disabled: false };
			const metrics: TrialMetrics = { ndcg: 0.6 };

			await cache.set(params, metrics);
			const result = await cache.get(params);

			expect(result).toEqual(metrics);
		});

		it("should handle params with string values", async () => {
			const params = { tier: "accurate", model: "e5-base" };
			const metrics: TrialMetrics = { ndcg: 0.7 };

			await cache.set(params, metrics);
			const result = await cache.get(params);

			expect(result).toEqual(metrics);
		});

		it("should handle all metric fields", async () => {
			const metrics: TrialMetrics = {
				ndcg: 0.85,
				mrr: 0.72,
				hitRate: 0.9,
				precision: 0.88,
				recall: 0.75,
				p50Latency: 50,
				p95Latency: 100,
				p99Latency: 150,
				abstentionPrecision: 0.8,
				abstentionRecall: 0.7,
				abstentionF1: 0.75,
			};

			await cache.set({ test: true }, metrics);
			const result = await cache.get({ test: true });

			expect(result).toEqual(metrics);
		});

		it("should handle file read errors in get", async () => {
			// Try to get a key that doesn't exist - should return null
			const result = await cache.get({ nonexistent: true });
			expect(result).toBeNull();
		});

		it("should handle corrupted cache files in has", async () => {
			const params = { test: 1 };
			await cache.set(params, { ndcg: 0.5 });

			// Corrupt the cache file by writing invalid JSON
			const { join } = await import("node:path");
			const { createHash } = await import("node:crypto");

			const key = createHash("md5").update(JSON.stringify(params)).digest("hex");
			const corruptedPath = join(TEST_CACHE_DIR, `${key}.json`);

			await Bun.write(corruptedPath, "{ corrupt json");

			// has should return false for corrupted files
			const result = await cache.has(params);
			expect(result).toBe(false);
		});

		it("should handle version mismatch in has", async () => {
			const params = { test: 1 };

			// Write cache entry with wrong version
			const { join } = await import("node:path");
			const { createHash } = await import("node:crypto");

			await mkdir(TEST_CACHE_DIR, { recursive: true });

			const key = createHash("md5").update(JSON.stringify(params)).digest("hex");
			const cachePath = join(TEST_CACHE_DIR, `${key}.json`);

			await Bun.write(
				cachePath,
				JSON.stringify({
					params,
					metrics: { ndcg: 0.5 },
					timestamp: new Date().toISOString(),
					version: 999,
				}),
			);

			// has should return false for wrong version
			const result = await cache.has(params);
			expect(result).toBe(false);

			// get should also return null for wrong version
			const getResult = await cache.get(params);
			expect(getResult).toBeNull();
		});

		it("should handle getStats when cache dir does not exist", async () => {
			const newCache = new EvaluationCache(".nonexistent-cache-dir");
			const stats = await newCache.getStats();

			expect(stats.entries).toBe(0);
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);
		});

		it("should handle clear when cache dir does not exist", async () => {
			const newCache = new EvaluationCache(".nonexistent-cache-dir-2");
			// Should not throw - just verify it completes successfully
			await newCache.clear();
		});
	});
});
