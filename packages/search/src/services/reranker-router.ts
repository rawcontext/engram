import { RERANK_CONFIG } from "../config";
import type { RerankerTier } from "../models/schema";
import { QueryClassifier } from "./classifier";

export interface RerankerRoutingResult {
	/** Selected reranker tier */
	tier: RerankerTier;
	/** Model identifier for the selected tier */
	model: string;
	/** Maximum candidates to process */
	maxCandidates: number;
	/** Human-readable reason for the routing decision */
	reason: string;
}

export interface RoutingOptions {
	/** Force a specific tier (bypasses routing logic) */
	forceTier?: RerankerTier;
	/** Content type filter from query */
	contentType?: "thought" | "code" | "doc";
	/** User tier/subscription level (future use) */
	userTier?: "free" | "pro" | "enterprise";
	/** Latency budget in milliseconds */
	latencyBudgetMs?: number;
}

/**
 * RerankerRouter selects the appropriate reranker tier based on query characteristics.
 *
 * Routing rules (in priority order):
 * 1. If forceTier is specified, use it
 * 2. If query contains code patterns → code tier
 * 3. If query is complex or agentic → accurate tier
 * 4. If latency budget is tight → fast tier
 * 5. Default → fast tier
 */
export class RerankerRouter {
	private classifier: QueryClassifier;

	constructor() {
		this.classifier = new QueryClassifier();
	}

	/**
	 * Route a query to the appropriate reranker tier.
	 */
	route(query: string, options: RoutingOptions = {}): RerankerRoutingResult {
		const { forceTier, contentType, latencyBudgetMs } = options;

		// Priority 1: Forced tier
		if (forceTier) {
			return this.createResult(forceTier, `Forced tier: ${forceTier}`);
		}

		// Priority 2: Code content type or code query patterns
		if (contentType === "code" || this.classifier.isCodeQuery(query)) {
			return this.createResult("code", "Query contains code patterns");
		}

		// Priority 3: Complex or agentic queries
		const { complexity, score } = this.classifier.classifyComplexity(query);
		if (complexity === "complex") {
			return this.createResult("accurate", `Complex query (score: ${score})`);
		}

		if (this.classifier.isAgenticQuery(query)) {
			return this.createResult("accurate", "Agentic/tool-related query");
		}

		// Priority 4: Tight latency budget
		if (latencyBudgetMs !== undefined) {
			const fastConfig = RERANK_CONFIG.tiers.fast;
			const accurateConfig = RERANK_CONFIG.tiers.accurate;

			if (latencyBudgetMs < fastConfig.maxLatencyMs) {
				// Very tight budget - might need to skip reranking entirely
				return this.createResult("fast", `Tight latency budget (${latencyBudgetMs}ms)`);
			}

			if (latencyBudgetMs < accurateConfig.maxLatencyMs) {
				return this.createResult("fast", `Latency budget favors fast tier (${latencyBudgetMs}ms)`);
			}
		}

		// Priority 5: Moderate complexity
		if (complexity === "moderate") {
			// For moderate queries, use fast tier but could upgrade based on other signals
			return this.createResult("fast", `Moderate complexity (score: ${score})`);
		}

		// Default: Fast tier for simple queries
		return this.createResult("fast", "Default routing (simple query)");
	}

	/**
	 * Check if LLM reranking should be used for this query.
	 * LLM tier is only used when explicitly requested or for very high-value queries.
	 */
	shouldUseLLM(_query: string, options: RoutingOptions = {}): boolean {
		// LLM tier must be explicitly forced for now
		if (options.forceTier === "llm") {
			return true;
		}

		// Future: Could add logic for enterprise users or high-stakes queries
		return false;
	}

	/**
	 * Get the model for a specific tier.
	 */
	getModelForTier(tier: RerankerTier): string {
		return RERANK_CONFIG.tiers[tier].model;
	}

	/**
	 * Get max candidates for a tier.
	 */
	getMaxCandidatesForTier(tier: RerankerTier): number {
		const config = RERANK_CONFIG.tiers[tier];
		return config.maxCandidates ?? RERANK_CONFIG.depth;
	}

	private createResult(tier: RerankerTier, reason: string): RerankerRoutingResult {
		return {
			tier,
			model: this.getModelForTier(tier),
			maxCandidates: this.getMaxCandidatesForTier(tier),
			reason,
		};
	}
}
