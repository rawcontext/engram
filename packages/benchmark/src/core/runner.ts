/**
 * Programmatic benchmark runner
 *
 * Provides a function-based API for running benchmarks, suitable for
 * integration with the tuner and other automated systems.
 *
 * @module @engram/benchmark/core
 */

import { BenchmarkPipeline, type CustomRetriever } from "../longmemeval/pipeline.js";
import {
	AnthropicProvider,
	OllamaProvider,
	OpenAICompatibleProvider,
} from "../longmemeval/providers/anthropic-provider.js";
import { EngramRetriever } from "../longmemeval/providers/engram-provider.js";
import { QdrantEmbeddingProvider } from "../longmemeval/providers/qdrant-provider.js";
import type { LLMProvider } from "../longmemeval/reader.js";
import { StubEmbeddingProvider, StubLLMProvider } from "../longmemeval/reader.js";
import type { EmbeddingProvider } from "../longmemeval/retriever.js";
import type {
	BenchmarkMetrics,
	BenchmarkProgress,
	BenchmarkRunResult,
	RunBenchmarkConfig,
} from "./types.js";

/**
 * Callbacks for monitoring benchmark execution
 */
export interface BenchmarkCallbacks {
	/** Called when progress is made */
	onProgress?: (progress: BenchmarkProgress) => void;
}

/**
 * Run a benchmark with the given configuration
 *
 * This is the main programmatic entry point for running benchmarks.
 * Use `buildBenchmarkConfig` to create a complete configuration from partial options.
 *
 * @param config - Complete benchmark configuration
 * @param callbacks - Optional callbacks for progress monitoring
 * @returns Benchmark results including metrics, report, and JSONL output
 *
 * @example
 * ```ts
 * import { runBenchmark, buildBenchmarkConfig } from "@engram/benchmark";
 *
 * const config = buildBenchmarkConfig({
 *   dataset: "./data/longmemeval_oracle.json",
 *   limit: 50,
 * });
 *
 * const result = await runBenchmark(config, {
 *   onProgress: (p) => console.log(`${p.stage}: ${p.current}/${p.total}`),
 * });
 *
 * console.log(`Accuracy: ${result.metrics.accuracy}`);
 * ```
 */
export async function runBenchmark(
	config: RunBenchmarkConfig,
	callbacks?: BenchmarkCallbacks,
): Promise<BenchmarkRunResult> {
	const startTime = Date.now();

	// Initialize providers
	const embeddings = createEmbeddingProvider(config);
	const llm = createLLMProvider(config);
	const customRetriever = createCustomRetriever(config);

	// Create pipeline
	const pipeline = new BenchmarkPipeline(embeddings, llm, {
		loader: {
			datasetPath: config.dataset,
			variant: config.variant,
			limit: config.limit,
		},
		retriever: {
			method: config.retriever,
			topK: config.topK,
			timeAwareExpansion: false,
		},
		reader: {
			chainOfNote: false,
			abstentionDetection: config.abstention,
			abstentionNLI: false,
			abstentionNLIThreshold: 0.5,
		},
		keyExpansion: {
			enabled: false,
		},
		temporal: {
			enabled: config.temporalAware,
		},
		customRetriever,
		onProgress: callbacks?.onProgress,
	});

	// Run pipeline
	const pipelineResult = await pipeline.run();

	const totalDurationMs = Date.now() - startTime;

	// Map pipeline result to BenchmarkMetrics
	const metrics = mapToMetrics(pipelineResult, totalDurationMs);

	return {
		metrics,
		report: pipelineResult.report,
		jsonl: pipelineResult.jsonl,
	};
}

/**
 * Map pipeline result to BenchmarkMetrics format
 */
function mapToMetrics(
	result: Awaited<ReturnType<BenchmarkPipeline["run"]>>,
	totalDurationMs: number,
): BenchmarkMetrics {
	const { metrics, latency } = result;
	const retrieval = metrics.retrieval;
	const abstention = metrics.abstention;

	return {
		// QA accuracy
		accuracy: metrics.overall.accuracy,

		// Retrieval metrics
		recallAt1: retrieval?.recallAtK?.[1] ?? 0,
		recallAt5: retrieval?.recallAtK?.[5] ?? 0,
		recallAt10: retrieval?.recallAtK?.[10] ?? 0,
		ndcgAt10: retrieval?.ndcgAtK?.[10] ?? 0,
		mrr: retrieval?.mrr ?? 0,

		// Abstention metrics
		abstentionPrecision: abstention?.precision ?? 0,
		abstentionRecall: abstention?.recall ?? 0,
		abstentionF1: abstention?.f1 ?? 0,

		// Latency metrics from pipeline
		p50Latency: latency.p50,
		p95Latency: latency.p95,
		p99Latency: latency.p99,
		totalDurationMs: latency.totalDurationMs || totalDurationMs,
	};
}

/**
 * Create embedding provider from config
 */
function createEmbeddingProvider(config: RunBenchmarkConfig): EmbeddingProvider {
	switch (config.embeddings) {
		case "engram":
			// Engram uses custom retriever, stub is fine for pipeline init
			return new StubEmbeddingProvider();

		case "qdrant":
			return new QdrantEmbeddingProvider({
				url: config.qdrantUrl ?? "http://localhost:6333",
			});

		default:
			return new StubEmbeddingProvider();
	}
}

/**
 * Create LLM provider from config
 */
function createLLMProvider(config: RunBenchmarkConfig): LLMProvider {
	switch (config.llm) {
		case "anthropic":
			if (!process.env.ANTHROPIC_API_KEY) {
				throw new Error("ANTHROPIC_API_KEY environment variable required for Claude");
			}
			return new AnthropicProvider();

		case "openai":
			if (!process.env.OPENAI_API_KEY) {
				throw new Error("OPENAI_API_KEY environment variable required for OpenAI");
			}
			return new OpenAICompatibleProvider();

		case "ollama":
			return new OllamaProvider({
				baseUrl: config.ollamaUrl ?? "http://localhost:11434",
				model: config.ollamaModel ?? "llama3.2",
			});

		default:
			return new StubLLMProvider();
	}
}

/**
 * Create custom retriever for Engram full pipeline
 */
function createCustomRetriever(config: RunBenchmarkConfig): CustomRetriever | undefined {
	if (config.embeddings !== "engram") {
		return undefined;
	}

	return new EngramRetriever({
		qdrantUrl: config.qdrantUrl ?? "http://localhost:6333",
		hybridSearch: config.hybridSearch,
		learnedFusion: config.learnedFusion,
		fusionModel: config.fusionModel,
		rerank: config.rerank,
		rerankTier: config.rerankTier,
		rerankDepth: config.rerankDepth,
		topK: config.topK,
		multiQuery: config.multiQuery,
		multiQueryVariations: config.multiQueryVariations,
		abstention: config.abstention,
		abstentionThreshold: config.abstentionThreshold,
		sessionAware: config.sessionAware,
		topSessions: config.topSessions,
		turnsPerSession: config.turnsPerSession,
		temporalAware: config.temporalAware,
		temporalConfidenceThreshold: config.temporalConfidenceThreshold,
		embeddingModel: config.embeddingModel,
	});
}
