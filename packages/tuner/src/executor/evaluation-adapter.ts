/**
 * Evaluation adapter bridging tuner config to benchmark execution
 *
 * The Python benchmark package (packages/benchmark) provides the LongMemEval
 * evaluation suite. This adapter maps tuner trial configurations to benchmark
 * parameters.
 *
 * Integration options:
 * 1. CLI execution: Run `engram-benchmark run` via subprocess
 * 2. HTTP API: Requires adding FastAPI server to benchmark package
 * 3. Direct Python: Requires tuner to be Python-based
 *
 * Currently, the evaluateWithBenchmark function is a placeholder that throws.
 * Implement by calling the benchmark CLI or adding an HTTP API endpoint.
 *
 * @module @engram/tuner/executor
 */

import type { TrialConfig } from "./config-mapper.js";
import type { TrialMetrics } from "./trial-runner.js";

type DatasetVariant = "s" | "m" | "oracle";
type LLMProviderType = "stub" | "anthropic" | "openai" | "gemini" | "ollama";
type RunBenchmarkConfig = Record<string, unknown>;

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
 * Creates a configuration object compatible with the engram-benchmark CLI.
 * The config maps to the --rerank, --top-k, and other CLI arguments.
 *
 * @param trialConfig - Configuration from tuner trial
 * @param options - Adapter options
 * @returns Benchmark-compatible configuration
 */
export function mapTrialToBenchmarkConfig(
	trialConfig: TrialConfig,
	options: EvaluationAdapterOptions,
): RunBenchmarkConfig {
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

/**
 * Metrics returned from benchmark evaluation.
 * These map to the metrics computed by engram-benchmark.
 */
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
 * This function is a placeholder. To implement, choose one of:
 * 1. CLI subprocess: Run `engram-benchmark run` with spawned process
 * 2. HTTP API: Add FastAPI server to packages/benchmark, call via fetch
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
	const _benchmarkConfig = mapTrialToBenchmarkConfig(trialConfig, options);

	// Implementation options:
	// 1. CLI: spawn('engram-benchmark', ['run', '--dataset', options.dataset, ...])
	// 2. HTTP: fetch('http://localhost:8001/api/benchmark', { method: 'POST', body: ... })
	throw new Error(
		"evaluateWithBenchmark not implemented: integrate with engram-benchmark CLI or HTTP API",
	);
}
