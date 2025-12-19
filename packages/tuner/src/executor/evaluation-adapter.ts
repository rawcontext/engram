/**
 * Evaluation adapter bridging tuner config to benchmark execution
 *
 * Maps TrialConfig (tuner format) to RunBenchmarkConfig (benchmark format)
 * and returns metrics in TrialMetrics format.
 *
 * @module @engram/tuner/executor
 */

import type { DatasetVariant } from "@engram/benchmark";
import {
	type BenchmarkProgress,
	buildBenchmarkConfig,
	type LLMProviderType,
	type RunBenchmarkConfig,
	runBenchmark,
} from "@engram/benchmark";
import type { TrialConfig } from "./config-mapper.js";
import type { TrialMetrics } from "./trial-runner.js";

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
 * @param trialConfig - Configuration from tuner trial
 * @param options - Adapter options
 * @returns Benchmark-compatible configuration
 */
export function mapTrialToBenchmarkConfig(
	trialConfig: TrialConfig,
	options: EvaluationAdapterOptions,
): RunBenchmarkConfig {
	return buildBenchmarkConfig({
		// Dataset settings from adapter options
		dataset: options.dataset,
		variant: options.variant ?? "oracle",
		limit: options.limit,

		// Infrastructure
		qdrantUrl: options.qdrantUrl,
		llm: options.llm ?? "stub",
		ollamaUrl: options.ollamaUrl,
		ollamaModel: options.ollamaModel,

		// Embeddings (always use Engram full pipeline for tuning)
		embeddings: "engram",

		// Map reranker settings from trial
		rerank: trialConfig.reranker.enabled ?? true,
		rerankTier: trialConfig.reranker.defaultTier ?? "accurate",
		rerankDepth: trialConfig.reranker.depth ?? 30,

		// Hybrid search always enabled for Engram
		hybridSearch: true,

		// Abstention settings from trial
		abstention: true,
		abstentionThreshold: trialConfig.abstention.minRetrievalScore ?? 0.3,

		// Session and temporal settings (defaults for now, could be tuned)
		sessionAware: false,
		temporalAware: false,
	});
}

/**
 * Map benchmark metrics to tuner TrialMetrics format
 *
 * @param benchmarkMetrics - Metrics from benchmark run
 * @returns Metrics in tuner format
 */
export function mapBenchmarkToTrialMetrics(
	benchmarkMetrics: import("@engram/benchmark").BenchmarkMetrics,
): TrialMetrics {
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
 * This is the main entry point for the tuner to evaluate a configuration.
 * It maps the trial config to benchmark format, runs the benchmark, and
 * returns metrics in tuner format.
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

	// Run benchmark with progress callback
	const result = await runBenchmark(benchmarkConfig, {
		onProgress: options.onProgress
			? (p: BenchmarkProgress) => options.onProgress?.(p.stage, (p.current / p.total) * 100)
			: undefined,
	});

	// Map benchmark metrics to trial metrics format
	return mapBenchmarkToTrialMetrics(result.metrics);
}
