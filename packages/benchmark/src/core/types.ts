/**
 * Shared types for programmatic benchmark API
 *
 * @module @engram/benchmark/core
 */

import type { DatasetVariant } from "../longmemeval/types.js";

/**
 * Embedding model options
 */
export type EmbeddingModel =
	| "e5-small"
	| "e5-base"
	| "e5-large"
	| "gte-base"
	| "gte-large"
	| "bge-small"
	| "bge-base"
	| "bge-large";

/**
 * LLM provider options
 */
export type LLMProviderType = "stub" | "anthropic" | "openai" | "ollama";

/**
 * Reranker tier options
 */
export type RerankerTier = "fast" | "accurate" | "code" | "colbert" | "llm";

/**
 * Configuration for running a benchmark programmatically
 */
export interface RunBenchmarkConfig {
	/** Path to the dataset file */
	dataset: string;

	/** Dataset variant (s, m, oracle) */
	variant: DatasetVariant;

	/** Limit number of instances to evaluate */
	limit?: number;

	// Retrieval settings
	/** Number of documents to retrieve */
	topK: number;

	/** Retrieval method */
	retriever: "dense" | "bm25" | "hybrid";

	// Engram pipeline settings
	/** Embedding provider (engram uses full pipeline) */
	embeddings: "engram" | "qdrant" | "stub";

	/** Enable hybrid search (dense + sparse) */
	hybridSearch: boolean;

	/** Enable learned fusion for hybrid search */
	learnedFusion: boolean;

	/** Fusion model path or name */
	fusionModel: string;

	/** Enable reranking */
	rerank: boolean;

	/** Reranker tier */
	rerankTier: RerankerTier;

	/** Number of candidates to rerank */
	rerankDepth: number;

	// Multi-query
	/** Enable multi-query retrieval */
	multiQuery: boolean;

	/** Number of query variations to generate */
	multiQueryVariations: number;

	// Abstention
	/** Enable abstention detection */
	abstention: boolean;

	/** Minimum score threshold for abstention */
	abstentionThreshold: number;

	// Session-aware
	/** Enable session-aware retrieval */
	sessionAware: boolean;

	/** Number of top sessions for stage 1 */
	topSessions: number;

	/** Number of turns per session for stage 2 */
	turnsPerSession: number;

	// Temporal
	/** Enable temporal-aware query parsing */
	temporalAware: boolean;

	/** Temporal confidence threshold */
	temporalConfidenceThreshold: number;

	// Embedding model
	/** Embedding model to use */
	embeddingModel: EmbeddingModel;

	// LLM provider
	/** LLM provider for answer generation and evaluation */
	llm: LLMProviderType;

	// Ollama settings (when llm = "ollama")
	/** Ollama base URL */
	ollamaUrl?: string;

	/** Ollama model name */
	ollamaModel?: string;

	// Infrastructure
	/** Qdrant URL */
	qdrantUrl?: string;
}

/**
 * Benchmark metrics returned from evaluation
 */
export interface BenchmarkMetrics {
	// QA accuracy
	/** Overall accuracy (correct/total) */
	accuracy: number;

	// Retrieval metrics
	/** Recall@1 */
	recallAt1: number;

	/** Recall@5 */
	recallAt5: number;

	/** Recall@10 */
	recallAt10: number;

	/** NDCG@10 */
	ndcgAt10: number;

	/** Mean Reciprocal Rank */
	mrr: number;

	// Abstention metrics
	/** Precision for abstention detection */
	abstentionPrecision: number;

	/** Recall for abstention detection */
	abstentionRecall: number;

	/** F1 score for abstention detection */
	abstentionF1: number;

	// Latency metrics (ms)
	/** 50th percentile query latency */
	p50Latency: number;

	/** 95th percentile query latency */
	p95Latency: number;

	/** 99th percentile query latency */
	p99Latency: number;

	/** Total benchmark duration */
	totalDurationMs: number;
}

/**
 * Progress information during benchmark execution
 */
export interface BenchmarkProgress {
	/** Current stage */
	stage: "loading" | "indexing" | "retrieving" | "reading" | "evaluating";

	/** Current item number */
	current: number;

	/** Total items */
	total: number;

	/** Human-readable message */
	message: string;
}

/**
 * Result from running a benchmark
 */
export interface BenchmarkRunResult {
	/** Computed metrics */
	metrics: BenchmarkMetrics;

	/** Human-readable report (markdown) */
	report: string;

	/** JSONL output (LongMemEval format) */
	jsonl: string;
}
