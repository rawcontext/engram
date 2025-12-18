import { loadDataset, type LoaderConfig } from "./loader.js";
import {
	mapInstance,
	type MapperConfig,
	DEFAULT_MAPPER_CONFIG,
	type EngramDocument,
	type MappedInstance,
} from "./mapper.js";
import {
	Retriever,
	type RetrieverConfig,
	DEFAULT_RETRIEVER_CONFIG,
	computeRetrievalMetrics,
	type EmbeddingProvider,
	type RetrievalResult,
} from "./retriever.js";
import { Reader, type ReaderConfig, DEFAULT_READER_CONFIG, type LLMProvider } from "./reader.js";
import {
	Evaluator,
	type EvaluatorConfig,
	DEFAULT_EVALUATOR_CONFIG,
	formatMetricsReport,
	resultsToJsonl,
} from "./evaluator.js";
import { KeyExpander, type KeyExpansionConfig, type ExpansionType } from "./key-expansion.js";
import { TemporalAnalyzer, type TemporalConfig, filterByTimeRange } from "./temporal.js";
import type { BenchmarkResult, EvaluationMetrics, ParsedInstance } from "./types.js";

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
		const total = instances.length;

		for (let i = 0; i < instances.length; i++) {
			const instance = instances[i];

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

		return {
			results,
			metrics,
			report: formatMetricsReport(metrics),
			jsonl: resultsToJsonl(results),
			details,
		};
	}
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
