import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLogger } from "@engram/logger";
import { generateObject } from "ai";
import { z } from "zod";
import type { SearchQuery, SearchResult, SearchResultPayload } from "../models/schema";
import type { SearchRetriever } from "./retriever";

/**
 * Raw result from SearchRetriever before full type mapping.
 * SearchRetriever returns a looser type than SearchResult.
 */
interface RawSearchResult {
	id: string | number;
	score: number;
	payload?: unknown;
	rrfScore?: number;
	rerankerScore?: number;
	degraded?: boolean;
	degradedReason?: string;
}

/**
 * Query expansion strategies based on DMQR-RAG research.
 * @see https://arxiv.org/abs/2411.13154
 *
 * - paraphrase: Rephrase with synonyms (GQR in paper)
 * - keyword: Extract key entities and terms (KWR in paper)
 * - stepback: Generalize to broader concept
 * - decompose: Break into sub-questions (for complex queries)
 */
export type QueryExpansionStrategy = "paraphrase" | "keyword" | "stepback" | "decompose";

/**
 * Configuration for multi-query retrieval.
 */
export interface MultiQueryConfig {
	/** Number of query variations to generate */
	numVariations: number;
	/** Expansion strategies to use */
	strategies: QueryExpansionStrategy[];
	/** Whether to include original query in retrieval */
	includeOriginal: boolean;
	/** RRF fusion constant (typically 60) */
	rrfK: number;
}

const DEFAULT_CONFIG: MultiQueryConfig = {
	numVariations: 3,
	strategies: ["paraphrase", "keyword", "stepback"],
	includeOriginal: true,
	rrfK: 60,
};

/**
 * Zod schema for LLM query expansion response.
 */
const QueryExpansionSchema = z.object({
	queries: z.array(z.string().min(1)),
});

/**
 * System prompt for query expansion.
 * Instructs the model to generate diverse query variations using DMQR-RAG strategies.
 */
const EXPANSION_SYSTEM_PROMPT = `You are a search query expansion expert. Given a user query, generate alternative search queries that will help retrieve relevant documents.

Rules:
- Generate queries that are semantically different but target the same information need
- Each query should emphasize different aspects or use different vocabulary
- Return ONLY a JSON object with a "queries" array of query strings
- Example: {"queries": ["query 1", "query 2", "query 3"]}
- Do not include numbering, bullets, or markdown formatting`;

export interface MultiQueryRetrieverOptions {
	/** Base retriever to use for each query */
	baseRetriever: SearchRetriever;
	/** Multi-query configuration */
	config?: Partial<MultiQueryConfig>;
	/** Model to use for expansion - defaults to gemini-3-flash */
	model?: string;
	/** Google AI API key - defaults to GOOGLE_GENERATIVE_AI_API_KEY env var */
	apiKey?: string;
}

/**
 * Multi-query retriever that generates query variations using LLM
 * and fuses results using Reciprocal Rank Fusion (RRF).
 *
 * Based on DMQR-RAG: Diverse Multi-Query Rewriting for RAG.
 * @see https://arxiv.org/abs/2411.13154
 *
 * Key strategies:
 * - Paraphrase: Rephrase with synonyms to capture vocabulary variance
 * - Keyword: Extract key entities for precise matching
 * - Step-back: Generalize to broader concepts for high-level documents
 * - Decompose: Break complex queries into sub-questions
 *
 * @example
 * ```ts
 * const retriever = new MultiQueryRetriever({
 *   baseRetriever: searchRetriever,
 *   config: { numVariations: 3, strategies: ["paraphrase", "keyword", "stepback"] }
 * });
 *
 * const results = await retriever.search({
 *   text: "How do I implement OAuth2 authentication?",
 *   limit: 10
 * });
 * ```
 */
export class MultiQueryRetriever {
	private baseRetriever: SearchRetriever;
	private google: ReturnType<typeof createGoogleGenerativeAI>;
	private model: string;
	private config: MultiQueryConfig;
	private logger = createLogger({ component: "MultiQueryRetriever" });
	private totalCostCents = 0;
	private totalTokens = 0;

	constructor(options: MultiQueryRetrieverOptions) {
		this.baseRetriever = options.baseRetriever;
		this.config = { ...DEFAULT_CONFIG, ...options.config };
		this.model = options.model ?? "gemini-3-flash";

		this.google = createGoogleGenerativeAI({
			apiKey: options.apiKey,
		});
	}

	/**
	 * Search using multi-query expansion and RRF fusion.
	 *
	 * @param query - The search query
	 * @returns Fused and ranked search results
	 */
	async search(query: SearchQuery): Promise<SearchResult[]> {
		const startTime = Date.now();
		const limit = query.limit ?? 10;

		this.logger.info({
			msg: "Multi-query search started",
			query: query.text.slice(0, 100),
			numVariations: this.config.numVariations,
			strategies: this.config.strategies,
			includeOriginal: this.config.includeOriginal,
			limit,
		});

		try {
			// Step 1: Generate query variations using LLM
			const variations = await this.expandQuery(query.text);

			this.logger.debug({
				msg: "Query expansion completed",
				originalQuery: query.text,
				variations,
			});

			// Step 2: Search with each variation in parallel
			// Fetch more results per query since we'll dedupe
			const perQueryLimit = Math.max(limit * 2, 20);
			const searchPromises = variations.map((varQuery) =>
				this.baseRetriever.search({
					...query,
					text: varQuery,
					limit: perQueryLimit,
				}),
			);

			const allResults = await Promise.all(searchPromises);

			this.logger.debug({
				msg: "Parallel searches completed",
				queriesExecuted: variations.length,
				resultCounts: allResults.map((r) => r.length),
			});

			// Step 3: Fuse results using RRF
			const fused = this.rrfFusion(allResults, limit);

			const latencyMs = Date.now() - startTime;

			this.logger.info({
				msg: "Multi-query search completed",
				queriesExecuted: variations.length,
				totalCandidates: allResults.reduce((sum, r) => sum + r.length, 0),
				uniqueResults: fused.length,
				latencyMs,
			});

			return fused;
		} catch (error) {
			const latencyMs = Date.now() - startTime;

			this.logger.error({
				msg: "Multi-query search failed - falling back to single query",
				latencyMs,
				error: error instanceof Error ? error.message : String(error),
			});

			// Graceful degradation: fall back to single query
			const fallbackResults = await this.baseRetriever.search(query);
			return fallbackResults.map((r) => {
				const raw = r as RawSearchResult;
				return {
					id: raw.id,
					score: raw.score,
					rrfScore: raw.rrfScore,
					rerankerScore: raw.rerankerScore,
					payload: raw.payload as SearchResultPayload | undefined,
					degraded: raw.degraded,
					degradedReason: raw.degradedReason,
				};
			});
		}
	}

	/**
	 * Expand a query into multiple variations using LLM.
	 */
	async expandQuery(query: string): Promise<string[]> {
		const variations: string[] = [];

		// Always include original query if configured
		if (this.config.includeOriginal) {
			variations.push(query);
		}

		const prompt = this.buildExpansionPrompt(query);

		try {
			const result = await generateObject({
				model: this.google(this.model),
				schema: QueryExpansionSchema,
				system: EXPANSION_SYSTEM_PROMPT,
				prompt,
			});

			// Track LLM usage
			const usage = result.usage as
				| { totalTokens?: number; inputTokens?: number; outputTokens?: number }
				| undefined;
			if (usage) {
				this.totalTokens += usage.totalTokens ?? 0;
				// Cost estimation for gemini-3-flash
				// Input: $0.50/1M tokens, Output: $3.00/1M tokens
				const inputTokens = usage.inputTokens ?? 0;
				const outputTokens = usage.outputTokens ?? 0;
				const costCents = (inputTokens / 1_000_000) * 50 + (outputTokens / 1_000_000) * 300;
				this.totalCostCents += costCents;
			}

			// Filter and limit variations
			const queries = (result.object as { queries: string[] }).queries;
			const validVariations = queries
				.filter((v: string) => v.trim().length > 0 && v !== query)
				.slice(0, this.config.numVariations);

			variations.push(...validVariations);

			return variations;
		} catch (error) {
			this.logger.warn({
				msg: "Query expansion failed - using original query only",
				error: error instanceof Error ? error.message : String(error),
			});

			// Return at least the original query
			return [query];
		}
	}

	/**
	 * Build the user prompt for query expansion.
	 */
	private buildExpansionPrompt(query: string): string {
		const strategyInstructions = this.config.strategies
			.map((strategy) => {
				switch (strategy) {
					case "paraphrase":
						return "- Paraphrase: Rephrase the query using different words and synonyms";
					case "keyword":
						return "- Keyword: Focus on key entities, names, and technical terms";
					case "stepback":
						return "- Step-back: Generalize to a broader concept or category";
					case "decompose":
						return "- Decompose: Break into simpler sub-questions (if query is complex)";
					default:
						return "";
				}
			})
			.filter(Boolean)
			.join("\n");

		return `Generate ${this.config.numVariations} alternative search queries for:
"${query}"

Use these strategies:
${strategyInstructions}

Return ONLY a JSON object with a "queries" array. No explanations.`;
	}

	/**
	 * Fuse multiple result sets using Reciprocal Rank Fusion (RRF).
	 *
	 * RRF score = sum(1 / (k + rank_i)) across all result sets
	 * where k is typically 60 to dampen the impact of high rankings.
	 *
	 * @see https://dl.acm.org/doi/10.1145/1571941.1572114
	 */
	private rrfFusion(resultSets: RawSearchResult[][], topK: number): SearchResult[] {
		const k = this.config.rrfK;
		const scoreMap = new Map<string | number, { result: RawSearchResult; rrfScore: number }>();

		for (const results of resultSets) {
			for (let rank = 0; rank < results.length; rank++) {
				const result = results[rank];
				const rrfScore = 1 / (k + rank + 1);
				const key = result.id;

				const existing = scoreMap.get(key);
				if (existing) {
					// Sum RRF scores for documents appearing in multiple result sets
					existing.rrfScore += rrfScore;
				} else {
					scoreMap.set(key, { result, rrfScore });
				}
			}
		}

		// Sort by RRF score and return top K
		return Array.from(scoreMap.values())
			.sort((a, b) => b.rrfScore - a.rrfScore)
			.slice(0, topK)
			.map(({ result, rrfScore }) => ({
				id: result.id,
				score: rrfScore, // Use RRF score as final score
				rrfScore, // Also store in rrfScore for transparency
				payload: result.payload as SearchResultPayload | undefined,
				degraded: result.degraded,
				degradedReason: result.degradedReason,
			}));
	}

	/**
	 * Get usage statistics for this retriever instance.
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

	/**
	 * Get current configuration.
	 */
	getConfig(): MultiQueryConfig {
		return { ...this.config };
	}
}
