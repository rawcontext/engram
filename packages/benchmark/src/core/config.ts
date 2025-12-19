/**
 * Configuration builder for programmatic benchmark API
 *
 * Provides defaults and environment variable fallbacks for benchmark configuration.
 *
 * @module @engram/benchmark/core
 */

import type { RunBenchmarkConfig } from "./types.js";

/**
 * Default benchmark configuration values
 */
export const DEFAULT_BENCHMARK_CONFIG: Omit<RunBenchmarkConfig, "dataset"> = {
	// Dataset
	variant: "oracle",
	limit: undefined,

	// Retrieval
	topK: 10,
	retriever: "hybrid",

	// Engram pipeline
	embeddings: "engram",
	hybridSearch: true,
	learnedFusion: false,
	fusionModel: "",
	rerank: true,
	rerankTier: "accurate",
	rerankDepth: 30,

	// Multi-query
	multiQuery: false,
	multiQueryVariations: 3,

	// Abstention
	abstention: true,
	abstentionThreshold: 0.3,

	// Session-aware
	sessionAware: false,
	topSessions: 5,
	turnsPerSession: 3,

	// Temporal
	temporalAware: false,
	temporalConfidenceThreshold: 0.7,

	// Model
	embeddingModel: "e5-small",
	llm: "stub",

	// Ollama
	ollamaUrl: "http://localhost:11434",
	ollamaModel: "llama3.2",

	// Infrastructure
	qdrantUrl: "http://localhost:6333",
};

/**
 * Build a complete benchmark configuration from partial options
 *
 * Uses defaults and environment variable fallbacks for missing values.
 *
 * @param options - Partial configuration options
 * @returns Complete configuration with all required fields
 *
 * @example
 * ```ts
 * const config = buildBenchmarkConfig({
 *   dataset: "./data/longmemeval_oracle.json",
 *   limit: 50,
 *   llm: "anthropic",
 * });
 * ```
 */
export function buildBenchmarkConfig(
	options: Partial<RunBenchmarkConfig> & { dataset: string },
): RunBenchmarkConfig {
	return {
		// Dataset (required)
		dataset: options.dataset,
		variant: options.variant ?? DEFAULT_BENCHMARK_CONFIG.variant,
		limit: options.limit ?? DEFAULT_BENCHMARK_CONFIG.limit,

		// Retrieval
		topK: options.topK ?? DEFAULT_BENCHMARK_CONFIG.topK,
		retriever: options.retriever ?? DEFAULT_BENCHMARK_CONFIG.retriever,

		// Engram pipeline
		embeddings: options.embeddings ?? DEFAULT_BENCHMARK_CONFIG.embeddings,
		hybridSearch: options.hybridSearch ?? DEFAULT_BENCHMARK_CONFIG.hybridSearch,
		learnedFusion: options.learnedFusion ?? DEFAULT_BENCHMARK_CONFIG.learnedFusion,
		fusionModel: options.fusionModel ?? DEFAULT_BENCHMARK_CONFIG.fusionModel,
		rerank: options.rerank ?? DEFAULT_BENCHMARK_CONFIG.rerank,
		rerankTier: options.rerankTier ?? DEFAULT_BENCHMARK_CONFIG.rerankTier,
		rerankDepth: options.rerankDepth ?? DEFAULT_BENCHMARK_CONFIG.rerankDepth,

		// Multi-query
		multiQuery: options.multiQuery ?? DEFAULT_BENCHMARK_CONFIG.multiQuery,
		multiQueryVariations:
			options.multiQueryVariations ?? DEFAULT_BENCHMARK_CONFIG.multiQueryVariations,

		// Abstention
		abstention: options.abstention ?? DEFAULT_BENCHMARK_CONFIG.abstention,
		abstentionThreshold:
			options.abstentionThreshold ?? DEFAULT_BENCHMARK_CONFIG.abstentionThreshold,

		// Session-aware
		sessionAware: options.sessionAware ?? DEFAULT_BENCHMARK_CONFIG.sessionAware,
		topSessions: options.topSessions ?? DEFAULT_BENCHMARK_CONFIG.topSessions,
		turnsPerSession: options.turnsPerSession ?? DEFAULT_BENCHMARK_CONFIG.turnsPerSession,

		// Temporal
		temporalAware: options.temporalAware ?? DEFAULT_BENCHMARK_CONFIG.temporalAware,
		temporalConfidenceThreshold:
			options.temporalConfidenceThreshold ?? DEFAULT_BENCHMARK_CONFIG.temporalConfidenceThreshold,

		// Model
		embeddingModel: options.embeddingModel ?? DEFAULT_BENCHMARK_CONFIG.embeddingModel,
		llm: options.llm ?? DEFAULT_BENCHMARK_CONFIG.llm,

		// Ollama
		ollamaUrl: options.ollamaUrl ?? process.env.OLLAMA_URL ?? DEFAULT_BENCHMARK_CONFIG.ollamaUrl,
		ollamaModel:
			options.ollamaModel ?? process.env.OLLAMA_MODEL ?? DEFAULT_BENCHMARK_CONFIG.ollamaModel,

		// Infrastructure
		qdrantUrl: options.qdrantUrl ?? process.env.QDRANT_URL ?? DEFAULT_BENCHMARK_CONFIG.qdrantUrl,
	};
}
