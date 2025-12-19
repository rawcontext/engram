import { describe, expect, it } from "vitest";
import { type MergeStrategy, ScoreMerger } from "./score-merger";

describe("ScoreMerger", () => {
	describe("constructor", () => {
		it("should use rank-based strategy by default", () => {
			const merger = new ScoreMerger();
			expect(merger.getStrategy()).toBe("rank-based");
		});

		it("should accept custom strategy", () => {
			const merger = new ScoreMerger({ strategy: "replace" });
			expect(merger.getStrategy()).toBe("replace");
		});

		it("should use default weights (0.3 RRF, 0.7 reranker)", () => {
			const merger = new ScoreMerger({ strategy: "weighted" });
			expect(merger.getRrfWeight()).toBe(0.3);
			expect(merger.getRerankerWeight()).toBe(0.7);
		});

		it("should accept custom weights", () => {
			const merger = new ScoreMerger({
				strategy: "weighted",
				rrfWeight: 0.4,
				rerankerWeight: 0.6,
			});
			expect(merger.getRrfWeight()).toBe(0.4);
			expect(merger.getRerankerWeight()).toBe(0.6);
		});

		it("should throw error if weighted strategy weights don't sum to 1.0", () => {
			expect(() => {
				new ScoreMerger({
					strategy: "weighted",
					rrfWeight: 0.5,
					rerankerWeight: 0.6, // Sum = 1.1
				});
			}).toThrow("Weights must sum to 1.0");
		});
	});

	describe("merge - empty inputs", () => {
		it("should return empty array for empty RRF results", () => {
			const merger = new ScoreMerger();
			const result = merger.merge([], [{ id: "1", score: 0.9 }]);
			expect(result).toEqual([]);
		});

		it("should return empty array for empty reranked results", () => {
			const merger = new ScoreMerger();
			const result = merger.merge([{ id: "1", rrfScore: 0.5 }], []);
			expect(result).toEqual([]);
		});
	});

	describe("replace strategy", () => {
		const merger = new ScoreMerger({ strategy: "replace" });

		it("should use reranker score as final score", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
				{ id: "doc3", rrfScore: 0.4 },
			];

			const rerankedResults = [
				{ id: "doc3", score: 0.95 }, // Reranked to top
				{ id: "doc1", score: 0.85 },
				{ id: "doc2", score: 0.75 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged).toHaveLength(3);

			// Check first result (doc3)
			expect(merged[0].id).toBe("doc3");
			expect(merged[0].finalScore).toBe(0.95); // Reranker score
			expect(merged[0].rrfScore).toBe(0.4); // Original RRF score
			expect(merged[0].rerankerScore).toBe(0.95);
		});

		it("should calculate rank improvement correctly", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 }, // Rank 0
				{ id: "doc2", rrfScore: 0.6 }, // Rank 1
				{ id: "doc3", rrfScore: 0.4 }, // Rank 2
			];

			const rerankedResults = [
				{ id: "doc3", score: 0.95 }, // New rank 0 (improvement: 2 - 0 = 2)
				{ id: "doc1", score: 0.85 }, // New rank 1 (improvement: 0 - 1 = -1)
				{ id: "doc2", score: 0.75 }, // New rank 2 (improvement: 1 - 2 = -1)
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].rankImprovement).toBe(2); // doc3 moved up 2 positions
			expect(merged[1].rankImprovement).toBe(-1); // doc1 moved down 1 position
			expect(merged[2].rankImprovement).toBe(-1); // doc2 moved down 1 position
		});

		it("should preserve original and new ranks", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: "doc2", score: 0.9 },
				{ id: "doc1", score: 0.7 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].originalRank).toBe(1); // doc2 was at position 1
			expect(merged[0].newRank).toBe(0); // doc2 is now at position 0
			expect(merged[1].originalRank).toBe(0); // doc1 was at position 0
			expect(merged[1].newRank).toBe(1); // doc1 is now at position 1
		});
	});

	describe("weighted strategy", () => {
		const merger = new ScoreMerger({
			strategy: "weighted",
			rrfWeight: 0.4,
			rerankerWeight: 0.6,
		});

		it("should combine RRF and reranker scores with weights", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 1.0 }, // Max RRF
				{ id: "doc2", rrfScore: 0.0 }, // Min RRF
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.0 }, // Min reranker
				{ id: "doc2", score: 1.0 }, // Max reranker
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// Normalized scores:
			// doc1: RRF=1.0 (norm=1.0), Reranker=0.0 (norm=0.0) -> 0.4*1.0 + 0.6*0.0 = 0.4
			// doc2: RRF=0.0 (norm=0.0), Reranker=1.0 (norm=1.0) -> 0.4*0.0 + 0.6*1.0 = 0.6

			expect(merged[0].finalScore).toBeCloseTo(0.6); // doc2 wins
			expect(merged[1].finalScore).toBeCloseTo(0.4); // doc1
		});

		it("should sort results by final score descending", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
				{ id: "doc3", rrfScore: 0.4 },
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.5 },
				{ id: "doc2", score: 0.9 },
				{ id: "doc3", score: 0.7 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// Results should be sorted by finalScore descending
			expect(merged[0].finalScore).toBeGreaterThan(merged[1].finalScore);
			expect(merged[1].finalScore).toBeGreaterThan(merged[2].finalScore);
		});

		it("should update ranks after sorting", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.5 },
				{ id: "doc2", score: 0.9 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// After weighted combination and sorting, ranks should be updated
			expect(merged[0].newRank).toBe(0);
			expect(merged[1].newRank).toBe(1);
		});

		it("should handle identical scores", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.5 },
				{ id: "doc2", rrfScore: 0.5 },
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.5 },
				{ id: "doc2", score: 0.5 },
			];

			// All values are the same, should normalize to 0.5
			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged).toHaveLength(2);
			expect(merged[0].finalScore).toBeCloseTo(0.5);
			expect(merged[1].finalScore).toBeCloseTo(0.5);
		});
	});

	describe("rank-based strategy (recommended)", () => {
		const merger = new ScoreMerger({ strategy: "rank-based" });

		it("should preserve reranker ordering", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
				{ id: "doc3", rrfScore: 0.4 },
			];

			const rerankedResults = [
				{ id: "doc3", score: 0.95 },
				{ id: "doc1", score: 0.85 },
				{ id: "doc2", score: 0.75 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// Order should match rerankedResults exactly
			expect(merged[0].id).toBe("doc3");
			expect(merged[1].id).toBe("doc1");
			expect(merged[2].id).toBe("doc2");
		});

		it("should use reranker score as final score", () => {
			const rrfResults = [{ id: "doc1", rrfScore: 0.5 }];

			const rerankedResults = [{ id: "doc1", score: 0.9 }];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].finalScore).toBe(0.9);
			expect(merged[0].rerankerScore).toBe(0.9);
		});

		it("should preserve both RRF and reranker scores", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: "doc2", score: 0.95 },
				{ id: "doc1", score: 0.85 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// doc2 should have both scores preserved
			expect(merged[0].id).toBe("doc2");
			expect(merged[0].rrfScore).toBe(0.6); // Original RRF
			expect(merged[0].rerankerScore).toBe(0.95); // Reranker
			expect(merged[0].finalScore).toBe(0.95); // Same as reranker

			// doc1 should have both scores preserved
			expect(merged[1].id).toBe("doc1");
			expect(merged[1].rrfScore).toBe(0.8);
			expect(merged[1].rerankerScore).toBe(0.85);
			expect(merged[1].finalScore).toBe(0.85);
		});

		it("should calculate rank improvement", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.9 }, // Rank 0
				{ id: "doc2", rrfScore: 0.5 }, // Rank 1
				{ id: "doc3", rrfScore: 0.3 }, // Rank 2
			];

			const rerankedResults = [
				{ id: "doc3", score: 0.95 }, // New rank 0 (improvement: 2)
				{ id: "doc2", score: 0.85 }, // New rank 1 (improvement: 0)
				{ id: "doc1", score: 0.75 }, // New rank 2 (improvement: -2)
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].rankImprovement).toBe(2); // doc3: 2 - 0 = 2
			expect(merged[1].rankImprovement).toBe(0); // doc2: 1 - 1 = 0
			expect(merged[2].rankImprovement).toBe(-2); // doc1: 0 - 2 = -2
		});
	});

	describe("strategy comparison", () => {
		it("all strategies should handle same input set", () => {
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: "doc2", score: 0.9 },
				{ id: "doc1", score: 0.7 },
			];

			const strategies: MergeStrategy[] = ["replace", "weighted", "rank-based"];

			strategies.forEach((strategy) => {
				const merger = new ScoreMerger({ strategy });
				const merged = merger.merge(rrfResults, rerankedResults);

				expect(merged).toHaveLength(2);
				expect(merged[0]).toHaveProperty("id");
				expect(merged[0]).toHaveProperty("rrfScore");
				expect(merged[0]).toHaveProperty("rerankerScore");
				expect(merged[0]).toHaveProperty("finalScore");
				expect(merged[0]).toHaveProperty("rankImprovement");
			});
		});
	});

	describe("edge cases", () => {
		it("should handle single document", () => {
			const merger = new ScoreMerger();
			const rrfResults = [{ id: "doc1", rrfScore: 0.8 }];
			const rerankedResults = [{ id: "doc1", score: 0.9 }];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged).toHaveLength(1);
			expect(merged[0].id).toBe("doc1");
			expect(merged[0].rrfScore).toBe(0.8);
			expect(merged[0].rerankerScore).toBe(0.9);
		});

		it("should handle mismatched IDs gracefully", () => {
			const merger = new ScoreMerger();
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.8 },
				{ id: "doc2", rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: "doc3", score: 0.9 }, // doc3 not in RRF results
				{ id: "doc1", score: 0.7 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// doc3 should have rrfScore of 0 (default)
			const doc3 = merged.find((r) => r.id === "doc3");
			expect(doc3?.rrfScore).toBe(0);
			expect(doc3?.rankImprovement).toBeUndefined();
		});

		it("should handle numeric IDs", () => {
			const merger = new ScoreMerger();
			const rrfResults = [
				{ id: 1, rrfScore: 0.8 },
				{ id: 2, rrfScore: 0.6 },
			];

			const rerankedResults = [
				{ id: 2, score: 0.9 },
				{ id: 1, score: 0.7 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged).toHaveLength(2);
			expect(merged[0].id).toBe(2);
			expect(merged[1].id).toBe(1);
		});

		it("should handle large score differences", () => {
			const merger = new ScoreMerger({ strategy: "weighted" });
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.001 },
				{ id: "doc2", rrfScore: 0.999 },
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.999 },
				{ id: "doc2", score: 0.001 },
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			// Should normalize and combine properly
			expect(merged).toHaveLength(2);
			expect(merged[0].finalScore).toBeGreaterThan(merged[1].finalScore);
		});
	});

	describe("rank improvement metrics", () => {
		it("should calculate positive improvement for documents moving up", () => {
			const merger = new ScoreMerger();
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.9 }, // Rank 0
				{ id: "doc2", rrfScore: 0.5 }, // Rank 1
			];

			const rerankedResults = [
				{ id: "doc2", score: 0.95 }, // New rank 0
				{ id: "doc1", score: 0.85 }, // New rank 1
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].rankImprovement).toBe(1); // doc2 moved from 1 to 0
			expect(merged[0].rankImprovement).toBeGreaterThan(0);
		});

		it("should calculate negative improvement for documents moving down", () => {
			const merger = new ScoreMerger();
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.9 }, // Rank 0
				{ id: "doc2", rrfScore: 0.5 }, // Rank 1
			];

			const rerankedResults = [
				{ id: "doc2", score: 0.95 }, // New rank 0
				{ id: "doc1", score: 0.85 }, // New rank 1
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[1].rankImprovement).toBe(-1); // doc1 moved from 0 to 1
			expect(merged[1].rankImprovement).toBeLessThan(0);
		});

		it("should calculate zero improvement for unchanged positions", () => {
			const merger = new ScoreMerger();
			const rrfResults = [
				{ id: "doc1", rrfScore: 0.9 },
				{ id: "doc2", rrfScore: 0.5 },
			];

			const rerankedResults = [
				{ id: "doc1", score: 0.95 }, // Stays at rank 0
				{ id: "doc2", score: 0.85 }, // Stays at rank 1
			];

			const merged = merger.merge(rrfResults, rerankedResults);

			expect(merged[0].rankImprovement).toBe(0);
			expect(merged[1].rankImprovement).toBe(0);
		});
	});
});
