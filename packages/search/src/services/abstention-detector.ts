import type { SearchResult } from "../models/schema";
import { getDefaultDevice } from "./base-embedder";

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
	/** Use NLI model for answer grounding check (default: false) */
	useNLI: boolean;
	/** NLI entailment threshold - contradiction/neutral scores above this trigger abstention (default: 0.7) */
	nliThreshold: number;
	/** NLI model to use for grounding check */
	nliModel: string;
	/** Patterns that indicate hedging language (default: common hedging phrases) */
	hedgingPatterns: RegExp[];
}

/**
 * Default hedging patterns that indicate uncertainty in answers.
 * Based on common linguistic hedging markers.
 */
export const DEFAULT_HEDGING_PATTERNS: RegExp[] = [
	/\bI('m| am) not sure\b/i,
	/\bI('m| am) uncertain\b/i,
	/\bI don't know\b/i,
	/\bI think\b/i,
	/\bmaybe\b/i,
	/\bpossibly\b/i,
	/\bperhaps\b/i,
	/\bcannot (find|determine|answer)\b/i,
	/\bno (information|data|evidence)\b/i,
	/\bnot (mentioned|specified|stated)\b/i,
	/\bit (seems|appears)\b/i,
	/\bto the best of my knowledge\b/i,
	/\bif I recall correctly\b/i,
];

/**
 * Default abstention configuration based on research findings
 * @see https://arxiv.org/html/2509.07475 (HALT-RAG)
 */
export const DEFAULT_ABSTENTION_CONFIG: AbstentionConfig = {
	minRetrievalScore: 0.3,
	minScoreGap: 0.1,
	gapDetectionThreshold: 0.5,
	useNLI: false,
	nliThreshold: 0.7,
	// DeBERTa-v3 is SOTA for NLI, much better than MobileBERT
	// @see https://huggingface.co/Xenova/nli-deberta-v3-base
	nliModel: "Xenova/nli-deberta-v3-base",
	hedgingPatterns: DEFAULT_HEDGING_PATTERNS,
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
 * Result from NLI zero-shot classification
 */
interface NLIClassificationResult {
	sequence: string;
	labels: string[];
	scores: number[];
}

/**
 * NLI pipeline function type
 */
type NLIPipeline = (
	text: string,
	labels: string[],
	options?: { multi_label?: boolean },
) => Promise<NLIClassificationResult>;

/**
 * AbstentionDetector implements a three-layer abstention system.
 *
 * Layer 1: Retrieval Confidence
 * - Checks if retrieval scores are too low (no relevant documents found)
 * - Checks if score gap is too small (uncertain which document is most relevant)
 *
 * Layer 2: Answer Grounding (NLI)
 * - Uses Natural Language Inference to verify answer is entailed by context
 * - Catches hallucinated answers not supported by retrieved documents
 *
 * Layer 3: Pattern Detection
 * - Detects hedging language patterns in generated answers
 * - Converts implicit uncertainty to explicit abstention
 *
 * @example
 * ```typescript
 * const detector = new AbstentionDetector({ useNLI: true });
 *
 * // Layer 1: Check retrieval confidence
 * const retrievalResult = detector.checkRetrievalConfidence(searchResults);
 *
 * // Layer 2: Check answer grounding (async)
 * const groundingResult = await detector.checkAnswerGrounding(answer, context);
 *
 * // Layer 3: Check hedging patterns
 * const hedgingResult = detector.checkHedgingPatterns(answer);
 *
 * // Combined check
 * const shouldAbstain = await detector.shouldAbstain(searchResults, answer, context);
 * ```
 */
export class AbstentionDetector {
	private config: AbstentionConfig;
	private nliPipeline: NLIPipeline | null = null;
	private nliLoadingPromise: Promise<NLIPipeline> | null = null;

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

	/**
	 * Combined check of all three abstention layers.
	 *
	 * Runs checks in order and returns immediately if any layer triggers abstention:
	 * 1. Retrieval confidence (sync)
	 * 2. Answer grounding via NLI (async, if enabled)
	 * 3. Hedging pattern detection (sync)
	 *
	 * @param results - Search results from retrieval
	 * @param answer - Generated answer text
	 * @param context - Retrieved context used to generate the answer
	 * @returns AbstentionResult indicating whether to abstain and why
	 */
	async shouldAbstain(
		results: SearchResult[],
		answer: string,
		context: string,
	): Promise<AbstentionResult> {
		// Layer 1: Retrieval confidence
		const retrievalCheck = this.checkRetrievalConfidence(results);
		if (retrievalCheck.shouldAbstain) {
			return retrievalCheck;
		}

		// Layer 2: Answer grounding (NLI)
		if (this.config.useNLI) {
			const groundingCheck = await this.checkAnswerGrounding(answer, context);
			if (groundingCheck.shouldAbstain) {
				return groundingCheck;
			}
		}

		// Layer 3: Hedging pattern detection
		const hedgingCheck = this.checkHedgingPatterns(answer);
		if (hedgingCheck.shouldAbstain) {
			return hedgingCheck;
		}

		// All checks passed - sufficient confidence to answer
		return {
			shouldAbstain: false,
			confidence: retrievalCheck.confidence,
		};
	}

	/**
	 * Layer 2: Check if the generated answer is grounded in the context.
	 *
	 * Uses Natural Language Inference (NLI) to classify the relationship
	 * between the context (premise) and answer (hypothesis):
	 * - **entailment**: Answer is supported by context → proceed
	 * - **contradiction**: Answer contradicts context → abstain
	 * - **neutral**: Answer not supported by context → abstain if high confidence
	 *
	 * @param answer - The generated answer to verify
	 * @param context - The retrieved context that should support the answer
	 * @returns AbstentionResult indicating whether the answer is grounded
	 */
	async checkAnswerGrounding(answer: string, context: string): Promise<AbstentionResult> {
		const pipeline = await this.loadNLIPipeline();

		// NLI format: "premise. hypothesis" for zero-shot classification
		// The model classifies whether the hypothesis is entailed by the premise
		// MobileBERT has max 512 tokens, so truncate context to ~1500 chars to leave room for answer
		const maxContextChars = 1500;
		const truncatedContext =
			context.length > maxContextChars ? context.slice(0, maxContextChars) + "..." : context;
		const inputText = `${truncatedContext} ${answer}`;

		const result = await pipeline(inputText, ["entailment", "neutral", "contradiction"]);

		// Find the winning label and its score
		const topLabel = result.labels[0];
		const topScore = result.scores[0];

		// If contradiction or high-confidence neutral, abstain
		if (topLabel === "contradiction") {
			return {
				shouldAbstain: true,
				reason: "not_grounded",
				confidence: topScore,
				details: `Answer contradicts context (contradiction: ${topScore.toFixed(3)})`,
			};
		}

		if (topLabel === "neutral" && topScore > this.config.nliThreshold) {
			return {
				shouldAbstain: true,
				reason: "not_grounded",
				confidence: topScore,
				details: `Answer not supported by context (neutral: ${topScore.toFixed(3)})`,
			};
		}

		// Entailment or low-confidence neutral - proceed
		return {
			shouldAbstain: false,
			confidence: topLabel === "entailment" ? topScore : 1 - topScore,
		};
	}

	/**
	 * Layer 3: Check if the answer contains hedging language patterns.
	 *
	 * Detects phrases that indicate the model is uncertain about its answer,
	 * such as "I think", "maybe", "not sure", etc.
	 *
	 * When hedging is detected, the answer should be converted to an explicit
	 * "I don't know" response rather than returning uncertain information.
	 *
	 * @param answer - The generated answer to check for hedging
	 * @returns AbstentionResult indicating whether hedging was detected
	 */
	checkHedgingPatterns(answer: string): AbstentionResult {
		for (const pattern of this.config.hedgingPatterns) {
			const match = pattern.exec(answer);
			if (match) {
				return {
					shouldAbstain: true,
					reason: "hedging_detected",
					confidence: 0.8,
					details: `Hedging pattern detected: "${match[0]}"`,
				};
			}
		}

		return {
			shouldAbstain: false,
			confidence: 1.0,
		};
	}

	/**
	 * Lazy load the NLI pipeline.
	 * Uses singleton pattern to avoid loading the model multiple times.
	 */
	private async loadNLIPipeline(): Promise<NLIPipeline> {
		// Return cached pipeline if available
		if (this.nliPipeline) {
			return this.nliPipeline;
		}

		// If already loading, wait for the existing promise
		if (this.nliLoadingPromise) {
			return this.nliLoadingPromise;
		}

		// Start loading
		this.nliLoadingPromise = this.initNLIPipeline();

		try {
			this.nliPipeline = await this.nliLoadingPromise;
			return this.nliPipeline;
		} finally {
			this.nliLoadingPromise = null;
		}
	}

	/**
	 * Initialize the NLI pipeline from @huggingface/transformers.
	 */
	private async initNLIPipeline(): Promise<NLIPipeline> {
		const device = getDefaultDevice();
		console.log(
			`[AbstentionDetector] Loading NLI model ${this.config.nliModel} on device=${device}`,
		);
		const transformers = await import("@huggingface/transformers");
		const pipelineFn = transformers.pipeline as (
			task: string,
			model: string,
			options: { device: string },
		) => Promise<NLIPipeline>;
		return pipelineFn("zero-shot-classification", this.config.nliModel, { device });
	}

	/**
	 * Preload the NLI model for faster first inference.
	 * Call this during application startup if NLI is enabled.
	 */
	async preloadNLI(): Promise<void> {
		if (this.config.useNLI) {
			await this.loadNLIPipeline();
		}
	}
}
