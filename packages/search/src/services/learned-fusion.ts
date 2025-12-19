/**
 * Learned fusion for combining dense, sparse, and rerank retrieval results.
 *
 * Uses a trained MLP to predict query-adaptive fusion weights, then applies
 * weighted score combination to produce final rankings.
 *
 * @see docs/plans/retrieval-v2/06-learned-fusion.md
 */

import { FusionWeightPredictor, type FusionWeights } from "./fusion-predictor.js";
import { QueryFeatureExtractor } from "./query-features.js";

/**
 * Search result with relevance score for fusion.
 */
export interface FusionSearchResult {
	/** Document identifier */
	id: string;
	/** Document content */
	content: string;
	/** Relevance score (higher is better) */
	score: number;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Configuration for learned fusion.
 */
export interface LearnedFusionConfig {
	/** Path to the ONNX model file */
	modelPath?: string;
	/** Whether to normalize scores before fusion */
	normalizeScores?: boolean;
	/** Default weights to use when model is unavailable */
	fallbackWeights?: FusionWeights;
}

const DEFAULT_CONFIG: Required<LearnedFusionConfig> = {
	modelPath: "models/fusion_mlp.onnx",
	normalizeScores: true,
	fallbackWeights: { dense: 0.4, sparse: 0.3, rerank: 0.3 },
};

/**
 * Internal structure for tracking scores per document.
 */
interface FusedScore {
	result: FusionSearchResult;
	scores: {
		dense?: number;
		sparse?: number;
		rerank?: number;
	};
}

/**
 * Performs learned fusion of dense, sparse, and rerank retrieval results.
 *
 * Unlike fixed RRF (k=60), this approach uses query-adaptive weights
 * predicted by a trained MLP. This improves accuracy by 1-2% overall
 * and reduces variance across different query types.
 *
 * @example
 * ```typescript
 * const fusion = new LearnedFusion();
 *
 * const query = "Who founded Microsoft in 1975?";
 * const denseResults = await denseRetriever.search(query, 10);
 * const sparseResults = await sparseRetriever.search(query, 10);
 * const rerankResults = await reranker.rerank(query, candidates);
 *
 * const fusedResults = await fusion.fuse(query, denseResults, sparseResults, rerankResults);
 * ```
 */
export class LearnedFusion {
	private featureExtractor: QueryFeatureExtractor;
	private weightPredictor: FusionWeightPredictor;
	private config: Required<LearnedFusionConfig>;

	constructor(config: LearnedFusionConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.featureExtractor = new QueryFeatureExtractor();
		this.weightPredictor = new FusionWeightPredictor({
			modelPath: this.config.modelPath,
			fallbackWeights: this.config.fallbackWeights,
		});
	}

	/**
	 * Fuse results from dense, sparse, and optional rerank stages.
	 *
	 * @param query - The search query
	 * @param denseResults - Results from dense (semantic) retrieval
	 * @param sparseResults - Results from sparse (keyword) retrieval
	 * @param rerankResults - Optional results from reranking stage
	 * @returns Fused and re-ranked results
	 */
	async fuse(
		query: string,
		denseResults: FusionSearchResult[],
		sparseResults: FusionSearchResult[],
		rerankResults?: FusionSearchResult[],
	): Promise<FusionSearchResult[]> {
		// Extract query features and predict weights
		const features = this.featureExtractor.extract(query);
		const weights = await this.weightPredictor.predict(features);

		// Build score map across all result sets
		const scoreMap = new Map<string, FusedScore>();

		// Normalize scores if configured
		const normDense = this.config.normalizeScores
			? this.normalizeScores(denseResults)
			: denseResults;
		const normSparse = this.config.normalizeScores
			? this.normalizeScores(sparseResults)
			: sparseResults;
		const normRerank = rerankResults
			? this.config.normalizeScores
				? this.normalizeScores(rerankResults)
				: rerankResults
			: undefined;

		// Add dense scores
		for (const result of normDense) {
			const existing = scoreMap.get(result.id) ?? { result, scores: {} };
			existing.scores.dense = result.score;
			scoreMap.set(result.id, existing);
		}

		// Add sparse scores
		for (const result of normSparse) {
			const existing = scoreMap.get(result.id) ?? { result, scores: {} };
			existing.scores.sparse = result.score;
			scoreMap.set(result.id, existing);
		}

		// Add rerank scores (only for documents already retrieved)
		if (normRerank) {
			for (const result of normRerank) {
				const existing = scoreMap.get(result.id);
				if (existing) {
					existing.scores.rerank = result.score;
				}
			}
		}

		// Calculate weighted fusion scores
		const fused = Array.from(scoreMap.values()).map(({ result, scores }) => {
			// Apply weights with zero for missing scores
			const finalScore =
				(scores.dense ?? 0) * weights.dense +
				(scores.sparse ?? 0) * weights.sparse +
				(scores.rerank ?? 0) * weights.rerank;

			return { ...result, score: finalScore };
		});

		// Sort by fused score (descending)
		return fused.sort((a, b) => b.score - a.score);
	}

	/**
	 * Fuse results with explicit weights (for testing or override).
	 *
	 * @param weights - Explicit fusion weights to use
	 * @param denseResults - Dense retrieval results
	 * @param sparseResults - Sparse retrieval results
	 * @param rerankResults - Optional rerank results
	 * @returns Fused results
	 */
	fuseWithWeights(
		weights: FusionWeights,
		denseResults: FusionSearchResult[],
		sparseResults: FusionSearchResult[],
		rerankResults?: FusionSearchResult[],
	): FusionSearchResult[] {
		const scoreMap = new Map<string, FusedScore>();

		const normDense = this.config.normalizeScores
			? this.normalizeScores(denseResults)
			: denseResults;
		const normSparse = this.config.normalizeScores
			? this.normalizeScores(sparseResults)
			: sparseResults;
		const normRerank = rerankResults
			? this.config.normalizeScores
				? this.normalizeScores(rerankResults)
				: rerankResults
			: undefined;

		for (const result of normDense) {
			const existing = scoreMap.get(result.id) ?? { result, scores: {} };
			existing.scores.dense = result.score;
			scoreMap.set(result.id, existing);
		}

		for (const result of normSparse) {
			const existing = scoreMap.get(result.id) ?? { result, scores: {} };
			existing.scores.sparse = result.score;
			scoreMap.set(result.id, existing);
		}

		if (normRerank) {
			for (const result of normRerank) {
				const existing = scoreMap.get(result.id);
				if (existing) {
					existing.scores.rerank = result.score;
				}
			}
		}

		const fused = Array.from(scoreMap.values()).map(({ result, scores }) => {
			const finalScore =
				(scores.dense ?? 0) * weights.dense +
				(scores.sparse ?? 0) * weights.sparse +
				(scores.rerank ?? 0) * weights.rerank;

			return { ...result, score: finalScore };
		});

		return fused.sort((a, b) => b.score - a.score);
	}

	/**
	 * Get the predicted weights for a query (useful for debugging).
	 *
	 * @param query - The search query
	 * @returns Predicted fusion weights
	 */
	async getWeights(query: string): Promise<FusionWeights> {
		return this.weightPredictor.predictFromQuery(query);
	}

	/**
	 * Check if the learned model is available.
	 */
	async isModelAvailable(): Promise<boolean> {
		return this.weightPredictor.isAvailable();
	}

	/**
	 * Normalize scores to 0-1 range using min-max normalization.
	 */
	private normalizeScores(results: FusionSearchResult[]): FusionSearchResult[] {
		if (results.length === 0) return [];

		const scores = results.map((r) => r.score);
		const min = Math.min(...scores);
		const max = Math.max(...scores);
		const range = max - min;

		if (range === 0) {
			// All scores are the same, normalize to 0.5
			return results.map((r) => ({ ...r, score: 0.5 }));
		}

		return results.map((r) => ({
			...r,
			score: (r.score - min) / range,
		}));
	}

	/**
	 * Release resources.
	 */
	async close(): Promise<void> {
		await this.weightPredictor.close();
	}
}

/**
 * Adaptive RRF as a simpler alternative to learned fusion.
 *
 * Adjusts the RRF k parameter based on query characteristics.
 * Use this when the learned model is not available.
 *
 * @param query - The search query
 * @param denseResults - Dense retrieval results
 * @param sparseResults - Sparse retrieval results
 * @returns RRF-fused results
 */
export function adaptiveRRF(
	query: string,
	denseResults: FusionSearchResult[],
	sparseResults: FusionSearchResult[],
): FusionSearchResult[] {
	// Determine k based on query characteristics
	const hasEntities = /[A-Z][a-z]+/.test(query);
	const isKeywordHeavy = query.split(" ").length <= 4;

	// Higher k = more weight to lower-ranked results
	// Keyword queries benefit from sparse, use lower k for sparse
	const kDense = 60;
	const kSparse = hasEntities || isKeywordHeavy ? 30 : 60;

	// Build RRF score map
	const scoreMap = new Map<string, { result: FusionSearchResult; rrfScore: number }>();

	for (let rank = 0; rank < denseResults.length; rank++) {
		const result = denseResults[rank];
		const rrfScore = 1 / (kDense + rank + 1);

		const existing = scoreMap.get(result.id);
		if (existing) {
			existing.rrfScore += rrfScore;
		} else {
			scoreMap.set(result.id, { result, rrfScore });
		}
	}

	for (let rank = 0; rank < sparseResults.length; rank++) {
		const result = sparseResults[rank];
		const rrfScore = 1 / (kSparse + rank + 1);

		const existing = scoreMap.get(result.id);
		if (existing) {
			existing.rrfScore += rrfScore;
		} else {
			scoreMap.set(result.id, { result, rrfScore });
		}
	}

	// Sort by RRF score
	const fused = Array.from(scoreMap.values())
		.sort((a, b) => b.rrfScore - a.rrfScore)
		.map((s) => ({ ...s.result, score: s.rrfScore }));

	return fused;
}
