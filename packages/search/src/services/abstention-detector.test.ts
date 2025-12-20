import { describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../models/schema";
import {
	AbstentionDetector,
	DEFAULT_ABSTENTION_CONFIG,
	DEFAULT_HEDGING_PATTERNS,
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

	describe("checkHedgingPatterns (Layer 3)", () => {
		it("detects 'I think' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns("I think the answer might be 42.");

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("I think");
		});

		it("detects 'maybe' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns("Maybe the meeting is at 3pm.");

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("Maybe");
		});

		it("detects 'I'm not sure' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns(
				"I'm not sure about this, but the event was in 2020.",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("I'm not sure");
		});

		it("detects 'cannot find' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns(
				"I cannot find any information about that topic.",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("cannot find");
		});

		it("detects 'no information' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns(
				"There is no information available on this subject.",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("no information");
		});

		it("detects 'it seems' hedging pattern", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns("It seems like the project started in January.");

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
			expect(result.details).toContain("It seems");
		});

		it("does not trigger on confident answers", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns("The meeting is scheduled for 3pm on Tuesday.");

			expect(result.shouldAbstain).toBe(false);
			expect(result.confidence).toBe(1.0);
		});

		it("does not trigger on assertive language", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns(
				"The capital of France is Paris. This is a well-known fact.",
			);

			expect(result.shouldAbstain).toBe(false);
		});

		it("allows custom hedging patterns", () => {
			const detector = new AbstentionDetector({
				hedgingPatterns: [/\bprobably\b/i],
			});

			// Custom pattern should trigger
			const result1 = detector.checkHedgingPatterns("It's probably correct.");
			expect(result1.shouldAbstain).toBe(true);

			// Default pattern should not trigger (replaced)
			const result2 = detector.checkHedgingPatterns("I think this is correct.");
			expect(result2.shouldAbstain).toBe(false);
		});

		it("returns 0.8 confidence for hedging detection", () => {
			const detector = new AbstentionDetector();
			const result = detector.checkHedgingPatterns("Perhaps the answer is yes.");

			expect(result.shouldAbstain).toBe(true);
			expect(result.confidence).toBe(0.8);
		});
	});

	describe("DEFAULT_HEDGING_PATTERNS", () => {
		it("includes expected patterns", () => {
			expect(DEFAULT_HEDGING_PATTERNS.length).toBeGreaterThan(5);

			// Verify key patterns exist
			const patternStrings = DEFAULT_HEDGING_PATTERNS.map((p) => p.source);
			expect(patternStrings.some((s) => s.includes("think"))).toBe(true);
			expect(patternStrings.some((s) => s.includes("maybe"))).toBe(true);
			expect(patternStrings.some((s) => s.includes("perhaps"))).toBe(true);
		});
	});

	describe("shouldAbstain (combined check)", () => {
		it("abstains on Layer 1 failure (retrieval)", async () => {
			const detector = new AbstentionDetector({ useNLI: false });
			const results = createResults([0.1]); // Low score

			const result = await detector.shouldAbstain(results, "Some answer", "Some context");

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("low_retrieval_score");
		});

		it("abstains on Layer 3 failure (hedging) when Layer 1 passes", async () => {
			const detector = new AbstentionDetector({ useNLI: false });
			const results = createResults([0.8, 0.4]); // Good retrieval

			const result = await detector.shouldAbstain(
				results,
				"I think the answer is 42.",
				"Context here",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("hedging_detected");
		});

		it("proceeds when all layers pass", async () => {
			const detector = new AbstentionDetector({ useNLI: false });
			const results = createResults([0.85, 0.5]); // Good retrieval

			const result = await detector.shouldAbstain(
				results,
				"The answer is 42.", // Confident answer
				"The document states the answer is 42.",
			);

			expect(result.shouldAbstain).toBe(false);
			expect(result.confidence).toBe(0.85);
		});

		it("skips NLI when disabled", async () => {
			const detector = new AbstentionDetector({ useNLI: false });
			const results = createResults([0.8]);

			// This would fail NLI (answer not grounded) but NLI is disabled
			const result = await detector.shouldAbstain(
				results,
				"The sky is green.", // Hallucinated
				"The document talks about weather patterns.",
			);

			// Should pass Layer 1 and Layer 3 (no hedging)
			expect(result.shouldAbstain).toBe(false);
		});
	});

	describe("checkAnswerGrounding (Layer 2)", () => {
		// Mock the pipeline for NLI tests
		const mockPipeline = vi.fn();

		it("abstains on contradiction", async () => {
			// Create detector with mocked pipeline
			const detector = new AbstentionDetector({ useNLI: true });

			// Mock the pipeline method
			mockPipeline.mockResolvedValueOnce({
				sequence: "test",
				labels: ["contradiction", "neutral", "entailment"],
				scores: [0.85, 0.1, 0.05],
			});

			// Access private method for testing (using type assertion)
			const proto = Object.getPrototypeOf(detector);
			proto.loadNLIPipeline = async () => mockPipeline;

			const result = await detector.checkAnswerGrounding(
				"The capital of France is Berlin.",
				"Paris is the capital of France.",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("not_grounded");
			expect(result.details).toContain("contradiction");
		});

		it("abstains on high-confidence neutral", async () => {
			const detector = new AbstentionDetector({
				useNLI: true,
				nliThreshold: 0.7,
			});

			mockPipeline.mockResolvedValueOnce({
				sequence: "test",
				labels: ["neutral", "entailment", "contradiction"],
				scores: [0.85, 0.1, 0.05],
			});

			const proto = Object.getPrototypeOf(detector);
			proto.loadNLIPipeline = async () => mockPipeline;

			const result = await detector.checkAnswerGrounding(
				"The meeting was productive.",
				"We had a meeting yesterday.",
			);

			expect(result.shouldAbstain).toBe(true);
			expect(result.reason).toBe("not_grounded");
			expect(result.details).toContain("neutral");
		});

		it("proceeds on entailment", async () => {
			const detector = new AbstentionDetector({ useNLI: true });

			mockPipeline.mockResolvedValueOnce({
				sequence: "test",
				labels: ["entailment", "neutral", "contradiction"],
				scores: [0.92, 0.05, 0.03],
			});

			const proto = Object.getPrototypeOf(detector);
			proto.loadNLIPipeline = async () => mockPipeline;

			const result = await detector.checkAnswerGrounding(
				"Paris is the capital.",
				"Paris is the capital of France.",
			);

			expect(result.shouldAbstain).toBe(false);
			expect(result.confidence).toBeCloseTo(0.92);
		});

		it("proceeds on low-confidence neutral", async () => {
			const detector = new AbstentionDetector({
				useNLI: true,
				nliThreshold: 0.7,
			});

			mockPipeline.mockResolvedValueOnce({
				sequence: "test",
				labels: ["neutral", "entailment", "contradiction"],
				scores: [0.5, 0.35, 0.15], // Below threshold
			});

			const proto = Object.getPrototypeOf(detector);
			proto.loadNLIPipeline = async () => mockPipeline;

			const result = await detector.checkAnswerGrounding("Some answer", "Some context");

			expect(result.shouldAbstain).toBe(false);
		});
	});

	describe("NLI configuration", () => {
		it("uses default NLI model", () => {
			const detector = new AbstentionDetector();
			const config = detector.getConfig();

			expect(config.nliModel).toBe("Xenova/nli-deberta-v3-base");
		});

		it("allows custom NLI model", () => {
			const detector = new AbstentionDetector({
				nliModel: "custom/nli-model",
			});
			const config = detector.getConfig();

			expect(config.nliModel).toBe("custom/nli-model");
		});

		it("has NLI disabled by default", () => {
			const detector = new AbstentionDetector();
			const config = detector.getConfig();

			expect(config.useNLI).toBe(false);
		});
	});
});
