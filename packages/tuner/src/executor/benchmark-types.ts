/**
 * TypeScript types matching Python benchmark API response schema
 *
 * These types mirror the Pydantic models in:
 * - packages/benchmark/src/engram_benchmark/longmemeval/types.py
 * - packages/benchmark/src/engram_benchmark/utils/reporting.py
 * - packages/benchmark/src/engram_benchmark/metrics/latency.py
 *
 * @module @engram/tuner/executor
 */

/**
 * Memory ability categories from LongMemEval
 */
export type MemoryAbility = "IE" | "MR" | "TR" | "KU" | "ABS";

/**
 * Aggregate metrics per memory ability
 */
export interface AbilityMetrics {
	/** Total number of instances */
	total: number;
	/** Number of correct predictions */
	correct: number;
	/** Accuracy score (0.0 to 1.0) */
	accuracy: number;
}

/**
 * Retrieval quality metrics
 */
export interface RetrievalMetrics {
	/** Percentage of evidence turns retrieved (0.0 to 1.0) */
	turn_recall: number;
	/** Percentage of evidence sessions retrieved (0.0 to 1.0) */
	session_recall: number;
	/** Recall at different K values (1, 5, 10) */
	recall_at_k: Record<number, number>;
	/** NDCG at different K values - measures ranking quality */
	ndcg_at_k: Record<number, number>;
	/** Mean Reciprocal Rank (0.0 to 1.0) */
	mrr: number;
}

/**
 * Abstention-specific metrics
 */
export interface AbstentionMetrics {
	/** Correctly abstained */
	true_positives: number;
	/** Incorrectly abstained */
	false_positives: number;
	/** Should have abstained but didn't */
	false_negatives: number;
	/** Correctly answered */
	true_negatives: number;
	/** Correct abstentions / total abstentions (0.0 to 1.0) */
	precision: number;
	/** Correct abstentions / questions requiring abstention (0.0 to 1.0) */
	recall: number;
	/** Harmonic mean of precision and recall (0.0 to 1.0) */
	f1: number;
}

/**
 * Full evaluation metrics from benchmark
 */
export interface EvaluationMetrics {
	/** Overall performance across all instances */
	overall: AbilityMetrics;
	/** Performance breakdown by memory ability */
	by_ability: Record<MemoryAbility, AbilityMetrics>;
	/** Retrieval metrics (optional) */
	retrieval?: RetrievalMetrics;
	/** Abstention metrics (optional) */
	abstention?: AbstentionMetrics;
}

/**
 * Complete benchmark report with all metrics and metadata
 *
 * This is the top-level response from the Python benchmark API.
 */
export interface BenchmarkReport {
	/** ISO timestamp of when the report was generated */
	timestamp: string;
	/** Path to the dataset file */
	dataset_path: string;
	/** Total number of instances evaluated */
	total_instances: number;
	/** LLM model name (optional) */
	model_name?: string;
	/** Embedding model name (optional) */
	embedding_model?: string;
	/** Reranker model name (optional) */
	reranker_model?: string;
	/** Retrieval strategy used (optional) */
	retrieval_strategy?: string;
	/** All evaluation metrics */
	metrics: EvaluationMetrics;
	/** Configuration used for the benchmark run */
	config: Record<string, unknown>;
}

/**
 * Latency percentile metrics
 *
 * Note: This is currently NOT returned by the benchmark API but is
 * available in the metrics module for future use.
 */
export interface LatencyMetrics {
	/** Number of measurements */
	count: number;
	/** Mean latency in milliseconds */
	mean_ms: number;
	/** Median latency in milliseconds */
	median_ms: number;
	/** 50th percentile (same as median) */
	p50_ms: number;
	/** 90th percentile */
	p90_ms: number;
	/** 95th percentile */
	p95_ms: number;
	/** 99th percentile */
	p99_ms: number;
	/** Minimum latency */
	min_ms: number;
	/** Maximum latency */
	max_ms: number;
}

/**
 * Simplified metrics for tuner integration
 *
 * This is a flattened version of the benchmark metrics that's easier
 * to work with in the tuner. Maps BenchmarkReport -> BenchmarkMetrics.
 */
export interface BenchmarkMetrics {
	/** Overall accuracy (0.0 to 1.0) */
	accuracy: number;
	/** Recall@1 (0.0 to 1.0) */
	recallAt1: number;
	/** Recall@5 (0.0 to 1.0) */
	recallAt5: number;
	/** Recall@10 (0.0 to 1.0) */
	recallAt10: number;
	/** NDCG@10 (0.0 to 1.0) */
	ndcgAt10: number;
	/** Mean Reciprocal Rank (0.0 to 1.0) */
	mrr: number;
	/** Abstention precision (0.0 to 1.0) */
	abstentionPrecision: number;
	/** Abstention recall (0.0 to 1.0) */
	abstentionRecall: number;
	/** Abstention F1 score (0.0 to 1.0) */
	abstentionF1: number;
	/** 50th percentile latency in milliseconds */
	p50Latency: number;
	/** 95th percentile latency in milliseconds */
	p95Latency: number;
	/** 99th percentile latency in milliseconds */
	p99Latency: number;
	/** Total duration in milliseconds */
	totalDurationMs: number;
}

/**
 * Convert BenchmarkReport to simplified BenchmarkMetrics
 *
 * @param report - Full benchmark report from Python API
 * @returns Flattened metrics for tuner consumption
 */
export function extractBenchmarkMetrics(report: BenchmarkReport): BenchmarkMetrics {
	const metrics = report.metrics;

	return {
		accuracy: metrics.overall.accuracy,
		recallAt1: metrics.retrieval?.recall_at_k[1] ?? 0,
		recallAt5: metrics.retrieval?.recall_at_k[5] ?? 0,
		recallAt10: metrics.retrieval?.recall_at_k[10] ?? 0,
		ndcgAt10: metrics.retrieval?.ndcg_at_k[10] ?? 0,
		mrr: metrics.retrieval?.mrr ?? 0,
		abstentionPrecision: metrics.abstention?.precision ?? 0,
		abstentionRecall: metrics.abstention?.recall ?? 0,
		abstentionF1: metrics.abstention?.f1 ?? 0,
		// Latency metrics not currently provided by benchmark API
		p50Latency: 0,
		p95Latency: 0,
		p99Latency: 0,
		totalDurationMs: 0,
	};
}
