import { Counter, Gauge, Histogram } from "prom-client";

/**
 * Prometheus metrics for reranking pipeline observability.
 *
 * These metrics enable monitoring of:
 * - Reranking latency by tier and model
 * - Candidate counts processed
 * - Score improvements from reranking
 * - Request success/failure rates
 */

/**
 * Latency histogram by tier
 *
 * Tracks how long reranking takes for different tiers.
 * Buckets are tuned for sub-second and low-latency operations:
 * - 10ms-50ms: fast tier
 * - 50ms-250ms: accurate/code tiers
 * - 500ms-2000ms: LLM tier
 */
export const rerankLatencyHistogram = new Histogram({
	name: "engram_rerank_latency_seconds",
	help: "Reranking latency in seconds",
	labelNames: ["tier", "model"],
	buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
});

/**
 * Candidate count histogram
 *
 * Tracks how many candidates are being reranked.
 * Helps understand query complexity and batch sizes.
 */
export const rerankCandidatesHistogram = new Histogram({
	name: "engram_rerank_candidates_count",
	help: "Number of candidates processed",
	labelNames: ["tier"],
	buckets: [5, 10, 20, 30, 50, 100],
});

/**
 * Score improvement gauge
 *
 * Tracks average score improvement after reranking.
 * Positive values indicate reranking is improving relevance.
 * Can be used to measure reranking effectiveness.
 */
export const scoreImprovementGauge = new Gauge({
	name: "engram_rerank_score_improvement",
	help: "Average score improvement after reranking",
	labelNames: ["tier"],
});

/**
 * Rerank requests counter
 *
 * Tracks total rerank requests with success/failure status.
 * Use to monitor error rates and throughput.
 */
export const rerankRequestsCounter = new Counter({
	name: "engram_rerank_requests_total",
	help: "Total rerank requests",
	labelNames: ["tier", "status"],
});

/**
 * Record metrics for a reranking operation.
 *
 * @param tier - The reranker tier used
 * @param model - The model identifier
 * @param latencySeconds - Time taken in seconds
 * @param candidateCount - Number of candidates processed
 * @param scoreImprovement - Average score improvement (optional)
 * @param status - success or failure
 */
export function recordRerankMetrics(params: {
	tier: string;
	model: string;
	latencySeconds: number;
	candidateCount: number;
	scoreImprovement?: number;
	status: "success" | "failure";
}): void {
	const { tier, model, latencySeconds, candidateCount, scoreImprovement, status } = params;

	// Record latency
	rerankLatencyHistogram.observe({ tier, model }, latencySeconds);

	// Record candidate count
	rerankCandidatesHistogram.observe({ tier }, candidateCount);

	// Record score improvement if provided
	if (scoreImprovement !== undefined) {
		scoreImprovementGauge.set({ tier }, scoreImprovement);
	}

	// Increment request counter
	rerankRequestsCounter.inc({ tier, status });
}
