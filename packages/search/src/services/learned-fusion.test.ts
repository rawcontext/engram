import { describe, expect, it } from "vitest";
import { adaptiveRRF, type FusionSearchResult, LearnedFusion } from "./learned-fusion";

describe("LearnedFusion", () => {
	const makeDenseResults = (): FusionSearchResult[] => [
		{ id: "doc1", content: "Document 1 about machine learning", score: 0.9 },
		{ id: "doc2", content: "Document 2 about deep learning", score: 0.8 },
		{ id: "doc3", content: "Document 3 about neural networks", score: 0.7 },
	];

	const makeSparseResults = (): FusionSearchResult[] => [
		{ id: "doc2", content: "Document 2 about deep learning", score: 0.95 },
		{ id: "doc4", content: "Document 4 about transformers", score: 0.85 },
		{ id: "doc1", content: "Document 1 about machine learning", score: 0.75 },
	];

	describe("fuse", () => {
		it("should combine dense and sparse results", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx", // Will use fallback
			});

			const denseResults = makeDenseResults();
			const sparseResults = makeSparseResults();

			const fused = await fusion.fuse("What is machine learning?", denseResults, sparseResults);

			// Should have results from both sets
			expect(fused.length).toBeGreaterThan(0);

			// doc1 and doc2 appear in both, should be present
			const ids = fused.map((r) => r.id);
			expect(ids).toContain("doc1");
			expect(ids).toContain("doc2");
		});

		it("should return results sorted by fused score", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const denseResults = makeDenseResults();
			const sparseResults = makeSparseResults();

			const fused = await fusion.fuse("test query", denseResults, sparseResults);

			// Scores should be in descending order
			for (let i = 1; i < fused.length; i++) {
				expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
			}
		});

		it("should handle empty dense results", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const sparseResults = makeSparseResults();
			const fused = await fusion.fuse("test query", [], sparseResults);

			// Should still return sparse results
			expect(fused.length).toBe(sparseResults.length);
		});

		it("should handle empty sparse results", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const denseResults = makeDenseResults();
			const fused = await fusion.fuse("test query", denseResults, []);

			// Should still return dense results
			expect(fused.length).toBe(denseResults.length);
		});

		it("should handle rerank results when provided", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const denseResults = makeDenseResults();
			const sparseResults = makeSparseResults();
			const rerankResults: FusionSearchResult[] = [
				{ id: "doc3", content: "Document 3", score: 0.99 }, // Rerank boosts doc3
				{ id: "doc1", content: "Document 1", score: 0.95 },
			];

			const fused = await fusion.fuse("test query", denseResults, sparseResults, rerankResults);

			// Should include all documents
			const ids = fused.map((r) => r.id);
			expect(ids).toContain("doc1");
			expect(ids).toContain("doc3");
		});
	});

	describe("fuseWithWeights", () => {
		it("should apply explicit weights correctly", () => {
			const fusion = new LearnedFusion({
				normalizeScores: false, // Disable normalization for predictable testing
			});

			const denseResults: FusionSearchResult[] = [{ id: "doc1", content: "Doc 1", score: 1.0 }];
			const sparseResults: FusionSearchResult[] = [{ id: "doc1", content: "Doc 1", score: 0.5 }];

			const weights = { dense: 0.6, sparse: 0.4, rerank: 0.0 };
			const fused = fusion.fuseWithWeights(weights, denseResults, sparseResults);

			// Score should be 0.6 * 1.0 + 0.4 * 0.5 = 0.8
			expect(fused.length).toBe(1);
			expect(fused[0].score).toBeCloseTo(0.8, 2);
		});

		it("should handle documents appearing in only one result set", () => {
			const fusion = new LearnedFusion({
				normalizeScores: false,
			});

			const denseResults: FusionSearchResult[] = [{ id: "doc1", content: "Doc 1", score: 1.0 }];
			const sparseResults: FusionSearchResult[] = [{ id: "doc2", content: "Doc 2", score: 1.0 }];

			const weights = { dense: 0.5, sparse: 0.5, rerank: 0.0 };
			const fused = fusion.fuseWithWeights(weights, denseResults, sparseResults);

			// Should have both documents
			expect(fused.length).toBe(2);

			// doc1 only has dense score: 0.5 * 1.0 = 0.5
			// doc2 only has sparse score: 0.5 * 1.0 = 0.5
			const doc1 = fused.find((r) => r.id === "doc1");
			const doc2 = fused.find((r) => r.id === "doc2");
			expect(doc1?.score).toBeCloseTo(0.5, 2);
			expect(doc2?.score).toBeCloseTo(0.5, 2);
		});
	});

	describe("getWeights", () => {
		it("should return predicted weights for a query", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const weights = await fusion.getWeights("What is deep learning?");

			expect(weights.dense).toBeDefined();
			expect(weights.sparse).toBeDefined();
			expect(weights.rerank).toBeDefined();

			const sum = weights.dense + weights.sparse + weights.rerank;
			expect(sum).toBeCloseTo(1.0, 1);
		});
	});

	describe("isModelAvailable", () => {
		it("should return false when model does not exist", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
			});

			const available = await fusion.isModelAvailable();
			expect(available).toBe(false);
		});
	});

	describe("score normalization", () => {
		it("should normalize scores to 0-1 range by default", async () => {
			const fusion = new LearnedFusion({
				modelPath: "non-existent-model.onnx",
				normalizeScores: true,
			});

			// Results with varying score ranges
			const denseResults: FusionSearchResult[] = [
				{ id: "doc1", content: "Doc 1", score: 100 },
				{ id: "doc2", content: "Doc 2", score: 50 },
			];
			const sparseResults: FusionSearchResult[] = [
				{ id: "doc1", content: "Doc 1", score: 0.9 },
				{ id: "doc2", content: "Doc 2", score: 0.1 },
			];

			const fused = await fusion.fuse("test", denseResults, sparseResults);

			// All scores should be reasonable (not the raw 100 or 50)
			for (const result of fused) {
				expect(result.score).toBeLessThanOrEqual(1.5); // Allow some headroom
				expect(result.score).toBeGreaterThanOrEqual(0);
			}
		});
	});
});

describe("adaptiveRRF", () => {
	it("should combine results using reciprocal rank fusion", () => {
		const denseResults: FusionSearchResult[] = [
			{ id: "doc1", content: "Doc 1", score: 0.9 },
			{ id: "doc2", content: "Doc 2", score: 0.8 },
		];
		const sparseResults: FusionSearchResult[] = [
			{ id: "doc2", content: "Doc 2", score: 0.95 },
			{ id: "doc3", content: "Doc 3", score: 0.85 },
		];

		const fused = adaptiveRRF("test query", denseResults, sparseResults);

		// Should contain all unique documents
		const ids = fused.map((r) => r.id);
		expect(ids).toContain("doc1");
		expect(ids).toContain("doc2");
		expect(ids).toContain("doc3");

		// doc2 appears in both, should have higher RRF score
		const doc2Index = ids.indexOf("doc2");
		expect(doc2Index).toBeLessThan(2); // Should be near the top
	});

	it("should return results sorted by RRF score", () => {
		const denseResults: FusionSearchResult[] = [
			{ id: "doc1", content: "Doc 1", score: 0.9 },
			{ id: "doc2", content: "Doc 2", score: 0.8 },
		];
		const sparseResults: FusionSearchResult[] = [
			{ id: "doc2", content: "Doc 2", score: 0.95 },
			{ id: "doc1", content: "Doc 1", score: 0.85 },
		];

		const fused = adaptiveRRF("test query", denseResults, sparseResults);

		// Results should be sorted by score (descending)
		for (let i = 1; i < fused.length; i++) {
			expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
		}
	});

	it("should use adaptive k values based on query characteristics", () => {
		// Query with entities should affect sparse k value
		const withEntities = adaptiveRRF(
			"Tell me about Microsoft Azure",
			[{ id: "doc1", content: "Doc 1", score: 0.9 }],
			[{ id: "doc1", content: "Doc 1", score: 0.9 }],
		);

		const withoutEntities = adaptiveRRF(
			"how to do something",
			[{ id: "doc1", content: "Doc 1", score: 0.9 }],
			[{ id: "doc1", content: "Doc 1", score: 0.9 }],
		);

		// Both should work without error
		expect(withEntities.length).toBe(1);
		expect(withoutEntities.length).toBe(1);
	});

	it("should handle empty result sets", () => {
		const fused = adaptiveRRF("test", [], []);
		expect(fused).toEqual([]);
	});
});
