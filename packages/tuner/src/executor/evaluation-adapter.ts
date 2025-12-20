/**
 * Evaluation adapter bridging tuner config to benchmark execution
 *
 * TODO: Migrate to use Python benchmark service (packages/benchmark-py)
 * This module previously used the deprecated TypeScript @engram/benchmark package.
 * It needs to be updated to call the Python benchmark service HTTP API instead.
 *
 * @module @engram/tuner/executor
 */

import type { TrialConfig } from "./config-mapper.js";
import type { TrialMetrics } from "./trial-runner.js";

// TODO: Define types based on Python benchmark API
type DatasetVariant = "s" | "m" | "oracle";
type LLMProviderType = "stub" | "anthropic" | "openai" | "gemini" | "ollama";
type RunBenchmarkConfig = Record<string, unknown>;
type BenchmarkProgress = { stage: string; current: number; total: number };

/**
 * Options for the evaluation adapter
 */
export interface EvaluationAdapterOptions {
	/** Path to the benchmark dataset */
	dataset: string;

	/** Dataset variant (s, m, oracle) */
	variant?: DatasetVariant;

	/** Limit number of instances to evaluate */
	limit?: number;

	/** Qdrant URL for vector search */
	qdrantUrl?: string;

	/** LLM provider to use for answer generation */
	llm?: LLMProviderType;

	/** Ollama URL (when llm = "ollama") */
	ollamaUrl?: string;

	/** Ollama model (when llm = "ollama") */
	ollamaModel?: string;

	/** Progress callback */
	onProgress?: (stage: string, percent: number) => void;
}

/**
 * Map tuner TrialConfig to benchmark RunBenchmarkConfig
 *
 * TODO: Update to call Python benchmark service HTTP API
 *
 * @param trialConfig - Configuration from tuner trial
 * @param options - Adapter options
 * @returns Benchmark-compatible configuration
 */
export function mapTrialToBenchmarkConfig(
	trialConfig: TrialConfig,
	options: EvaluationAdapterOptions,
): RunBenchmarkConfig {
	// TODO: Replace with Python benchmark API payload format
	return {
		dataset: options.dataset,
		variant: options.variant ?? "oracle",
		limit: options.limit,
		qdrantUrl: options.qdrantUrl,
		llm: options.llm ?? "stub",
		ollamaUrl: options.ollamaUrl,
		ollamaModel: options.ollamaModel,
		embeddings: "engram",
		rerank: trialConfig.reranker.enabled ?? true,
		rerankTier: trialConfig.reranker.defaultTier ?? "accurate",
		rerankDepth: trialConfig.reranker.depth ?? 30,
		hybridSearch: true,
		abstention: true,
		abstentionThreshold: trialConfig.abstention.minRetrievalScore ?? 0.3,
		sessionAware: false,
		temporalAware: false,
	};
}

// TODO: Define based on Python benchmark API response
type BenchmarkMetrics = {
	accuracy: number;
	recallAt1: number;
	recallAt5: number;
	recallAt10: number;
	ndcgAt10: number;
	mrr: number;
	abstentionPrecision: number;
	abstentionRecall: number;
	abstentionF1: number;
	p50Latency: number;
	p95Latency: number;
	p99Latency: number;
	totalDurationMs: number;
};

/**
 * Map benchmark metrics to tuner TrialMetrics format
 *
 * TODO: Update to match Python benchmark API response format
 *
 * @param benchmarkMetrics - Metrics from benchmark run
 * @returns Metrics in tuner format
 */
export function mapBenchmarkToTrialMetrics(benchmarkMetrics: BenchmarkMetrics): TrialMetrics {
	return {
		// Quality metrics
		ndcg: benchmarkMetrics.ndcgAt10,
		mrr: benchmarkMetrics.mrr,
		hitRate: benchmarkMetrics.recallAt1,
		precision: benchmarkMetrics.accuracy,
		recall: benchmarkMetrics.recallAt10,

		// Latency metrics
		p50Latency: benchmarkMetrics.p50Latency,
		p95Latency: benchmarkMetrics.p95Latency,
		p99Latency: benchmarkMetrics.p99Latency,

		// Abstention metrics
		abstentionPrecision: benchmarkMetrics.abstentionPrecision,
		abstentionRecall: benchmarkMetrics.abstentionRecall,
		abstentionF1: benchmarkMetrics.abstentionF1,
	};
}

/**
 * Evaluate a trial configuration using the benchmark pipeline
 *
 * TODO: Implement HTTP client to call Python benchmark service
 * This function previously called the deprecated TypeScript @engram/benchmark.
 * It needs to make HTTP requests to the Python benchmark service API instead.
 *
 * @param trialConfig - Configuration from tuner trial
 * @param options - Adapter options including dataset path
 * @returns Metrics from the benchmark evaluation
 *
 * @example
 * ```ts
 * const metrics = await evaluateWithBenchmark(trialConfig, {
 *   dataset: "./data/longmemeval_oracle.json",
 *   limit: 50,
 *   llm: "stub",
 *   onProgress: (stage, pct) => console.log(`${stage}: ${pct}%`),
 * });
 *
 * console.log(`NDCG@10: ${metrics.ndcg}`);
 * ```
 */
export async function evaluateWithBenchmark(
	trialConfig: TrialConfig,
	options: EvaluationAdapterOptions,
): Promise<TrialMetrics> {
	// Map trial config to benchmark config
	const benchmarkConfig = mapTrialToBenchmarkConfig(trialConfig, options);

	// TODO: Replace with HTTP call to Python benchmark service
	// Example: POST http://localhost:8001/api/benchmark
	// Body: benchmarkConfig
	// Response: { metrics: BenchmarkMetrics }
	throw new Error(
		"evaluateWithBenchmark not implemented: needs migration to Python benchmark service API",
	);

	// // Map benchmark metrics to trial metrics format
	// return mapBenchmarkToTrialMetrics(result.metrics);
}
