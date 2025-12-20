import { apiError, apiSuccess } from "@lib/api-response";
import { type RerankerTier, search } from "@lib/search-client";
import { validate } from "@lib/validate";
import { z } from "zod";

const SearchRequestSchema = z.object({
	query: z.string(),
	limit: z.number().optional().default(10),
	filters: z
		.object({
			session_id: z.string().optional(),
			type: z.enum(["thought", "code", "doc"]).optional(),
		})
		.optional(),
	// Settings object (new format)
	settings: z
		.object({
			rerank: z.boolean().optional(),
			rerankTier: z.enum(["fast", "accurate", "code", "llm"]).optional(),
			rerankDepth: z.number().optional(),
			latencyBudgetMs: z.number().optional(),
		})
		.optional(),
	// Legacy reranking options (for backwards compatibility)
	rerank: z.boolean().optional().default(true),
	rerankTier: z.enum(["fast", "accurate", "code", "llm"]).optional(),
	rerankDepth: z.number().optional(),
});

export const _SearchResponseSchema = z.object({
	results: z.array(
		z.object({
			id: z.union([z.string(), z.number()]),
			score: z.number(),
			rrfScore: z.number().optional(),
			rerankerScore: z.number().optional(),
			payload: z.record(z.string(), z.unknown()).optional(),
		}),
	),
	meta: z.object({
		query: z.string(),
		strategy: z.string(),
		reranker: z
			.object({
				tier: z.enum(["fast", "accurate", "code", "llm"]),
				model: z.string(),
				latencyMs: z.number(),
			})
			.optional(),
		totalLatencyMs: z.number(),
	}),
});

/** Current reranker model - will be made dynamic with RerankerRouter */
const RERANKER_MODEL = "Xenova/bge-reranker-base";

/**
 * Search the knowledge graph
 * @body SearchRequestSchema
 * @response SearchResponseSchema
 */
export const POST = async (req: Request) => {
	return validate(SearchRequestSchema as unknown as z.ZodSchema<unknown>)(req, async (data) => {
		const { query, limit, filters, settings, rerank, rerankTier, rerankDepth } = data as z.infer<
			typeof SearchRequestSchema
		>;

		const startTime = performance.now();

		// Merge settings (prioritize settings object over legacy params)
		const effectiveRerank = settings?.rerank ?? rerank;
		const effectiveRerankTier = settings?.rerankTier ?? rerankTier;
		const effectiveRerankDepth = settings?.rerankDepth ?? rerankDepth;

		try {
			const response = await search({
				text: query,
				limit,
				filters,
				strategy: "hybrid",
				rerank: effectiveRerank,
				rerank_tier: effectiveRerankTier as RerankerTier | undefined,
				rerank_depth: effectiveRerankDepth,
			});

			const totalLatency = performance.now() - startTime;

			// Check if reranking was applied (results have reranker_score)
			const wasReranked =
				effectiveRerank !== false &&
				response.results.length > 0 &&
				response.results[0].reranker_score !== null;

			// Transform results to match expected format
			const results = response.results.map((result) => ({
				id: result.id,
				score: result.score,
				rrfScore: result.rrf_score,
				rerankerScore: result.reranker_score,
				payload: result.payload,
			}));

			return apiSuccess({
				results,
				meta: {
					query,
					strategy: "hybrid",
					reranker: wasReranked
						? {
								tier:
									response.results[0].rerank_tier ??
									(effectiveRerankTier as RerankerTier) ??
									("accurate" as const),
								model: RERANKER_MODEL,
								latencyMs: Math.round(response.took_ms),
							}
						: undefined,
					totalLatencyMs: Math.round(totalLatency),
				},
			});
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return apiError(message, "SEARCH_FAILED");
		}
	});
};
