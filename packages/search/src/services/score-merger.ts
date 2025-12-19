import { createLogger } from "@engram/logger";

/**
 * Merged result containing both RRF and reranker scores with metadata.
 */
export interface MergedResult {
	/** Document identifier */
	id: string | number;

	/** Original RRF/dense/sparse score before reranking */
	rrfScore: number;

	/** Cross-encoder relevance score from reranker (0-1) */
	rerankerScore: number;

	/** Final score used for sorting (determined by merge strategy) */
	finalScore: number;

	/** Position change after reranking (positive = moved up, negative = moved down) */
	rankImprovement?: number;

	/** Original position before reranking (0-indexed) */
	originalRank?: number;

	/** New position after reranking (0-indexed) */
	newRank?: number;
}

/**
 * Score merging strategy:
 * - replace: Use reranker score as final score (simple replacement)
 * - weighted: Combine RRF and reranker scores with configurable weights
 * - rank-based: Use reranker ordering, preserve both scores (recommended)
 */
export type MergeStrategy = "replace" | "weighted" | "rank-based";

/**
 * Configuration options for the ScoreMerger.
 */
export interface ScoreMergerOptions {
	/** Merge strategy to use. Default: 'rank-based' */
	strategy?: MergeStrategy;

	/** Weight for RRF score in weighted strategy (0-1). Default: 0.3 */
	rrfWeight?: number;

	/** Weight for reranker score in weighted strategy (0-1). Default: 0.7 */
	rerankerWeight?: number;
}

/**
 * ScoreMerger combines RRF retrieval scores with reranker scores.
 *
 * This class implements three merging strategies:
 * 1. Replace: Simple replacement with reranker score
 * 2. Weighted: Configurable weighted combination
 * 3. Rank-based: Reranker ordering with both scores preserved (recommended)
 *
 * The rank-based strategy is recommended for transparency, preserving both
 * the original retrieval score and the reranker score for debugging/analysis.
 */
export class ScoreMerger {
	private strategy: MergeStrategy;
	private rrfWeight: number;
	private rerankerWeight: number;
	private logger = createLogger({ component: "ScoreMerger" });

	constructor(options: ScoreMergerOptions = {}) {
		this.strategy = options.strategy ?? "rank-based";
		this.rrfWeight = options.rrfWeight ?? 0.3;
		this.rerankerWeight = options.rerankerWeight ?? 0.7;

		// Validate weights sum to 1.0 for weighted strategy
		if (this.strategy === "weighted") {
			const weightSum = this.rrfWeight + this.rerankerWeight;
			if (Math.abs(weightSum - 1.0) > 0.001) {
				throw new Error(
					`Weights must sum to 1.0 for weighted strategy (got ${weightSum}). ` +
						`rrfWeight=${this.rrfWeight}, rerankerWeight=${this.rerankerWeight}`,
				);
			}
		}

		this.logger.debug({
			msg: "ScoreMerger initialized",
			strategy: this.strategy,
			rrfWeight: this.rrfWeight,
			rerankerWeight: this.rerankerWeight,
		});
	}

	/**
	 * Merge RRF results with reranker scores.
	 *
	 * @param rrfResults - Original RRF-scored results (in retrieval order)
	 * @param rerankedResults - Results after reranking with new scores (in reranked order)
	 * @returns Merged results with both scores preserved, sorted by final score
	 */
	merge(
		rrfResults: Array<{ id: string | number; rrfScore: number }>,
		rerankedResults: Array<{ id: string | number; score: number }>,
	): MergedResult[] {
		if (rrfResults.length === 0 || rerankedResults.length === 0) {
			this.logger.warn({
				msg: "Empty input to merge",
				rrfCount: rrfResults.length,
				rerankedCount: rerankedResults.length,
			});
			return [];
		}

		// Route to appropriate strategy
		let merged: MergedResult[];
		switch (this.strategy) {
			case "replace":
				merged = this.replaceStrategy(rrfResults, rerankedResults);
				break;
			case "weighted":
				merged = this.weightedStrategy(rrfResults, rerankedResults);
				break;
			case "rank-based":
				merged = this.rankBasedStrategy(rrfResults, rerankedResults);
				break;
			default:
				throw new Error(`Unknown merge strategy: ${this.strategy}`);
		}

		this.logger.debug({
			msg: "Score merge completed",
			strategy: this.strategy,
			inputCount: rrfResults.length,
			outputCount: merged.length,
			avgRankImprovement: this.calculateAvgRankImprovement(merged),
		});

		return merged;
	}

	/**
	 * Replace strategy: Use reranker score as final score.
	 * Simple and direct - reranker score completely replaces RRF score.
	 */
	private replaceStrategy(
		rrfResults: Array<{ id: string | number; rrfScore: number }>,
		rerankedResults: Array<{ id: string | number; score: number }>,
	): MergedResult[] {
		// Create lookup map for RRF scores and original ranks
		const rrfMap = new Map(
			rrfResults.map((r, index) => [String(r.id), { rrfScore: r.rrfScore, originalRank: index }]),
		);

		// Map reranked results, preserving order
		return rerankedResults.map((r, newRank) => {
			const rrfData = rrfMap.get(String(r.id));
			const originalRank = rrfData?.originalRank ?? -1;
			const rrfScore = rrfData?.rrfScore ?? 0;

			return {
				id: r.id,
				rrfScore,
				rerankerScore: r.score,
				finalScore: r.score, // Use reranker score directly
				originalRank,
				newRank,
				rankImprovement: originalRank >= 0 ? originalRank - newRank : undefined,
			};
		});
	}

	/**
	 * Weighted strategy: Combine RRF and reranker scores with configurable weights.
	 * Allows tuning the balance between retrieval and reranker signals.
	 */
	private weightedStrategy(
		rrfResults: Array<{ id: string | number; rrfScore: number }>,
		rerankedResults: Array<{ id: string | number; score: number }>,
	): MergedResult[] {
		// Create lookup map for RRF scores and original ranks
		const rrfMap = new Map(
			rrfResults.map((r, index) => [String(r.id), { rrfScore: r.rrfScore, originalRank: index }]),
		);

		// Normalize scores to 0-1 range before weighting
		const rrfScores = rrfResults.map((r) => r.rrfScore);
		const rerankerScores = rerankedResults.map((r) => r.score);

		const { min: rrfMin, max: rrfMax } = this.getMinMax(rrfScores);
		const { min: rerankerMin, max: rerankerMax } = this.getMinMax(rerankerScores);

		// Map and combine scores
		const merged = rerankedResults.map((r) => {
			const rrfData = rrfMap.get(String(r.id));
			const originalRank = rrfData?.originalRank ?? -1;
			const rrfScore = rrfData?.rrfScore ?? 0;

			// Normalize both scores to 0-1
			const normalizedRrf = this.normalize(rrfScore, rrfMin, rrfMax);
			const normalizedReranker = this.normalize(r.score, rerankerMin, rerankerMax);

			// Weighted combination
			const finalScore = this.rrfWeight * normalizedRrf + this.rerankerWeight * normalizedReranker;

			return {
				id: r.id,
				rrfScore,
				rerankerScore: r.score,
				finalScore,
				originalRank: originalRank >= 0 ? originalRank : undefined,
				newRank: undefined, // Will be set after sorting
				rankImprovement: undefined, // Will be calculated after sorting
			};
		});

		// Sort by final score descending
		merged.sort((a, b) => b.finalScore - a.finalScore);

		// Update ranks and calculate improvements
		return merged.map((result, newRank) => ({
			...result,
			newRank,
			rankImprovement:
				result.originalRank !== undefined && result.originalRank >= 0
					? result.originalRank - newRank
					: undefined,
		}));
	}

	/**
	 * Rank-based strategy (RECOMMENDED): Use reranker ordering, preserve both scores.
	 * This strategy trusts the reranker's ordering completely while maintaining
	 * transparency by preserving both the original RRF score and reranker score.
	 */
	private rankBasedStrategy(
		rrfResults: Array<{ id: string | number; rrfScore: number }>,
		rerankedResults: Array<{ id: string | number; score: number }>,
	): MergedResult[] {
		// Create lookup map for RRF scores and original ranks
		const rrfMap = new Map(
			rrfResults.map((r, index) => [String(r.id), { rrfScore: r.rrfScore, originalRank: index }]),
		);

		// Use reranker ordering directly
		// Final score = reranker score (for consistency)
		return rerankedResults.map((r, newRank) => {
			const rrfData = rrfMap.get(String(r.id));
			const originalRank = rrfData?.originalRank ?? -1;
			const rrfScore = rrfData?.rrfScore ?? 0;

			return {
				id: r.id,
				rrfScore,
				rerankerScore: r.score,
				finalScore: r.score, // Use reranker score for final ordering
				originalRank,
				newRank,
				rankImprovement: originalRank >= 0 ? originalRank - newRank : undefined,
			};
		});
	}

	/**
	 * Normalize a value to 0-1 range using min-max normalization.
	 */
	private normalize(value: number, min: number, max: number): number {
		if (max === min) {
			return 0.5; // All values are the same
		}
		return (value - min) / (max - min);
	}

	/**
	 * Get min and max values from an array.
	 */
	private getMinMax(values: number[]): { min: number; max: number } {
		if (values.length === 0) {
			return { min: 0, max: 1 };
		}
		return {
			min: Math.min(...values),
			max: Math.max(...values),
		};
	}

	/**
	 * Calculate average rank improvement across all results.
	 */
	private calculateAvgRankImprovement(results: MergedResult[]): number | undefined {
		const improvements = results
			.map((r) => r.rankImprovement)
			.filter((imp): imp is number => imp !== undefined);

		if (improvements.length === 0) {
			return undefined;
		}

		return improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
	}

	/**
	 * Get the current merge strategy.
	 */
	getStrategy(): MergeStrategy {
		return this.strategy;
	}

	/**
	 * Get the RRF weight (for weighted strategy).
	 */
	getRrfWeight(): number {
		return this.rrfWeight;
	}

	/**
	 * Get the reranker weight (for weighted strategy).
	 */
	getRerankerWeight(): number {
		return this.rerankerWeight;
	}
}
