import type { SearchResult } from "../models/schema";

/**
 * Configuration for abstention detection
 */
export interface AbstentionConfig {
	/** Minimum retrieval score to proceed (default: 0.3) */
	minRetrievalScore: number;
	/** Minimum score gap between top results for confident matching (default: 0.1) */
	minScoreGap: number;
	/** Score threshold below which gap detection applies (default: 0.5) */
	gapDetectionThreshold: number;
}

/**
 * Default abstention configuration based on research findings
 * @see https://arxiv.org/html/2509.07475 (HALT-RAG)
 */
export const DEFAULT_ABSTENTION_CONFIG: AbstentionConfig = {
	minRetrievalScore: 0.3,
	minScoreGap: 0.1,
	gapDetectionThreshold: 0.5,
};

/**
 * Reason for abstaining from answering
 */
export type AbstentionReason =
	| "no_results"
	| "low_retrieval_score"
	| "no_score_gap"
	| "not_grounded"
	| "hedging_detected";

/**
 * Result of abstention detection
 */
export interface AbstentionResult {
	/** Whether the system should abstain from answering */
	shouldAbstain: boolean;
	/** Reason for abstention (if applicable) */
	reason?: AbstentionReason;
	/** Confidence score (0-1, higher = more confident in decision) */
	confidence: number;
	/** Human-readable explanation */
	details?: string;
}

/**
 * AbstentionDetector implements Layer 1 of the three-layer abstention system.
 *
 * Layer 1: Retrieval Confidence
 * - Checks if retrieval scores are too low (no relevant documents found)
 * - Checks if score gap is too small (uncertain which document is most relevant)
 *
 * This layer catches obvious cases where the retrieval system couldn't find
 * relevant information, preventing the LLM from hallucinating answers.
 *
 * @example
 * ```typescript
 * const detector = new AbstentionDetector({ minRetrievalScore: 0.3 });
 * const result = detector.checkRetrievalConfidence(searchResults);
 * if (result.shouldAbstain) {
 *   return "I don't have enough information to answer this question.";
 * }
 * ```
 */
export class AbstentionDetector {
	private config: AbstentionConfig;

	constructor(config: Partial<AbstentionConfig> = {}) {
		this.config = { ...DEFAULT_ABSTENTION_CONFIG, ...config };
	}

	/**
	 * Check if retrieval results indicate sufficient confidence to proceed.
	 *
	 * Implements two checks:
	 * 1. **Score threshold**: Top result must exceed minRetrievalScore
	 * 2. **Score gap**: When top score is below gapDetectionThreshold,
	 *    the gap between top two results must exceed minScoreGap
	 *
	 * @param results - Search results with scores (should be sorted by score descending)
	 * @returns AbstentionResult indicating whether to abstain and why
	 */
	checkRetrievalConfidence(results: SearchResult[]): AbstentionResult {
		// No results = abstain
		if (results.length === 0) {
			return {
				shouldAbstain: true,
				reason: "no_results",
				confidence: 1.0,
				details: "No documents retrieved",
			};
		}

		const topScore = results[0].score;

		// Check minimum score threshold
		if (topScore < this.config.minRetrievalScore) {
			return {
				shouldAbstain: true,
				reason: "low_retrieval_score",
				confidence: 1.0 - topScore,
				details: `Top score ${topScore.toFixed(3)} below threshold ${this.config.minRetrievalScore}`,
			};
		}

		// Check score gap for uncertain matches
		// Only applies when top score is below the gap detection threshold
		if (results.length >= 2 && topScore < this.config.gapDetectionThreshold) {
			const scoreGap = topScore - results[1].score;

			if (scoreGap < this.config.minScoreGap) {
				return {
					shouldAbstain: true,
					reason: "no_score_gap",
					confidence: 0.7,
					details: `Score gap ${scoreGap.toFixed(3)} below threshold ${this.config.minScoreGap} (uncertain match)`,
				};
			}
		}

		// Sufficient confidence to proceed
		return {
			shouldAbstain: false,
			confidence: topScore,
		};
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): Readonly<AbstentionConfig> {
		return this.config;
	}

	/**
	 * Update configuration at runtime
	 */
	updateConfig(config: Partial<AbstentionConfig>): void {
		this.config = { ...this.config, ...config };
	}
}
