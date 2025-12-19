import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchedRerankResult } from "./batched-reranker";
import { type CacheKey, QueryCache } from "./query-cache";

// Mock ioredis
const mockRedis = {
	connect: vi.fn().mockResolvedValue(undefined),
	get: vi.fn(),
	setex: vi.fn(),
	scan: vi.fn(),
	del: vi.fn(),
	quit: vi.fn().mockResolvedValue(undefined),
	on: vi.fn(),
};

vi.mock("ioredis", () => ({
	default: vi.fn(() => mockRedis),
}));

describe("QueryCache", () => {
	let cache: QueryCache;

	beforeEach(() => {
		vi.clearAllMocks();
		cache = new QueryCache({
			redisUrl: "redis://localhost:6379",
			ttlSeconds: 300,
			keyPrefix: "test:",
		});
	});

	afterEach(async () => {
		await cache.disconnect();
	});

	describe("constructor", () => {
		it("should use default options when none provided", () => {
			const defaultCache = new QueryCache();
			expect(defaultCache).toBeDefined();
		});

		it("should use provided options", () => {
			const customCache = new QueryCache({
				redisUrl: "redis://custom:6379",
				ttlSeconds: 600,
				keyPrefix: "custom:",
			});
			expect(customCache).toBeDefined();
		});

		it("should handle missing Redis URL gracefully", async () => {
			const noRedisCache = new QueryCache({ redisUrl: undefined });
			const result = await noRedisCache.get({ query: "test" });
			expect(result).toBeNull();
		});
	});

	describe("get()", () => {
		const mockResults: BatchedRerankResult[] = [
			{ id: "doc1", score: 0.9, originalIndex: 0, originalScore: 0.5 },
			{ id: "doc2", score: 0.8, originalIndex: 1, originalScore: 0.4 },
		];

		it("should return cached results when available", async () => {
			mockRedis.get.mockResolvedValue(JSON.stringify(mockResults));

			const params: CacheKey = { query: "test query" };
			const result = await cache.get(params);

			expect(result).toEqual(mockResults);
			expect(mockRedis.get).toHaveBeenCalled();
		});

		it("should return null when no cached results", async () => {
			mockRedis.get.mockResolvedValue(null);

			const params: CacheKey = { query: "test query" };
			const result = await cache.get(params);

			expect(result).toBeNull();
		});

		it("should return null on Redis error (graceful degradation)", async () => {
			mockRedis.get.mockRejectedValue(new Error("Redis connection failed"));

			const params: CacheKey = { query: "test query" };
			const result = await cache.get(params);

			expect(result).toBeNull();
		});

		it("should normalize query for consistent cache keys", async () => {
			mockRedis.get.mockResolvedValue(JSON.stringify(mockResults));

			// These should generate the same cache key
			await cache.get({ query: "Test Query" });
			await cache.get({ query: "test query" });
			await cache.get({ query: "  TEST QUERY  " });

			// Should all use the same Redis key
			const calls = mockRedis.get.mock.calls;
			expect(calls[0][0]).toBe(calls[1][0]);
			expect(calls[1][0]).toBe(calls[2][0]);
		});
	});

	describe("set()", () => {
		const mockResults: BatchedRerankResult[] = [
			{ id: "doc1", score: 0.9, originalIndex: 0, originalScore: 0.5 },
		];

		it("should cache results with TTL", async () => {
			const params: CacheKey = { query: "test query" };
			await cache.set(params, mockResults);

			expect(mockRedis.setex).toHaveBeenCalled();

			const [key, ttl, value] = mockRedis.setex.mock.calls[0];
			expect(ttl).toBe(300);
			expect(JSON.parse(value)).toEqual(mockResults);
		});

		it("should handle Redis errors gracefully", async () => {
			mockRedis.setex.mockRejectedValue(new Error("Redis connection failed"));

			const params: CacheKey = { query: "test query" };

			// Should not throw
			await expect(cache.set(params, mockResults)).resolves.toBeUndefined();
		});

		it("should include all cache key params in hash", async () => {
			await cache.set({ query: "q1", filters: { type: "code" } }, mockResults);
			await cache.set({ query: "q1", rerankTier: "fast" }, mockResults);
			await cache.set({ query: "q1", limit: 20 }, mockResults);
			await cache.set({ query: "q2" }, mockResults);

			// Should generate different keys for different params
			const calls = mockRedis.setex.mock.calls;
			const keys = calls.map((call) => call[0]);

			// All should be unique
			expect(new Set(keys).size).toBe(4);
		});
	});

	describe("invalidatePattern()", () => {
		it("should delete keys matching pattern", async () => {
			// Mock SCAN to return some keys
			mockRedis.scan
				.mockResolvedValueOnce(["10", ["test:key1", "test:key2"]])
				.mockResolvedValueOnce(["0", ["test:key3"]]);

			await cache.invalidatePattern("*");

			expect(mockRedis.scan).toHaveBeenCalledTimes(2);
			expect(mockRedis.del).toHaveBeenCalledWith("test:key1", "test:key2");
			expect(mockRedis.del).toHaveBeenCalledWith("test:key3");
		});

		it("should handle empty scan results", async () => {
			mockRedis.scan.mockResolvedValue(["0", []]);

			await cache.invalidatePattern("*");

			expect(mockRedis.del).not.toHaveBeenCalled();
		});

		it("should handle Redis errors gracefully", async () => {
			mockRedis.scan.mockRejectedValue(new Error("Redis connection failed"));

			// Should not throw
			await expect(cache.invalidatePattern("*")).resolves.toBeUndefined();
		});
	});

	describe("clear()", () => {
		it("should clear all cache entries", async () => {
			mockRedis.scan.mockResolvedValue(["0", ["test:key1"]]);

			await cache.clear();

			expect(mockRedis.scan).toHaveBeenCalled();
		});
	});

	describe("disconnect()", () => {
		it("should disconnect from Redis", async () => {
			// Ensure Redis is initialized
			await cache.get({ query: "test" });

			await cache.disconnect();

			expect(mockRedis.quit).toHaveBeenCalled();
		});

		it("should handle disconnect errors gracefully", async () => {
			mockRedis.quit.mockRejectedValue(new Error("Already disconnected"));

			// Should not throw
			await expect(cache.disconnect()).resolves.toBeUndefined();
		});
	});

	describe("isAvailable()", () => {
		it("should return false before initialization", () => {
			const newCache = new QueryCache({ redisUrl: "redis://localhost:6379" });
			expect(newCache.isAvailable()).toBe(false);
		});

		it("should return true after successful initialization", async () => {
			await cache.get({ query: "test" }); // Trigger initialization
			expect(cache.isAvailable()).toBe(true);
		});

		it("should return false when Redis unavailable", async () => {
			const noRedisCache = new QueryCache({ redisUrl: undefined });
			await noRedisCache.get({ query: "test" }); // Trigger initialization
			expect(noRedisCache.isAvailable()).toBe(false);
		});
	});

	describe("lazy initialization", () => {
		it("should not connect to Redis on construction", () => {
			new QueryCache({ redisUrl: "redis://localhost:6379" });
			expect(mockRedis.connect).not.toHaveBeenCalled();
		});

		it("should connect on first get", async () => {
			const newCache = new QueryCache({ redisUrl: "redis://localhost:6379" });
			await newCache.get({ query: "test" });
			expect(mockRedis.connect).toHaveBeenCalled();
		});

		it("should connect on first set", async () => {
			const newCache = new QueryCache({ redisUrl: "redis://localhost:6379" });
			await newCache.set({ query: "test" }, []);
			expect(mockRedis.connect).toHaveBeenCalled();
		});

		it("should only initialize once", async () => {
			await cache.get({ query: "test1" });
			await cache.get({ query: "test2" });
			await cache.set({ query: "test3" }, []);

			// Should only connect once
			expect(mockRedis.connect).toHaveBeenCalledTimes(1);
		});
	});
});
