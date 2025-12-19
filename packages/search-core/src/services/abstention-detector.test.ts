import { describe, expect, it } from "vitest";
import type { SearchResult } from "../models/schema";
import {
	AbstentionDetector,
	DEFAULT_ABSTENTION_CONFIG,
	type AbstentionConfig,
} from "./abstention-detector";

/**
 * Creates mock search results with specified scores
 */
function createResults(scores: number[]): SearchResult[] {
	return scores.map((score, index) => ({
		id: `doc-${index}`,
		score,
		payload: {
			content: `Test content ${index}`,
			node_id: `node-${index}`,
			session_id: "test-session",
			type: "thought" as const,
			timestamp: Date.now(),
		},
	}));
}

describe("AbstentionDetector", () => {
	describe("constructor", () => {
		it("uses default config when no config provided", () => {
			const detector = new AbstentionDetector();
			const config = detector.getConfig();

			expect(config.minRetrievalScore).toBe(DEFAULT_ABSTENTION_CONFIG.minRetrievalScore);
			expect(config.minScoreGap).toBe(DEFAULT_ABSTENTION_CONFIG.minScoreGap);
			expect(config.gapDetectionThreshold).toBe(DEFAULT_ABSTENTION_CONFIG.gapDetectionThreshold);
		});

		it("merges partial config with defaults", () => {
			const detector = new AbstentionDetector({ minRetrievalScore: 0.5 });
			const config = detector.getConfig();

			expect(config.minRetrievalScore).toBe(0.5);
			expect(config.minScoreGap).toBe(DEFAULT_ABSTENTION_CONFIG.minScoreGap);
		});
	});

	describe("checkRetrievalConfidence", () => {
		describe("no_results", () => {
			it("abstains when no results", () => {
				const detector = new AbstentionDetector();
				const result = detector.checkRetrievalConfidence([]);

				expect(result.shouldAbstain).toBe(true);
				expect(result.reason).toBe("no_results");
				expect(result.confidence).toBe(1.0);
				expect(result.details).toBe("No documents retrieved");
			});
		});

		describe("low_retrieval_score", () => {
			it("abstains when top score below threshold", () => {
				const detector = new AbstentionDetector({ minRetrievalScore: 0.3 });
				const results = createResults([0.2, 0.15, 0.1]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(true);
				expect(result.reason).toBe("low_retrieval_score");
				expect(result.details).toContain("0.200");
				expect(result.details).toContain("threshold 0.3");
			});

			it("does not abstain when top score meets threshold", () => {
				const detector = new AbstentionDetector({ minRetrievalScore: 0.3 });
				const results = createResults([0.6, 0.5, 0.4]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
				expect(result.confidence).toBe(0.6);
			});

			it("does not abstain when top score exactly equals threshold with sufficient gap", () => {
				// Use explicit config to ensure gap check passes (gap 0.2 > minScoreGap 0.1)
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				const results = createResults([0.3, 0.1, 0.05]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
			});
		});

		describe("no_score_gap", () => {
			it("abstains when score gap too small and top score below gap threshold", () => {
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				// Top score 0.4, gap of 0.05 (below 0.1 threshold)
				const results = createResults([0.4, 0.35, 0.3]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(true);
				expect(result.reason).toBe("no_score_gap");
				expect(result.details).toContain("0.050");
			});

			it("does not check gap when top score above gap threshold", () => {
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				// Top score 0.6 (above 0.5 threshold), gap of 0.05
				const results = createResults([0.6, 0.55, 0.5]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
				expect(result.confidence).toBe(0.6);
			});

			it("does not abstain when score gap is sufficient", () => {
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				// Top score 0.45, gap of 0.15 (above 0.1 threshold)
				const results = createResults([0.45, 0.3, 0.2]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
			});

			it("skips gap check with single result", () => {
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				const results = createResults([0.4]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
				expect(result.confidence).toBe(0.4);
			});
		});

		describe("confidence scoring", () => {
			it("returns top score as confidence when not abstaining", () => {
				const detector = new AbstentionDetector();
				const results = createResults([0.85, 0.6, 0.4]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(false);
				expect(result.confidence).toBe(0.85);
			});

			it("returns inverse of top score as confidence for low_retrieval_score", () => {
				const detector = new AbstentionDetector({ minRetrievalScore: 0.5 });
				const results = createResults([0.2, 0.1]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(true);
				expect(result.confidence).toBe(0.8); // 1.0 - 0.2
			});

			it("returns 0.7 confidence for no_score_gap", () => {
				const detector = new AbstentionDetector({
					minRetrievalScore: 0.3,
					minScoreGap: 0.1,
					gapDetectionThreshold: 0.5,
				});
				const results = createResults([0.4, 0.39]);

				const result = detector.checkRetrievalConfidence(results);

				expect(result.shouldAbstain).toBe(true);
				expect(result.reason).toBe("no_score_gap");
				expect(result.confidence).toBe(0.7);
			});
		});
	});

	describe("updateConfig", () => {
		it("updates configuration at runtime", () => {
			const detector = new AbstentionDetector({ minRetrievalScore: 0.3 });
			const results = createResults([0.25]);

			// Should abstain with 0.3 threshold
			expect(detector.checkRetrievalConfidence(results).shouldAbstain).toBe(true);

			// Lower threshold
			detector.updateConfig({ minRetrievalScore: 0.2 });

			// Should not abstain with 0.2 threshold
			expect(detector.checkRetrievalConfidence(results).shouldAbstain).toBe(false);
		});
	});

	describe("real-world scenarios", () => {
		it("handles high-confidence retrieval (clear top result)", () => {
			const detector = new AbstentionDetector();
			// Typical good retrieval: clear winner with high score
			const results = createResults([0.92, 0.65, 0.55, 0.4, 0.35]);

			const result = detector.checkRetrievalConfidence(results);

			expect(result.shouldAbstain).toBe(false);
			expect(result.confidence).toBe(0.92);
		});

		it("handles uncertain retrieval (multiple similar scores)", () => {
			const detector = new AbstentionDetector({
				minRetrievalScore: 0.3,
				minScoreGap: 0.1,
				gapDetectionThreshold: 0.5,
			});
			// Uncertain case: low scores, no clear winner
			const results = createResults([0.42, 0.41, 0.4, 0.38, 0.35]);

			const result = detector.checkRetrievalConfidence(results);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("no_score_gap");
		});

		it("handles poor retrieval (no relevant docs)", () => {
			const detector = new AbstentionDetector({ minRetrievalScore: 0.3 });
			// Poor retrieval: all scores very low
			const results = createResults([0.15, 0.12, 0.08]);

			const result = detector.checkRetrievalConfidence(results);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("low_retrieval_score");
		});

		it("accepts medium confidence with clear winner", () => {
			const detector = new AbstentionDetector({
				minRetrievalScore: 0.3,
				minScoreGap: 0.1,
				gapDetectionThreshold: 0.5,
			});
			// Medium confidence but clear winner: should proceed
			const results = createResults([0.45, 0.25, 0.2]);

			const result = detector.checkRetrievalConfidence(results);

			expect(result.shouldAbstain).toBe(false);
		});
	});
});
