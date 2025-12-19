import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchedReranker, type DocumentCandidate } from "./batched-reranker";

// Mock the transformers pipeline
vi.mock("@huggingface/transformers", () => ({
	pipeline: vi.fn().mockResolvedValue(
		vi.fn().mockImplementation(async (input: { text: string; text_pair: string }) => {
			// Simulate scoring based on content length (just for testing)
			const score = Math.min(1, input.text_pair.length / 100);
			return [{ label: "LABEL_0", score }];
		}),
	),
}));

describe("BatchedReranker", () => {
	let reranker: BatchedReranker;

	beforeEach(() => {
		reranker = new BatchedReranker({
			model: "test-model",
			maxBatchSize: 4,
			maxConcurrency: 2,
		});
	});

	afterEach(() => {
		BatchedReranker.unloadAll();
		vi.clearAllMocks();
	});

	describe("constructor", () => {
		it("should use default options when none provided", () => {
			const defaultReranker = new BatchedReranker();
			expect(defaultReranker.getModel()).toContain("MiniLM");
		});

		it("should use provided options", () => {
			const customReranker = new BatchedReranker({
				model: "custom-model",
			});
			expect(customReranker.getModel()).toBe("custom-model");
		});
	});

	describe("rerank()", () => {
		it("should return empty array for empty documents", async () => {
			const results = await reranker.rerank("test query", []);
			expect(results).toEqual([]);
		});

		it("should rerank documents and return top K", async () => {
			const documents: DocumentCandidate[] = [
				{ id: "1", content: "short" },
				{ id: "2", content: "a much longer document with more content" },
				{ id: "3", content: "medium length content here" },
			];

			const results = await reranker.rerank("test query", documents, 2);

			expect(results).toHaveLength(2);
			// Results should be sorted by score descending
			expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
		});

		it("should preserve original document IDs", async () => {
			const documents: DocumentCandidate[] = [
				{ id: "doc-a", content: "first document" },
				{ id: "doc-b", content: "second document" },
			];

			const results = await reranker.rerank("test query", documents);

			const ids = results.map((r) => r.id);
			expect(ids).toContain("doc-a");
			expect(ids).toContain("doc-b");
		});

		it("should include originalIndex in results", async () => {
			const documents: DocumentCandidate[] = [
				{ id: "1", content: "first" },
				{ id: "2", content: "second" },
			];

			const results = await reranker.rerank("test query", documents);

			// Each result should have an originalIndex
			for (const result of results) {
				expect(typeof result.originalIndex).toBe("number");
				expect(result.originalIndex).toBeGreaterThanOrEqual(0);
			}
		});

		it("should preserve original scores when provided", async () => {
			const documents: DocumentCandidate[] = [
				{ id: "1", content: "document one", score: 0.95 },
				{ id: "2", content: "document two", score: 0.85 },
			];

			const results = await reranker.rerank("test query", documents);

			for (const result of results) {
				expect(result.originalScore).toBeDefined();
				expect([0.95, 0.85]).toContain(result.originalScore);
			}
		});

		it("should handle large document sets with batching", async () => {
			const documents: DocumentCandidate[] = Array.from({ length: 20 }, (_, i) => ({
				id: `doc-${i}`,
				content: `Document content ${i} with some text`,
			}));

			const results = await reranker.rerank("test query", documents, 10);

			expect(results).toHaveLength(10);
		});

		it("should normalize scores to 0-1 range", async () => {
			const documents: DocumentCandidate[] = [{ id: "1", content: "test document" }];

			const results = await reranker.rerank("test query", documents);

			expect(results[0].score).toBeGreaterThanOrEqual(0);
			expect(results[0].score).toBeLessThanOrEqual(1);
		});
	});

	describe("forTier()", () => {
		it("should create reranker for fast tier", () => {
			const fastReranker = BatchedReranker.forTier("fast");
			expect(fastReranker.getModel()).toContain("MiniLM");
		});

		it("should create reranker for accurate tier", () => {
			const accurateReranker = BatchedReranker.forTier("accurate");
			expect(accurateReranker.getModel()).toContain("bge-reranker");
		});

		it("should create reranker for code tier", () => {
			const codeReranker = BatchedReranker.forTier("code");
			expect(codeReranker.getModel()).toContain("jina");
		});
	});

	describe("warmup()", () => {
		it("should preload the model", async () => {
			await reranker.warmup();
			// Second call should be instant (cached)
			const start = Date.now();
			await reranker.warmup();
			const elapsed = Date.now() - start;
			expect(elapsed).toBeLessThan(50); // Should be near-instant
		});
	});

	describe("unloadModel()", () => {
		it("should unload a specific model", async () => {
			await reranker.warmup();
			BatchedReranker.unloadModel("test-model", "q8");
			// Model should be unloaded (no direct way to verify, but shouldn't throw)
		});
	});

	describe("unloadAll()", () => {
		it("should unload all models", async () => {
			await reranker.warmup();
			BatchedReranker.unloadAll();
			// Should complete without error
		});
	});

	describe("concurrency control", () => {
		it("should respect maxConcurrency limit", async () => {
			let concurrentCount = 0;
			let maxConcurrent = 0;

			// Create a mock that tracks concurrent executions
			const { pipeline } = await import("@huggingface/transformers");
			(pipeline as any).mockResolvedValue(
				vi.fn().mockImplementation(async (input: { text: string; text_pair: string }) => {
					concurrentCount++;
					maxConcurrent = Math.max(maxConcurrent, concurrentCount);
					// Simulate some async work
					await new Promise((resolve) => setTimeout(resolve, 10));
					concurrentCount--;
					return [{ label: "LABEL_0", score: 0.5 }];
				}),
			);

			const limitedReranker = new BatchedReranker({
				model: "test-model",
				maxBatchSize: 2,
				maxConcurrency: 2,
			});

			// Create enough documents to require multiple batches
			const documents: DocumentCandidate[] = Array.from({ length: 10 }, (_, i) => ({
				id: `doc-${i}`,
				content: `Document ${i}`,
			}));

			await limitedReranker.rerank("test query", documents);

			// Should never exceed maxConcurrency (2 concurrent batches)
			expect(maxConcurrent).toBeLessThanOrEqual(2);
		});

		it("should process all batches even with concurrency limit", async () => {
			const processedBatches: number[] = [];

			const { pipeline } = await import("@huggingface/transformers");
			(pipeline as any).mockResolvedValue(
				vi.fn().mockImplementation(async (input: { text: string; text_pair: string }) => {
					processedBatches.push(Date.now());
					await new Promise((resolve) => setTimeout(resolve, 5));
					return [{ label: "LABEL_0", score: 0.5 }];
				}),
			);

			const limitedReranker = new BatchedReranker({
				model: "test-model",
				maxBatchSize: 2,
				maxConcurrency: 1, // Only 1 concurrent batch
			});

			const documents: DocumentCandidate[] = Array.from({ length: 8 }, (_, i) => ({
				id: `doc-${i}`,
				content: `Document ${i}`,
			}));

			const results = await limitedReranker.rerank("test query", documents);

			// All documents should be processed
			expect(results).toHaveLength(8);
		});

		it("should handle rapid promise completion without resource leaks", async () => {
			const { pipeline } = await import("@huggingface/transformers");
			(pipeline as any).mockResolvedValue(
				vi.fn().mockImplementation(async () => {
					// Instant completion to stress test promise cleanup
					return [{ label: "LABEL_0", score: 0.5 }];
				}),
			);

			const rapidReranker = new BatchedReranker({
				model: "test-model",
				maxBatchSize: 1,
				maxConcurrency: 3,
			});

			const documents: DocumentCandidate[] = Array.from({ length: 20 }, (_, i) => ({
				id: `doc-${i}`,
				content: `Document ${i}`,
			}));

			// Should complete without hanging (previous bug would cause infinite loop)
			// Request all 20 results
			const results = await rapidReranker.rerank("test query", documents, 20);

			expect(results).toHaveLength(20);
		});
	});
});
