/**
 * Core programmatic API for @engram/benchmark
 *
 * This module provides a function-based API for running benchmarks
 * programmatically, suitable for integration with the tuner and other
 * automated systems.
 *
 * @module @engram/benchmark/core
 */

export { buildBenchmarkConfig, DEFAULT_BENCHMARK_CONFIG } from "./config.js";
// Main API
export { type BenchmarkCallbacks, runBenchmark } from "./runner.js";

// Types
export type {
	BenchmarkMetrics,
	BenchmarkProgress,
	BenchmarkRunResult,
	EmbeddingModel,
	LLMProviderType,
	RerankerTier,
	RunBenchmarkConfig,
} from "./types.js";
