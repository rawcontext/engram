import { createXai } from "@ai-sdk/xai";
import { createLogger } from "@engram/logger";
import { generateObject } from "ai";
import { z } from "zod";
import type { BatchedRerankResult, DocumentCandidate } from "./batched-reranker";
import { RateLimiter } from "./rate-limiter";
import { recordRerankMetrics } from "./reranker-metrics";

/**
 * System prompt for LLM reranking.
 *
 * Instructs the model to act as a search relevance expert and rank documents
 * by relevance to the query.
 */
const RERANK_SYSTEM_PROMPT = `You are a search relevance expert. Given a query and a list of candidate documents, rank them by relevance.

Rules:
- Consider semantic relevance, not just keyword matching
- For code queries, prioritize functional correctness over style
- For technical queries, prioritize accuracy and completeness
- For conceptual queries, prioritize clarity and comprehensiveness
- Return ONLY a JSON array of document indices, most relevant first
- Example: [3, 1, 5, 2, 4] means doc 3 is most relevant, then doc 1, etc.
- The indices are 0-based and correspond to the order of candidates provided`;

/**
 * User prompt template for LLM reranking.
 *
 * Formats the query and candidates into a prompt for the model.
 */
function buildUserPrompt(query: string, candidates: DocumentCandidate[]): string {
	const candidateList = candidates
		.map((doc, idx) => {
			const preview = doc.content.slice(0, 500); // First 500 chars
			return `[${idx}] ${preview}${doc.content.length > 500 ? "..." : ""}`;
		})
		.join("\n\n");

	return `Query: ${query}

Candidates:
${candidateList}

Return the ranking as a JSON array of indices (0-based), most relevant first.`;
}

/**
 * Zod schema for validating LLM ranking output.
 */
const RankingSchema = z.object({
	ranking: z.array(z.number().int().nonnegative()),
});

export interface LLMRerankerOptions {
	/** Model to use - defaults to grok-3-fast */
	model?: string;
	/** Maximum candidates to send to LLM (context efficiency) - defaults to 10 */
	maxCandidates?: number;
	/** Custom system prompt for ranking instructions */
	systemPrompt?: string;
	/** xAI API key - defaults to XAI_API_KEY env var */
	apiKey?: string;
	/** Enable rate limiting - defaults to true */
	enableRateLimiting?: boolean;
	/** Rate limiter configuration */
	rateLimiter?: RateLimiter;
}

/**
 * LLM-based listwise reranker using Grok for premium queries.
 *
 * Advantages over pointwise rerankers:
 * - Sees all candidates in context
 * - Can make relative comparisons
 * - Better for complex reasoning queries
 *
 * Reserved for premium tier due to cost/latency.
 *
 * @example
 * ```ts
 * const reranker = new LLMListwiseReranker({ apiKey: "..." });
 * const results = await reranker.rerank(
 *   "How to implement OAuth2?",
 *   candidates,
 *   5
 * );
 * ```
 */
export class LLMListwiseReranker {
	private xai: ReturnType<typeof createXai>;
	private model: string;
	private maxCandidates: number;
	private systemPrompt: string;
	private logger = createLogger({ component: "LLMListwiseReranker" });
	private rateLimiter?: RateLimiter;
	private enableRateLimiting: boolean;
	private totalCostCents = 0;
	private totalTokens = 0;

	constructor(options: LLMRerankerOptions = {}) {
		this.model = options.model ?? "grok-3-fast";
		this.maxCandidates = options.maxCandidates ?? 10;
		this.systemPrompt = options.systemPrompt ?? RERANK_SYSTEM_PROMPT;
		this.enableRateLimiting = options.enableRateLimiting ?? true;

		this.xai = createXai({
			apiKey: options.apiKey,
		});

		this.rateLimiter = options.rateLimiter;

		// Create default rate limiter if not provided and rate limiting is enabled
		if (this.enableRateLimiting && !this.rateLimiter) {
			this.rateLimiter = new RateLimiter();
		}
	}

	/**
	 * Rerank documents using LLM listwise comparison.
	 *
	 * @param query - The search query
	 * @param candidates - Candidate documents to rerank
	 * @param topK - Number of top results to return
	 * @param userId - Optional user ID for rate limiting (defaults to "anonymous")
	 * @returns Reranked results sorted by relevance score
	 */
	async rerank(
		query: string,
		candidates: DocumentCandidate[],
		topK: number = 10,
		userId: string = "anonymous",
	): Promise<BatchedRerankResult[]> {
		if (candidates.length === 0) {
			return [];
		}

		const startTime = Date.now();
		const candidateCount = candidates.length;

		this.logger.info({
			msg: "LLM rerank started",
			tier: "llm",
			model: this.model,
			candidateCount,
			topK,
			queryLength: query.length,
			userId,
		});

		try {
			// Check rate limit
			if (this.enableRateLimiting && this.rateLimiter) {
				const limitCheck = this.rateLimiter.checkLimit(userId, "llm");

				if (!limitCheck.allowed) {
					const error = new Error(
						`Rate limit exceeded: ${limitCheck.reason ?? "Too many requests"}`,
					);
					this.logger.warn({
						msg: "LLM rerank rate limited",
						userId,
						tier: "llm",
						reason: limitCheck.reason,
						resetAt: limitCheck.resetAt,
					});
					throw error;
				}

				this.logger.debug({
					msg: "Rate limit check passed",
					userId,
					remaining: limitCheck.remaining,
					resetAt: limitCheck.resetAt,
				});
			}

			// Limit candidates to maxCandidates for context efficiency
			const limitedCandidates = candidates.slice(0, this.maxCandidates);

			if (limitedCandidates.length < candidates.length) {
				this.logger.debug({
					msg: "Candidates limited for LLM context",
					originalCount: candidates.length,
					limitedCount: limitedCandidates.length,
					maxCandidates: this.maxCandidates,
				});
			}

			// Build prompt
			const userPrompt = buildUserPrompt(query, limitedCandidates);

			// Call LLM to get ranking using AI SDK
			const { object, usage } = await generateObject({
				model: this.xai(this.model),
				schema: RankingSchema,
				system: this.systemPrompt,
				prompt: userPrompt,
			});

			const ranking = object.ranking;

			// Track usage and cost
			if (usage) {
				this.totalTokens += usage.totalTokens ?? 0;
				// Cost estimation for grok-3-fast (example rates)
				// Input: $5/1M tokens, Output: $15/1M tokens
				const inputTokens = usage.inputTokens ?? 0;
				const outputTokens = usage.outputTokens ?? 0;
				const costCents = (inputTokens / 1_000_000) * 500 + (outputTokens / 1_000_000) * 1500;
				this.totalCostCents += costCents;
			}

			// Validate ranking indices
			this.validateRanking(ranking, limitedCandidates.length);

			// Record request for rate limiting
			if (this.enableRateLimiting && this.rateLimiter) {
				this.rateLimiter.recordRequest(userId, "llm", this.totalCostCents);
			}

			// Convert ranking to rerank results
			const results = this.rankingToResults(ranking, limitedCandidates, topK);

			// Calculate metrics
			const scores = results.map((r) => r.score);
			const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
			const maxScore = Math.max(...scores);
			const minScore = Math.min(...scores);

			// Calculate score improvement if original scores exist
			let scoreImprovement: number | undefined;
			const hasOriginalScores = results.every((r) => r.originalScore !== undefined);
			if (hasOriginalScores) {
				const originalAvg =
					results.reduce((sum, r) => sum + (r.originalScore ?? 0), 0) / results.length;
				scoreImprovement = avgScore - originalAvg;
			}

			const latencyMs = Date.now() - startTime;
			const latencySeconds = latencyMs / 1000;

			this.logger.info({
				msg: "LLM rerank completed",
				tier: "llm",
				model: this.model,
				candidateCount,
				topK,
				latencyMs,
				avgScore: avgScore.toFixed(3),
				maxScore: maxScore.toFixed(3),
				minScore: minScore.toFixed(3),
				scoreImprovement: scoreImprovement?.toFixed(3),
				totalCostCents: this.totalCostCents.toFixed(4),
				totalTokens: this.totalTokens,
			});

			// Record metrics
			recordRerankMetrics({
				tier: "llm",
				model: this.model,
				latencySeconds,
				candidateCount,
				scoreImprovement,
				status: "success",
			});

			return results;
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			const latencySeconds = latencyMs / 1000;

			this.logger.error({
				msg: "LLM rerank failed",
				tier: "llm",
				model: this.model,
				candidateCount,
				latencyMs,
				error: error instanceof Error ? error.message : String(error),
			});

			// Record failure metrics
			recordRerankMetrics({
				tier: "llm",
				model: this.model,
				latencySeconds,
				candidateCount,
				status: "failure",
			});

			throw error;
		}
	}

	/**
	 * Validate that ranking contains valid indices.
	 */
	private validateRanking(ranking: number[], candidateCount: number): void {
		// Check all indices are valid
		for (const idx of ranking) {
			if (idx < 0 || idx >= candidateCount) {
				throw new Error(`Invalid ranking index ${idx} (must be 0-${candidateCount - 1})`);
			}
		}

		// Check for duplicates
		const uniqueIndices = new Set(ranking);
		if (uniqueIndices.size !== ranking.length) {
			this.logger.warn({
				msg: "Ranking contains duplicate indices",
				ranking,
			});
		}

		// Check if all candidates are included
		if (ranking.length !== candidateCount) {
			this.logger.warn({
				msg: "Ranking length does not match candidate count",
				rankingLength: ranking.length,
				candidateCount,
			});
		}
	}

	/**
	 * Convert LLM ranking to BatchedRerankResult format.
	 *
	 * Assigns scores based on position in ranking:
	 * - First position gets score 1.0
	 * - Scores decrease linearly to 0.0 for last position
	 */
	private rankingToResults(
		ranking: number[],
		candidates: DocumentCandidate[],
		topK: number,
	): BatchedRerankResult[] {
		const results: BatchedRerankResult[] = [];

		// Take only top K from ranking
		const topIndices = ranking.slice(0, topK);

		for (let rank = 0; rank < topIndices.length; rank++) {
			const candidateIdx = topIndices[rank];
			const candidate = candidates[candidateIdx];

			if (!candidate) {
				this.logger.warn({
					msg: "Invalid candidate index in ranking",
					candidateIdx,
					candidateCount: candidates.length,
				});
				continue;
			}

			// Assign score based on position (1.0 for first, decreasing linearly)
			// Score = 1.0 - (rank / totalRanked)
			const score = 1.0 - rank / ranking.length;

			results.push({
				id: candidate.id,
				score,
				originalIndex: candidateIdx,
				originalScore: candidate.score,
			});
		}

		return results;
	}

	/**
	 * Get usage statistics for this reranker instance.
	 */
	getUsage(): {
		totalCostCents: number;
		totalTokens: number;
	} {
		return {
			totalCostCents: this.totalCostCents,
			totalTokens: this.totalTokens,
		};
	}

	/**
	 * Reset usage counters.
	 */
	resetUsage(): void {
		this.totalCostCents = 0;
		this.totalTokens = 0;
	}
}
