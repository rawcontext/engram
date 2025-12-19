import {
	DEFAULT_EVALUATOR_CONFIG,
	Evaluator,
	type EvaluatorConfig,
	formatMetricsReport,
	resultsToJsonl,
} from "./evaluator.js";
import { KeyExpander, type KeyExpansionConfig } from "./key-expansion.js";
import { type LoaderConfig, loadDataset } from "./loader.js";
import {
	DEFAULT_MAPPER_CONFIG,
	type EngramDocument,
	type MappedInstance,
	type MapperConfig,
	mapInstance,
} from "./mapper.js";
import { DEFAULT_READER_CONFIG, type LLMProvider, Reader, type ReaderConfig } from "./reader.js";
import {
	computeRetrievalMetrics,
	DEFAULT_RETRIEVER_CONFIG,
	type EmbeddingProvider,
	type RetrievalResult,
	Retriever,
	type RetrieverConfig,
} from "./retriever.js";
import { filterByTimeRange, TemporalAnalyzer, type TemporalConfig } from "./temporal.js";
import type { BenchmarkResult, EvaluationMetrics } from "./types.js";

/**
 * Interface for custom retrievers (e.g., EngramRetriever)
 */
export interface CustomRetriever {
	indexInstance(mapped: MappedInstance): Promise<void>;
	retrieve(question: string, questionDate?: Date): Promise<RetrievalResult>;
	clear(): void;
}

/**
 * Full pipeline configuration
 */
export interface PipelineConfig {
	/** Dataset loading configuration */
	loader: LoaderConfig;
	/** Mapper configuration */
	mapper?: Partial<MapperConfig>;
	/** Retriever configuration */
	retriever?: Partial<RetrieverConfig>;
	/** Reader configuration */
	reader?: Partial<ReaderConfig>;
	/** Evaluator configuration */
	evaluator?: Partial<EvaluatorConfig>;
	/** Key expansion configuration (Milestone 2) */
	keyExpansion?: Partial<KeyExpansionConfig> & { enabled?: boolean };
	/** Temporal analysis configuration (Milestone 2) */
	temporal?: Partial<TemporalConfig> & { enabled?: boolean };
	/** Progress callback */
	onProgress?: (progress: PipelineProgress) => void;
	/** Optional custom retriever (overrides default) */
	customRetriever?: CustomRetriever;
}

/**
 * Progress information during pipeline execution
 */
export interface PipelineProgress {
	stage: "loading" | "indexing" | "retrieving" | "reading" | "evaluating";
	current: number;
	total: number;
	message: string;
}

/**
 * Latency metrics computed from per-query timings
 */
export interface LatencyMetrics {
	/** Per-query latencies in ms (for computing percentiles) */
	perQueryLatencies: number[];
	/** 50th percentile latency in ms */
	p50: number;
	/** 95th percentile latency in ms */
	p95: number;
	/** 99th percentile latency in ms */
	p99: number;
	/** Mean latency in ms */
	mean: number;
	/** Total pipeline duration in ms */
	totalDurationMs: number;
}

/**
 * Result of running the full pipeline
 */
export interface PipelineResult {
	/** All benchmark results */
	results: BenchmarkResult[];
	/** Evaluation metrics */
	metrics: EvaluationMetrics;
	/** Human-readable report */
	report: string;
	/** JSONL output (LongMemEval format) */
	jsonl: string;
	/** Per-instance details for debugging */
	details: InstanceDetail[];
	/** Latency metrics */
	latency: LatencyMetrics;
}

/**
 * Details for a single instance (for debugging)
 */
export interface InstanceDetail {
	questionId: string;
	question: string;
	answer: string;
	hypothesis: string;
	correct: boolean;
	retrievedCount: number;
	evidenceRetrieved: number;
	retrievalRecall: number;
	/** Query latency in ms (retrieval + reading time) */
	latencyMs: number;
}

/**
 * Main benchmark pipeline
 */
export class BenchmarkPipeline {
	private embeddings: EmbeddingProvider;
	private llm: LLMProvider;
	private config: PipelineConfig;

	constructor(embeddings: EmbeddingProvider, llm: LLMProvider, config: PipelineConfig) {
		this.embeddings = embeddings;
		this.llm = llm;
		this.config = config;
	}

	/**
	 * Run the full benchmark pipeline
	 */
	async run(): Promise<PipelineResult> {
		const pipelineStartTime = Date.now();
		const { onProgress } = this.config;

		// Stage 1: Load dataset
		onProgress?.({
			stage: "loading",
			current: 0,
			total: 1,
			message: "Loading dataset...",
		});

		const { instances, stats } = await loadDataset(this.config.loader);

		onProgress?.({
			stage: "loading",
			current: 1,
			total: 1,
			message: `Loaded ${stats.totalInstances} instances`,
		});

		// Initialize components
		const mapperConfig = { ...DEFAULT_MAPPER_CONFIG, ...this.config.mapper };
		const retrieverConfig = { ...DEFAULT_RETRIEVER_CONFIG, ...this.config.retriever };
		const readerConfig = { ...DEFAULT_READER_CONFIG, ...this.config.reader };
		const evaluatorConfig = { ...DEFAULT_EVALUATOR_CONFIG, ...this.config.evaluator };

		// Use custom retriever if provided, otherwise create default
		const retriever =
			this.config.customRetriever ?? new Retriever(this.embeddings, retrieverConfig);
		const reader = new Reader(this.llm, readerConfig);
		const evaluator = new Evaluator(evaluatorConfig, this.llm);

		// Initialize optional Milestone 2 components
		const keyExpander = this.config.keyExpansion?.enabled
			? new KeyExpander({ ...this.config.keyExpansion, llm: this.llm })
			: null;
		const temporalAnalyzer = this.config.temporal?.enabled
			? new TemporalAnalyzer({ ...this.config.temporal, llm: this.llm })
			: null;

		// Process each instance
		const results: BenchmarkResult[] = [];
		const details: InstanceDetail[] = [];
		const perQueryLatencies: number[] = [];
		const total = instances.length;

		for (let i = 0; i < instances.length; i++) {
			const instance = instances[i];
			const queryStartTime = Date.now();

			// Stage 2: Map and index
			onProgress?.({
				stage: "indexing",
				current: i + 1,
				total,
				message: `Indexing instance ${i + 1}/${total}`,
			});

			const mapped = mapInstance(instance, mapperConfig);

			// Apply key expansion if enabled (Milestone 2)
			let documentsToIndex: EngramDocument[] = mapped.documents;
			if (keyExpander) {
				const expanded = await keyExpander.expandBatch(mapped.documents);
				documentsToIndex = expanded;
			}

			await retriever.indexInstance({ ...mapped, documents: documentsToIndex });

			// Stage 3: Retrieve
			onProgress?.({
				stage: "retrieving",
				current: i + 1,
				total,
				message: `Retrieving for ${instance.questionId}`,
			});

			// Apply temporal analysis if enabled (Milestone 2)
			let queryForRetrieval = instance.question;
			let temporalTimeRange: { start: Date; end: Date } | undefined;

			if (temporalAnalyzer) {
				const temporalAnalysis = await temporalAnalyzer.analyze(
					instance.question,
					instance.questionDate,
				);
				queryForRetrieval = temporalAnalysis.expandedQuery;
				temporalTimeRange = temporalAnalysis.timeRange;
			}

			let retrieved = await retriever.retrieve(queryForRetrieval, instance.questionDate);

			// Apply temporal filtering if we have a time range
			if (temporalTimeRange && retrieved.documents.length > 0) {
				const filtered = filterByTimeRange(retrieved.documents, temporalTimeRange);
				// Only use filtered if we have enough results
				if (filtered.length >= Math.min(3, retrieved.documents.length / 2)) {
					retrieved = {
						...retrieved,
						documents: filtered,
						retrievedIds: filtered.map((d) => d.id),
						scores: retrieved.scores.slice(0, filtered.length),
					};
				}
			}

			const retrievalMetrics = computeRetrievalMetrics(retrieved, mapped.evidenceDocIds);

			// Stage 4: Read/Generate answer
			onProgress?.({
				stage: "reading",
				current: i + 1,
				total,
				message: `Generating answer for ${instance.questionId}`,
			});

			const readResult = await reader.read(
				instance.question,
				retrieved.documents,
				instance.questionDate,
				retrieved.scores,
			);

			// Compute query latency (indexing + retrieval + reading)
			const queryLatencyMs = Date.now() - queryStartTime;
			perQueryLatencies.push(queryLatencyMs);

			// Store result
			results.push({
				questionId: instance.questionId,
				hypothesis: readResult.hypothesis,
			});

			// Store detail
			details.push({
				questionId: instance.questionId,
				question: instance.question,
				answer: instance.answer,
				hypothesis: readResult.hypothesis,
				correct: false, // Will be set during evaluation
				retrievedCount: retrieved.documents.length,
				evidenceRetrieved: mapped.evidenceDocIds.filter((id) => retrieved.retrievedIds.includes(id))
					.length,
				retrievalRecall: retrievalMetrics.recall,
				latencyMs: queryLatencyMs,
			});

			// Clear index for next instance
			retriever.clear();
		}

		// Stage 5: Evaluate
		onProgress?.({
			stage: "evaluating",
			current: 0,
			total: 1,
			message: "Evaluating results...",
		});

		const { evaluated, metrics } = await evaluator.evaluateAll(results, instances);

		// Update details with evaluation results
		for (const evalResult of evaluated) {
			const detail = details.find((d) => d.questionId === evalResult.questionId);
			if (detail) {
				detail.correct = evalResult.correct;
			}
		}

		// Add retrieval metrics
		const avgRetrievalRecall =
			details.reduce((sum, d) => sum + d.retrievalRecall, 0) / details.length;
		metrics.retrieval = {
			turnRecall: avgRetrievalRecall,
			sessionRecall: avgRetrievalRecall, // Simplified for MVP
			recallAtK: { 1: 0, 5: 0, 10: avgRetrievalRecall }, // Simplified for MVP
			ndcgAtK: { 1: 0, 5: 0, 10: avgRetrievalRecall }, // Simplified for MVP
			mrr: avgRetrievalRecall, // Simplified for MVP
		};

		onProgress?.({
			stage: "evaluating",
			current: 1,
			total: 1,
			message: "Evaluation complete",
		});

		// Compute latency metrics
		const totalDurationMs = Date.now() - pipelineStartTime;
		const latency = computeLatencyMetrics(perQueryLatencies, totalDurationMs);

		return {
			results,
			metrics,
			report: formatMetricsReport(metrics),
			jsonl: resultsToJsonl(results),
			details,
			latency,
		};
	}
}

/**
 * Compute latency percentiles from an array of latencies
 */
function computeLatencyMetrics(latencies: number[], totalDurationMs: number): LatencyMetrics {
	if (latencies.length === 0) {
		return {
			perQueryLatencies: [],
			p50: 0,
			p95: 0,
			p99: 0,
			mean: 0,
			totalDurationMs,
		};
	}

	const sorted = [...latencies].sort((a, b) => a - b);
	const len = sorted.length;

	// Compute percentile indices
	const p50Index = Math.floor(len * 0.5);
	const p95Index = Math.min(Math.floor(len * 0.95), len - 1);
	const p99Index = Math.min(Math.floor(len * 0.99), len - 1);

	// Compute mean
	const sum = latencies.reduce((acc, val) => acc + val, 0);
	const mean = sum / len;

	return {
		perQueryLatencies: latencies,
		p50: sorted[p50Index],
		p95: sorted[p95Index],
		p99: sorted[p99Index],
		mean: Math.round(mean),
		totalDurationMs,
	};
}

/**
 * Quick evaluation of existing results file
 */
export async function evaluateResults(
	resultsPath: string,
	datasetPath: string,
	llm?: LLMProvider,
): Promise<{ metrics: EvaluationMetrics; report: string }> {
	const { readFile } = await import("node:fs/promises");

	// Load results
	const resultsContent = await readFile(resultsPath, "utf-8");
	const { parseJsonlResults } = await import("./evaluator.js");
	const results = parseJsonlResults(resultsContent);

	// Load dataset
	const { instances } = await loadDataset({ datasetPath });

	// Evaluate
	const evaluator = new Evaluator({ useLLMEvaluation: !!llm }, llm);
	const { metrics } = await evaluator.evaluateAll(results, instances);

	return {
		metrics,
		report: formatMetricsReport(metrics),
	};
}
