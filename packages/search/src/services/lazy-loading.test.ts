import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchedReranker } from "./batched-reranker";

// Mock the @huggingface/transformers pipeline
const { mockPipeline } = vi.hoisted(() => {
	const mockPipeline = vi.fn();
	return { mockPipeline };
});

vi.mock("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
}));

describe("Lazy Model Loading with Idle Unload", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllTimers();
		vi.clearAllMocks();

		// Clear all static state
		BatchedReranker.unloadAll();

		// Setup mock pipeline to return a classifier function
		mockPipeline.mockResolvedValue(async (_input: { text: string; text_pair: string }) => {
			return [{ label: "LABEL_0", score: 0.95 }];
		});
	});

	afterEach(() => {
		BatchedReranker.unloadAll();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Lazy Loading", () => {
		it("should not load model on construction", () => {
			new BatchedReranker({
				model: "test-model",
			});

			// Pipeline should not be called yet
			expect(mockPipeline).not.toHaveBeenCalled();
		});

		it("should load model on first rerank call", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 60000,
			});

			// Load model by calling rerank
			await reranker.rerank("test query", [{ id: "1", content: "test doc" }], 1);

			// Pipeline should be called once
			expect(mockPipeline).toHaveBeenCalledTimes(1);
			expect(mockPipeline).toHaveBeenCalledWith("text-classification", "test-model", {
				dtype: "q8",
			});
		});

		it("should reuse loaded model on subsequent calls", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 60000,
			});

			// First call loads model
			await reranker.rerank("query 1", [{ id: "1", content: "doc 1" }], 1);

			// Second call reuses model
			await reranker.rerank("query 2", [{ id: "2", content: "doc 2" }], 1);

			// Pipeline should only be called once (model cached)
			expect(mockPipeline).toHaveBeenCalledTimes(1);
		});

		it("should share model instances across reranker instances with same config", async () => {
			const reranker1 = new BatchedReranker({
				model: "test-model",
				quantization: "q8",
			});

			const reranker2 = new BatchedReranker({
				model: "test-model",
				quantization: "q8",
			});

			// Both rerankers use same model
			await reranker1.rerank("query", [{ id: "1", content: "doc" }], 1);
			await reranker2.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Pipeline should only be called once (shared instance)
			expect(mockPipeline).toHaveBeenCalledTimes(1);
		});

		it("should load separate models for different configs", async () => {
			const reranker1 = new BatchedReranker({
				model: "model-a",
			});

			const reranker2 = new BatchedReranker({
				model: "model-b",
			});

			// Different models
			await reranker1.rerank("query", [{ id: "1", content: "doc" }], 1);
			await reranker2.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Pipeline should be called twice (different models)
			expect(mockPipeline).toHaveBeenCalledTimes(2);
		});
	});

	describe("Idle Unload", () => {
		it("should unload model after idle timeout", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 5000, // 5 seconds
			});

			// Load model
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);

			// Model should be loaded
			let loaded = BatchedReranker.getLoadedModels();
			expect(loaded.length).toBe(1);
			expect(loaded[0].key).toBe("test-model:q8");

			// Advance time past idle timeout
			vi.advanceTimersByTime(6000);

			// Model should be unloaded
			loaded = BatchedReranker.getLoadedModels();
			expect(loaded.length).toBe(0);
		});

		it("should reset idle timer on each rerank call", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 5000,
			});

			// Load model
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);

			// Wait 3 seconds (less than timeout)
			vi.advanceTimersByTime(3000);

			// Use model again (resets timer)
			await reranker.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Wait another 3 seconds (total 6s, but timer was reset)
			vi.advanceTimersByTime(3000);

			// Model should still be loaded (timer was reset)
			const loaded = BatchedReranker.getLoadedModels();
			expect(loaded.length).toBe(1);
		});

		it("should reload model if used after unload", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 5000,
			});

			// First load
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);
			expect(mockPipeline).toHaveBeenCalledTimes(1);

			// Unload after timeout
			vi.advanceTimersByTime(6000);

			// Model should be unloaded
			expect(BatchedReranker.getLoadedModels().length).toBe(0);

			// Use again - should reload
			await reranker.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Pipeline should be called again (model reloaded)
			expect(mockPipeline).toHaveBeenCalledTimes(2);
		});

		it("should track idle time correctly", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 10000,
			});

			// Load model
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);

			// Check idle time immediately
			let loaded = BatchedReranker.getLoadedModels();
			expect(loaded[0].idleTimeMs).toBeLessThan(100); // Should be very small

			// Wait 2 seconds
			vi.advanceTimersByTime(2000);

			// Check idle time again
			loaded = BatchedReranker.getLoadedModels();
			expect(loaded[0].idleTimeMs).toBeGreaterThan(1900);
			expect(loaded[0].idleTimeMs).toBeLessThan(2100);
		});

		it("should handle multiple models with different idle times", async () => {
			const reranker1 = new BatchedReranker({
				model: "model-a",
				idleTimeoutMs: 5000,
			});

			const reranker2 = new BatchedReranker({
				model: "model-b",
				idleTimeoutMs: 10000,
			});

			// Load both models
			await reranker1.rerank("query", [{ id: "1", content: "doc" }], 1);
			await reranker2.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Both should be loaded
			expect(BatchedReranker.getLoadedModels().length).toBe(2);

			// Advance 6 seconds (model-a should unload, model-b should stay)
			vi.advanceTimersByTime(6000);

			const loaded = BatchedReranker.getLoadedModels();
			expect(loaded.length).toBe(1);
			expect(loaded[0].key).toBe("model-b:q8");

			// Advance another 5 seconds (model-b should unload)
			vi.advanceTimersByTime(5000);

			expect(BatchedReranker.getLoadedModels().length).toBe(0);
		});
	});

	describe("Manual Unload", () => {
		it("should unload specific model manually", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				quantization: "q8",
			});

			// Load model
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);

			// Model should be loaded
			expect(BatchedReranker.getLoadedModels().length).toBe(1);

			// Manual unload
			BatchedReranker.unloadModel("test-model", "q8");

			// Model should be unloaded
			expect(BatchedReranker.getLoadedModels().length).toBe(0);
		});

		it("should unload all models manually", async () => {
			const reranker1 = new BatchedReranker({ model: "model-a" });
			const reranker2 = new BatchedReranker({ model: "model-b" });

			// Load both
			await reranker1.rerank("query", [{ id: "1", content: "doc" }], 1);
			await reranker2.rerank("query", [{ id: "2", content: "doc" }], 1);

			// Both loaded
			expect(BatchedReranker.getLoadedModels().length).toBe(2);

			// Unload all
			BatchedReranker.unloadAll();

			// All unloaded
			expect(BatchedReranker.getLoadedModels().length).toBe(0);
		});

		it("should clear idle timers when unloading all", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
				idleTimeoutMs: 60000,
			});

			// Load model
			await reranker.rerank("query", [{ id: "1", content: "doc" }], 1);

			// Unload all (should clear timers)
			BatchedReranker.unloadAll();

			// Advance time - should not throw or cause issues
			vi.advanceTimersByTime(70000);

			// Model should stay unloaded
			expect(BatchedReranker.getLoadedModels().length).toBe(0);
		});
	});

	describe("Warmup", () => {
		it("should preload model with warmup", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
			});

			// Warmup (preload)
			await reranker.warmup();

			// Model should be loaded without calling rerank
			expect(mockPipeline).toHaveBeenCalledTimes(1);
			expect(BatchedReranker.getLoadedModels().length).toBe(1);
		});
	});

	describe("Concurrent Loading", () => {
		it("should handle concurrent rerank calls during model load", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
			});

			// Make multiple concurrent calls
			const promises = [
				reranker.rerank("query1", [{ id: "1", content: "doc1" }], 1),
				reranker.rerank("query2", [{ id: "2", content: "doc2" }], 1),
				reranker.rerank("query3", [{ id: "3", content: "doc3" }], 1),
			];

			await Promise.all(promises);

			// Pipeline should only be called once (concurrent calls wait for same load)
			expect(mockPipeline).toHaveBeenCalledTimes(1);
		});
	});

	describe("Default Idle Timeout", () => {
		it("should use 5 minutes as default idle timeout", async () => {
			const reranker = new BatchedReranker({
				model: "test-model",
			});

			// Check default timeout (5 minutes = 300000ms)
			expect(reranker.idleTimeoutMs).toBe(5 * 60 * 1000);
		});
	});
});
