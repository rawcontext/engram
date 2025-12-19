/**
 * @engram/benchmark
 *
 * Benchmark adapters for evaluating Engram's memory system against
 * industry-standard benchmarks.
 *
 * Currently supported:
 * - LongMemEval (ICLR 2025)
 *
 * @see https://github.com/xiaowu0162/LongMemEval
 */

// Programmatic API (primary exports for automation/tuning)
export {
	type BenchmarkCallbacks,
	type BenchmarkMetrics,
	type BenchmarkProgress,
	type BenchmarkRunResult,
	buildBenchmarkConfig,
	DEFAULT_BENCHMARK_CONFIG,
	type EmbeddingModel,
	type LLMProviderType,
	type RerankerTier,
	type RunBenchmarkConfig,
	runBenchmark,
} from "./core/index.js";

// LongMemEval-specific exports
export * from "./longmemeval/index.js";
