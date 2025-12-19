import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColBERTEmbedder } from "./colbert-embedder";
import { type CachedDocumentCandidate, ColBERTReranker } from "./colbert-reranker";

// Mock logger
vi.mock("@engram/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("ColBERTReranker", () => {
	let mockEmbedder: ColBERTEmbedder;
	let reranker: ColBERTReranker;

	beforeEach(() => {
		// Create mock embedder
		mockEmbedder = {
			encodeQuery: vi.fn(async (_query: string) => {
				// Return 3 query tokens x 128d (normalized)
				return [
					new Float32Array(128).fill(0.1),
					new Float32Array(128).fill(0.2),
					new Float32Array(128).fill(0.3),
				];
			}),
			encodeDocument: vi.fn(async (_content: string) => {
				// Return 5 document tokens x 128d (normalized)
				return [
					new Float32Array(128).fill(0.15),
					new Float32Array(128).fill(0.25),
					new Float32Array(128).fill(0.35),
					new Float32Array(128).fill(0.05),
					new Float32Array(128).fill(0.45),
				];
			}),
			preload: vi.fn(async () => {}),
		} as unknown as ColBERTEmbedder;

		reranker = new ColBERTReranker(mockEmbedder);
	});

	describe("rerank", () => {
		it("should return empty array for empty candidates", async () => {
			const results = await reranker.rerank("query", [], 10);
			expect(results).toEqual([]);
		});

		it("should encode query tokens", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{
					id: "1",
					content: "test document",
					colbertEmbeddings: [new Float32Array(128).fill(0.1)],
					score: 0.8,
				},
			];

			await reranker.rerank("test query", candidates, 10);

			expect(mockEmbedder.encodeQuery).toHaveBeenCalledWith("test query");
		});

		it("should use cached embeddings when available", async () => {
			const cachedEmbeddings = [new Float32Array(128).fill(0.1), new Float32Array(128).fill(0.2)];

			const candidates: CachedDocumentCandidate[] = [
				{
					id: "1",
					content: "test document",
					colbertEmbeddings: cachedEmbeddings,
					score: 0.8,
				},
			];

			await reranker.rerank("query", candidates, 10);

			// Should NOT call encodeDocument since embeddings are cached
			expect(mockEmbedder.encodeDocument).not.toHaveBeenCalled();
		});

		it("should compute embeddings on-the-fly when not cached", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{
					id: "1",
					content: "test document",
					score: 0.8,
				},
			];

			await reranker.rerank("query", candidates, 10);

			// Should call encodeDocument for missing embeddings
			expect(mockEmbedder.encodeDocument).toHaveBeenCalledWith("test document");
		});

		it("should return results sorted by score descending", async () => {
			// Mock embedder to return predictable scores
			mockEmbedder.encodeQuery = vi.fn(async () => [new Float32Array(128).fill(1.0)]);

			mockEmbedder.encodeDocument = vi
				.fn()
				.mockResolvedValueOnce([new Float32Array(128).fill(0.5)]) // doc1: low score
				.mockResolvedValueOnce([new Float32Array(128).fill(0.9)]) // doc2: high score
				.mockResolvedValueOnce([new Float32Array(128).fill(0.7)]); // doc3: medium score

			const candidates: CachedDocumentCandidate[] = [
				{ id: "1", content: "doc1", score: 0.1 },
				{ id: "2", content: "doc2", score: 0.2 },
				{ id: "3", content: "doc3", score: 0.3 },
			];

			const results = await reranker.rerank("query", candidates, 3);

			// Should be sorted by ColBERT score (highest first)
			expect(results[0].id).toBe("2"); // highest score (0.9 * 128)
			expect(results[1].id).toBe("3"); // medium score (0.7 * 128)
			expect(results[2].id).toBe("1"); // lowest score (0.5 * 128)

			// Scores should be descending
			expect(results[0].score).toBeGreaterThan(results[1].score);
			expect(results[1].score).toBeGreaterThan(results[2].score);
		});

		it("should limit results to topK", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{ id: "1", content: "doc1", colbertEmbeddings: [new Float32Array(128).fill(0.1)] },
				{ id: "2", content: "doc2", colbertEmbeddings: [new Float32Array(128).fill(0.2)] },
				{ id: "3", content: "doc3", colbertEmbeddings: [new Float32Array(128).fill(0.3)] },
				{ id: "4", content: "doc4", colbertEmbeddings: [new Float32Array(128).fill(0.4)] },
				{ id: "5", content: "doc5", colbertEmbeddings: [new Float32Array(128).fill(0.5)] },
			];

			const results = await reranker.rerank("query", candidates, 3);

			expect(results).toHaveLength(3);
		});

		it("should preserve original index", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{ id: "1", content: "doc1", colbertEmbeddings: [new Float32Array(128).fill(0.1)] },
				{ id: "2", content: "doc2", colbertEmbeddings: [new Float32Array(128).fill(0.2)] },
			];

			const results = await reranker.rerank("query", candidates, 10);

			// Should have original indices (0-based)
			expect(results.some((r) => r.originalIndex === 0)).toBe(true);
			expect(results.some((r) => r.originalIndex === 1)).toBe(true);
		});

		it("should preserve original scores", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{
					id: "1",
					content: "doc1",
					colbertEmbeddings: [new Float32Array(128).fill(0.1)],
					score: 0.85,
				},
				{
					id: "2",
					content: "doc2",
					colbertEmbeddings: [new Float32Array(128).fill(0.2)],
					score: 0.92,
				},
			];

			const results = await reranker.rerank("query", candidates, 10);

			// Should preserve original retrieval scores
			expect(results.some((r) => r.originalScore === 0.85)).toBe(true);
			expect(results.some((r) => r.originalScore === 0.92)).toBe(true);
		});

		it("should handle errors gracefully and assign zero score", async () => {
			mockEmbedder.encodeDocument = vi
				.fn()
				.mockResolvedValueOnce([new Float32Array(128).fill(0.5)])
				.mockRejectedValueOnce(new Error("Encoding failed"));

			const candidates: CachedDocumentCandidate[] = [
				{ id: "1", content: "doc1" },
				{ id: "2", content: "doc2" },
			];

			const results = await reranker.rerank("query", candidates, 10);

			expect(results).toHaveLength(2);

			// Failed document should have score 0
			const failedDoc = results.find((r) => r.id === "2");
			expect(failedDoc?.score).toBe(0);
		});

		it("should throw on critical errors", async () => {
			mockEmbedder.encodeQuery = vi.fn().mockRejectedValue(new Error("Query encoding failed"));

			const candidates: CachedDocumentCandidate[] = [
				{ id: "1", content: "doc1", colbertEmbeddings: [new Float32Array(128).fill(0.1)] },
			];

			await expect(reranker.rerank("query", candidates, 10)).rejects.toThrow();
		});
	});

	describe("MaxSim scoring", () => {
		it("should compute MaxSim score correctly", async () => {
			// Create embedder with predictable embeddings
			mockEmbedder.encodeQuery = vi.fn(async () => [
				// Query token 1: all 0.5
				new Float32Array(128).fill(0.5),
			]);

			mockEmbedder.encodeDocument = vi.fn(async () => [
				// Doc token 1: all 0.5 (perfect match)
				new Float32Array(128).fill(0.5),
				// Doc token 2: all 0.3 (lower match)
				new Float32Array(128).fill(0.3),
			]);

			const candidates: CachedDocumentCandidate[] = [{ id: "1", content: "doc1" }];

			const results = await reranker.rerank("query", candidates, 1);

			// MaxSim: for query token, max similarity is with doc token 1
			// Cosine similarity (normalized): dot(0.5, 0.5) * 128 = 0.25 * 128 = 32
			expect(results[0].score).toBeCloseTo(32, 1);
		});

		it("should sum max scores across all query tokens", async () => {
			// 2 query tokens - normalized vectors where each element is the same value
			mockEmbedder.encodeQuery = vi.fn(async () => [
				new Float32Array(128).fill(0.5),
				new Float32Array(128).fill(0.6),
			]);

			// 2 document tokens
			mockEmbedder.encodeDocument = vi.fn(async () => [
				new Float32Array(128).fill(0.5),
				new Float32Array(128).fill(0.6),
			]);

			const candidates: CachedDocumentCandidate[] = [{ id: "1", content: "doc1" }];

			const results = await reranker.rerank("query", candidates, 1);

			// For normalized vectors filled with constant value v:
			// dot(v, v) = v * v * 128
			// Query token 1 (0.5) best matches doc token 1 (0.5): 0.5 * 0.5 * 128 = 32
			// But it could also match doc token 2 (0.6): 0.5 * 0.6 * 128 = 38.4 (this is max)
			// Query token 2 (0.6) best matches doc token 2 (0.6): 0.6 * 0.6 * 128 = 46.08 (this is max)
			// Total: 38.4 + 46.08 = 84.48
			expect(results[0].score).toBeCloseTo(84.48, 1);
		});

		it("should find maximum similarity for each query token", async () => {
			// Single query token
			mockEmbedder.encodeQuery = vi.fn(async () => [new Float32Array(128).fill(0.8)]);

			// Three document tokens with varying similarity
			mockEmbedder.encodeDocument = vi.fn(async () => [
				new Float32Array(128).fill(0.2), // Low similarity
				new Float32Array(128).fill(0.8), // High similarity (should be chosen)
				new Float32Array(128).fill(0.5), // Medium similarity
			]);

			const candidates: CachedDocumentCandidate[] = [{ id: "1", content: "doc1" }];

			const results = await reranker.rerank("query", candidates, 1);

			// Should choose max similarity: dot(0.8, 0.8) * 128 = 0.64 * 128 = 81.92
			expect(results[0].score).toBeCloseTo(81.92, 1);
		});
	});

	describe("warmup", () => {
		it("should preload the embedder model", async () => {
			await reranker.warmup();

			expect(mockEmbedder.preload).toHaveBeenCalled();
		});
	});

	describe("BatchedRerankResult compatibility", () => {
		it("should return results compatible with BatchedRerankResult interface", async () => {
			const candidates: CachedDocumentCandidate[] = [
				{
					id: "1",
					content: "doc1",
					colbertEmbeddings: [new Float32Array(128).fill(0.1)],
					score: 0.8,
				},
			];

			const results = await reranker.rerank("query", candidates, 10);

			expect(results[0]).toHaveProperty("id");
			expect(results[0]).toHaveProperty("score");
			expect(results[0]).toHaveProperty("originalIndex");
			expect(results[0]).toHaveProperty("originalScore");

			expect(typeof results[0].id).toBe("string");
			expect(typeof results[0].score).toBe("number");
			expect(typeof results[0].originalIndex).toBe("number");
		});
	});
});
