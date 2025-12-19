import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingCache } from "./embedding-cache";

describe("EmbeddingCache", () => {
	let cache: EmbeddingCache;

	beforeEach(() => {
		cache = new EmbeddingCache({
			maxSizeBytes: 1024, // 1KB for testing
			ttlMs: 1000, // 1 second for testing
		});
	});

	describe("constructor", () => {
		it("should use default options when none provided", () => {
			const defaultCache = new EmbeddingCache();
			const stats = defaultCache.getStats();
			expect(stats.count).toBe(0);
		});

		it("should use provided options", () => {
			const customCache = new EmbeddingCache({
				maxSizeBytes: 2048,
				ttlMs: 5000,
			});
			expect(customCache.getMetrics().maxSize).toBe(2048);
		});
	});

	describe("set() and get()", () => {
		it("should cache embeddings", () => {
			const embeddings = [new Float32Array([0.1, 0.2, 0.3])];
			cache.set("doc1", embeddings);

			const retrieved = cache.get("doc1");
			expect(retrieved).toEqual(embeddings);
		});

		it("should return null for non-existent entries", () => {
			const result = cache.get("non-existent");
			expect(result).toBeNull();
		});

		it("should update existing entries", () => {
			const embeddings1 = [new Float32Array([0.1, 0.2])];
			const embeddings2 = [new Float32Array([0.3, 0.4])];

			cache.set("doc1", embeddings1);
			cache.set("doc1", embeddings2);

			const retrieved = cache.get("doc1");
			expect(retrieved).toEqual(embeddings2);
		});

		it("should handle multiple Float32Arrays", () => {
			const embeddings = [
				new Float32Array([0.1, 0.2]),
				new Float32Array([0.3, 0.4]),
				new Float32Array([0.5, 0.6]),
			];

			cache.set("doc1", embeddings);
			const retrieved = cache.get("doc1");

			expect(retrieved).toHaveLength(3);
			expect(retrieved).toEqual(embeddings);
		});
	});

	describe("TTL expiration", () => {
		it("should expire entries after TTL", async () => {
			vi.useFakeTimers();

			const embeddings = [new Float32Array([0.1, 0.2])];
			cache.set("doc1", embeddings);

			// Should be available immediately
			expect(cache.get("doc1")).toEqual(embeddings);

			// Advance time past TTL
			vi.advanceTimersByTime(1100);

			// Should be expired now
			expect(cache.get("doc1")).toBeNull();

			vi.useRealTimers();
		});

		it("should not expire entries within TTL", async () => {
			vi.useFakeTimers();

			const embeddings = [new Float32Array([0.1, 0.2])];
			cache.set("doc1", embeddings);

			// Advance time but stay within TTL
			vi.advanceTimersByTime(500);

			// Should still be available
			expect(cache.get("doc1")).toEqual(embeddings);

			vi.useRealTimers();
		});
	});

	describe("LRU eviction", () => {
		it("should evict oldest entries when size limit is reached", () => {
			// Each Float32Array element is 4 bytes
			// 256 elements * 4 bytes = 1024 bytes (max size)
			const large = [new Float32Array(256)];

			cache.set("doc1", large);
			expect(cache.get("doc1")).not.toBeNull();

			// Adding another large entry should evict doc1
			cache.set("doc2", large);

			expect(cache.get("doc1")).toBeNull();
			expect(cache.get("doc2")).not.toBeNull();
		});

		it("should track access order correctly", () => {
			const small = [new Float32Array(50)]; // 200 bytes

			cache.set("doc1", small);
			cache.set("doc2", small);
			cache.set("doc3", small);

			// Access doc1 to make it most recently used
			cache.get("doc1");

			// Add more entries to trigger eviction
			cache.set("doc4", small);
			cache.set("doc5", small);
			cache.set("doc6", small);

			// doc1 should still be present (recently accessed)
			// doc2 should be evicted (least recently used)
			expect(cache.get("doc1")).not.toBeNull();
			expect(cache.get("doc2")).toBeNull();
		});

		it("should evict multiple entries if needed", () => {
			const medium = [new Float32Array(100)]; // 400 bytes
			const large = [new Float32Array(250)]; // 1000 bytes

			cache.set("doc1", medium);
			cache.set("doc2", medium);

			// Adding large entry should evict both previous entries
			cache.set("doc3", large);

			expect(cache.get("doc1")).toBeNull();
			expect(cache.get("doc2")).toBeNull();
			expect(cache.get("doc3")).not.toBeNull();
		});
	});

	describe("invalidate()", () => {
		it("should remove specific entry", () => {
			const embeddings = [new Float32Array([0.1, 0.2])];

			cache.set("doc1", embeddings);
			expect(cache.get("doc1")).not.toBeNull();

			cache.invalidate("doc1");
			expect(cache.get("doc1")).toBeNull();
		});

		it("should handle invalidating non-existent entries", () => {
			expect(() => cache.invalidate("non-existent")).not.toThrow();
		});
	});

	describe("clear()", () => {
		it("should clear all entries", () => {
			const embeddings = [new Float32Array([0.1, 0.2])];

			cache.set("doc1", embeddings);
			cache.set("doc2", embeddings);
			cache.set("doc3", embeddings);

			expect(cache.getStats().count).toBe(3);

			cache.clear();

			expect(cache.getStats().count).toBe(0);
			expect(cache.get("doc1")).toBeNull();
			expect(cache.get("doc2")).toBeNull();
			expect(cache.get("doc3")).toBeNull();
		});

		it("should reset metrics", () => {
			const embeddings = [new Float32Array([0.1, 0.2])];

			cache.set("doc1", embeddings);
			cache.get("doc1");
			cache.get("non-existent");

			cache.clear();

			const metrics = cache.getMetrics();
			expect(metrics.hits).toBe(0);
			expect(metrics.misses).toBe(0);
			expect(metrics.evictions).toBe(0);
		});
	});

	describe("getStats()", () => {
		it("should return correct statistics", () => {
			const embeddings = [new Float32Array([0.1, 0.2, 0.3])]; // 12 bytes

			cache.set("doc1", embeddings);
			cache.set("doc2", embeddings);

			const stats = cache.getStats();
			expect(stats.count).toBe(2);
			expect(stats.size).toBe(24); // 2 * 12 bytes
		});

		it("should calculate hit rate correctly", () => {
			const embeddings = [new Float32Array([0.1, 0.2])];

			cache.set("doc1", embeddings);

			cache.get("doc1"); // hit
			cache.get("doc1"); // hit
			cache.get("non-existent"); // miss
			cache.get("non-existent"); // miss

			const stats = cache.getStats();
			expect(stats.hitRate).toBe(0.5); // 2 hits / 4 total
		});

		it("should return 0 hit rate when no accesses", () => {
			const stats = cache.getStats();
			expect(stats.hitRate).toBe(0);
		});
	});

	describe("getMetrics()", () => {
		it("should return detailed metrics", () => {
			const embeddings = [new Float32Array([0.1, 0.2])];

			cache.set("doc1", embeddings);
			cache.get("doc1"); // hit
			cache.get("non-existent"); // miss

			const metrics = cache.getMetrics();

			expect(metrics.hits).toBe(1);
			expect(metrics.misses).toBe(1);
			expect(metrics.evictions).toBe(0);
			expect(metrics.count).toBe(1);
			expect(metrics.size).toBeGreaterThan(0);
			expect(metrics.maxSize).toBe(1024);
			expect(metrics.hitRate).toBe(0.5);
		});

		it("should track evictions", () => {
			const large = [new Float32Array(256)]; // 1024 bytes

			cache.set("doc1", large);
			cache.set("doc2", large); // Should evict doc1

			const metrics = cache.getMetrics();
			expect(metrics.evictions).toBe(1);
		});
	});

	describe("size calculation", () => {
		it("should calculate size correctly for Float32Array", () => {
			// Float32Array uses 4 bytes per element
			const embeddings = [new Float32Array(10)]; // 40 bytes

			cache.set("doc1", embeddings);

			const stats = cache.getStats();
			expect(stats.size).toBe(40);
		});

		it("should sum sizes for multiple arrays", () => {
			const embeddings = [
				new Float32Array(10), // 40 bytes
				new Float32Array(5), // 20 bytes
				new Float32Array(15), // 60 bytes
			];

			cache.set("doc1", embeddings);

			const stats = cache.getStats();
			expect(stats.size).toBe(120);
		});
	});
});
