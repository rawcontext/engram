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

import type { BenchmarkReport } from "./benchmark-types.js";
import { extractBenchmarkMetrics } from "./benchmark-types.js";
import type { TrialConfig } from "./config-mapper.js";
import type { TrialMetrics } from "./trial-runner.js";

type DatasetVariant = "s" | "m" | "oracle";
type LLMProviderType = "stub" | "anthropic" | "openai" | "gemini" | "ollama";

interface RunBenchmarkConfig {
	dataset: string;
	variant?: DatasetVariant;
	limit?: number;
	qdrantUrl?: string;
	llm?: LLMProviderType;
	ollamaUrl?: string;
	ollamaModel?: string;
	embeddings: string;
	rerank: boolean;
	rerankTier: string;
	rerankDepth: number;
	hybridSearch: boolean;
	abstention: boolean;
	abstentionThreshold: number;
	sessionAware: boolean;
	temporalAware: boolean;
}

/**
 * Type guard to validate string config values
 */
function isString(value: unknown): value is string {
	return typeof value === "string";
}

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
 * Map benchmark report to tuner TrialMetrics format
 *
 * @param report - Full benchmark report
 * @returns Metrics in tuner format
 */
export function mapBenchmarkToTrialMetrics(report: BenchmarkReport): TrialMetrics {
	const benchmarkMetrics = extractBenchmarkMetrics(report);

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
 * Executes the engram-benchmark CLI via subprocess and parses the JSON report.
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
	const { spawn } = await import("node:child_process");
	const { mkdtemp, readFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");

	// Create temporary output directory
	const outputDir = await mkdtemp(join(tmpdir(), "engram-benchmark-"));

	try {
		// Map trial config to benchmark CLI args
		const benchmarkConfig = mapTrialToBenchmarkConfig(trialConfig, options);

		// Validate required string fields
		if (!isString(benchmarkConfig.dataset)) {
			throw new Error("Invalid benchmark config: dataset must be a string");
		}
		if (!isString(benchmarkConfig.rerankTier)) {
			throw new Error("Invalid benchmark config: rerankTier must be a string");
		}

		// Build CLI arguments
		const args = [
			"run",
			"--dataset",
			benchmarkConfig.dataset,
			"--output-dir",
			outputDir,
			"--retriever",
			"engram",
			"--search-url",
			benchmarkConfig.qdrantUrl ?? "http://localhost:5002",
			"--search-strategy",
			benchmarkConfig.hybridSearch ? "hybrid" : "dense",
			"--top-k",
			"10",
		];

		if (benchmarkConfig.limit) {
			args.push("--limit", String(benchmarkConfig.limit));
		}

		if (benchmarkConfig.rerank) {
			args.push("--rerank");
			args.push("--rerank-tier", benchmarkConfig.rerankTier);
		}

		// Run benchmark CLI
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("engram-benchmark", args, {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let lastProgress = "";

			proc.stdout?.on("data", (data: Buffer) => {
				const output = data.toString();
				// Look for progress indicators
				const progressMatch = output.match(/(\w+):\s*(\d+)%/);
				if (progressMatch && options.onProgress) {
					const [, stage, pct] = progressMatch;
					const pctNum = Number.parseInt(pct, 10);
					if (`${stage}:${pct}` !== lastProgress) {
						lastProgress = `${stage}:${pct}`;
						options.onProgress(stage, pctNum);
					}
				}
			});

			proc.stderr?.on("data", (data: Buffer) => {
				console.error(`[benchmark stderr]: ${data.toString()}`);
			});

			proc.on("error", (error) => {
				reject(
					new Error(
						`Failed to spawn engram-benchmark CLI: ${error.message}. Ensure it's installed via 'cd packages/benchmark && uv sync'`,
					),
				);
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Benchmark process exited with code ${code}`));
				}
			});
		});

		// Read the JSON report
		const reportFiles = await import("node:fs/promises").then((fs) => fs.readdir(outputDir));
		const jsonFile = reportFiles.find((f) => f.startsWith("report_") && f.endsWith(".json"));

		if (!jsonFile) {
			throw new Error(`No JSON report found in ${outputDir}`);
		}

		const reportPath = join(outputDir, jsonFile);
		const reportJson = await readFile(reportPath, "utf-8");

		// Parse and validate JSON structure
		let parsedData: unknown;
		try {
			parsedData = JSON.parse(reportJson);
		} catch (error) {
			throw new Error(
				`Failed to parse benchmark report JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		// Basic validation that it's an object
		if (typeof parsedData !== "object" || parsedData === null) {
			throw new Error("Invalid benchmark report: expected an object");
		}

		// Type assertion with validation
		const report = parsedData as BenchmarkReport;

		// Map to TrialMetrics
		return mapBenchmarkToTrialMetrics(report);
	} finally {
		// Cleanup temporary directory
		await rm(outputDir, { recursive: true, force: true });
	}
}
