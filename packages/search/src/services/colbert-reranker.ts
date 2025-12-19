import { createLogger } from "@engram/logger";
import type { BatchedRerankResult } from "./batched-reranker";
import type { ColBERTEmbedder } from "./colbert-embedder";

/**
 * CachedDocumentCandidate extends the base DocumentCandidate with optional
 * pre-computed ColBERT embeddings for efficiency.
 */
export interface CachedDocumentCandidate {
	id: string | number;
	content: string;
	/** Pre-computed token embeddings from Qdrant multivector field */
	colbertEmbeddings?: Float32Array[];
	/** Original retrieval score (RRF/dense/sparse) */
	score?: number;
}

/**
 * ColBERTReranker implements late interaction reranking using MaxSim algorithm.
 *
 * Late Interaction Architecture:
 * 1. Documents: Token embeddings pre-computed at index time
 * 2. Queries: Token embeddings computed at search time
 * 3. Scoring: MaxSim algorithm - for each query token, find max similarity
 *    with all document tokens, then sum these max scores
 *
 * Performance:
 * - ~20ms for 30 docs (with precomputed embeddings)
 * - 180x fewer FLOPs than cross-encoders at k=10
 * - Billion-scale efficiency via precomputation
 *
 * Model: jinaai/jina-colbert-v2 (559M, 89 languages, 128d tokens)
 */
export class ColBERTReranker {
	private logger = createLogger({ component: "ColBERTReranker" });

	constructor(private embedder: ColBERTEmbedder) {}

	/**
	 * Rerank documents using MaxSim late interaction scoring.
	 *
	 * MaxSim Algorithm:
	 * 1. For each query token vector q_i:
	 *    - Compute cosine similarity with every document token d_j
	 *    - Keep only the maximum similarity: max_j(sim(q_i, d_j))
	 * 2. Sum all query token max scores: score = Σ_i max_j(sim(q_i, d_j))
	 *
	 * @param query - Search query text
	 * @param candidates - Documents to rerank (with optional cached embeddings)
	 * @param topK - Number of top results to return
	 * @returns Reranked results sorted by MaxSim score
	 */
	async rerank(
		query: string,
		candidates: CachedDocumentCandidate[],
		topK: number = 10,
	): Promise<BatchedRerankResult[]> {
		if (candidates.length === 0) {
			return [];
		}

		const startTime = Date.now();

		this.logger.info({
			msg: "ColBERT rerank started",
			candidateCount: candidates.length,
			topK,
			queryLength: query.length,
		});

		try {
			// Encode query tokens
			const queryTokens = await this.embedder.encodeQuery(query);

			this.logger.debug({
				msg: "Query tokens encoded",
				queryTokenCount: queryTokens.length,
			});

			// Score all candidates
			const results: BatchedRerankResult[] = [];

			for (let i = 0; i < candidates.length; i++) {
				const candidate = candidates[i];

				try {
					// Get or compute document token embeddings
					let docTokens: Float32Array[];

					if (candidate.colbertEmbeddings) {
						// Use cached embeddings from Qdrant
						docTokens = candidate.colbertEmbeddings;
					} else {
						// Compute embeddings on-the-fly (slower path)
						this.logger.debug({
							msg: "Computing embeddings on-the-fly for document",
							docId: candidate.id,
						});
						docTokens = await this.embedder.encodeDocument(candidate.content);
					}

					// Compute MaxSim score
					const maxSimScore = this.computeMaxSim(queryTokens, docTokens);

					results.push({
						id: candidate.id,
						score: maxSimScore,
						originalIndex: i,
						originalScore: candidate.score,
					});
				} catch (error) {
					// On error, assign minimum score to push to bottom
					this.logger.warn({
						msg: "Failed to score document",
						docId: candidate.id,
						error: error instanceof Error ? error.message : String(error),
					});

					results.push({
						id: candidate.id,
						score: 0,
						originalIndex: i,
						originalScore: candidate.score,
					});
				}
			}

			// Sort by score descending and take top K
			results.sort((a, b) => b.score - a.score);
			const topResults = results.slice(0, topK);

			// Calculate statistics
			const scores = topResults.map((r) => r.score);
			const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
			const maxScore = Math.max(...scores);
			const minScore = Math.min(...scores);

			// Calculate score improvement if original scores exist
			let scoreImprovement: number | undefined;
			const hasOriginalScores = topResults.every((r) => r.originalScore !== undefined);
			if (hasOriginalScores) {
				const originalAvg =
					topResults.reduce((sum, r) => sum + (r.originalScore ?? 0), 0) / topResults.length;
				scoreImprovement = avgScore - originalAvg;
			}

			const latencyMs = Date.now() - startTime;

			this.logger.info({
				msg: "ColBERT rerank completed",
				candidateCount: candidates.length,
				topK,
				latencyMs,
				avgScore: avgScore.toFixed(3),
				maxScore: maxScore.toFixed(3),
				minScore: minScore.toFixed(3),
				scoreImprovement: scoreImprovement?.toFixed(3),
			});

			return topResults;
		} catch (error) {
			const latencyMs = Date.now() - startTime;

			this.logger.error({
				msg: "ColBERT rerank failed",
				candidateCount: candidates.length,
				latencyMs,
				error: error instanceof Error ? error.message : String(error),
			});

			throw error;
		}
	}

	/**
	 * Compute MaxSim score between query and document tokens.
	 *
	 * MaxSim Algorithm:
	 * - For each query token: find max cosine similarity with all doc tokens
	 * - Sum all query token max scores
	 *
	 * @param queryTokens - Query token embeddings (q x 128)
	 * @param docTokens - Document token embeddings (d x 128)
	 * @returns MaxSim relevance score
	 */
	private computeMaxSim(queryTokens: Float32Array[], docTokens: Float32Array[]): number {
		let totalScore = 0;

		// For each query token
		for (const queryToken of queryTokens) {
			let maxSim = -Infinity;

			// Find maximum similarity with all document tokens
			for (const docToken of docTokens) {
				const sim = this.cosineSimilarity(queryToken, docToken);
				if (sim > maxSim) {
					maxSim = sim;
				}
			}

			// Sum the max similarity for this query token
			totalScore += maxSim;
		}

		return totalScore;
	}

	/**
	 * Compute cosine similarity between two normalized vectors.
	 * Since ColBERT embeddings are normalized, this is just the dot product.
	 *
	 * @param a - First vector (normalized)
	 * @param b - Second vector (normalized)
	 * @returns Cosine similarity [-1, 1]
	 */
	private cosineSimilarity(a: Float32Array, b: Float32Array): number {
		let dotProduct = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
		}

		return dotProduct;
	}

	/**
	 * Preload the ColBERT model for faster first use.
	 */
	async warmup(): Promise<void> {
		await this.embedder.preload();
	}
}
