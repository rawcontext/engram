import type { RerankerTier } from "@engram/search";
import { SearchRetriever } from "@engram/search";
import { apiError, apiSuccess } from "@lib/api-response";
import { validate } from "@lib/validate";
import { z } from "zod";

// Initialize retriever (singleton behavior handled internally or by module caching)
const retriever = new SearchRetriever(process.env.QDRANT_URL || "http://localhost:6333");

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
			const rerankStartTime = performance.now();
			const results = await retriever.search({
				text: query,
				limit,
				filters,
				strategy: "hybrid",
				rerank: effectiveRerank,
				rerankTier: effectiveRerankTier as RerankerTier | undefined,
				rerankDepth: effectiveRerankDepth,
			});
			const rerankLatency = performance.now() - rerankStartTime;

			const totalLatency = performance.now() - startTime;

			// Check if reranking was applied (results have rerankerScore)
			const wasReranked =
				effectiveRerank !== false && results.length > 0 && "rerankerScore" in results[0];

			return apiSuccess({
				results,
				meta: {
					query,
					strategy: "hybrid",
					reranker: wasReranked
						? {
								tier: (effectiveRerankTier as RerankerTier) ?? ("accurate" as const),
								model: RERANKER_MODEL,
								latencyMs: Math.round(rerankLatency),
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
