/**
 * Trial execution for optimization loop
 *
 * The Python search service (apps/search) accepts reranker settings per-request
 * via the SearchRequest body. There is no global RuntimeConfig - each search
 * request includes its own rerank, rerank_tier, and rerank_depth parameters.
 *
 * The evaluation function receives the full trial config and should construct
 * search requests with the appropriate settings.
 *
 * @module @engram/tuner/executor
 */

import type { TunerClient } from "../client/tuner-client.js";
import { mapParamsToConfig, type TrialConfig } from "./config-mapper.js";

export interface TrialMetrics {
	// Quality metrics
	ndcg?: number;
	mrr?: number;
	hitRate?: number;
	precision?: number;
	recall?: number;

	// Latency metrics (ms)
	p50Latency?: number;
	p95Latency?: number;
	p99Latency?: number;

	// Abstention metrics
	abstentionPrecision?: number;
	abstentionRecall?: number;
	abstentionF1?: number;
}

export interface ObjectiveConfig {
	/**
	 * How to combine metrics into objective value(s)
	 * - quality: Maximize NDCG
	 * - latency: Minimize P95 latency
	 * - balanced: Weighted combination of quality and latency
	 * - pareto: Multi-objective (returns array of values)
	 */
	mode: "quality" | "latency" | "balanced" | "pareto";

	/**
	 * Weights for balanced mode (quality, latency, cost)
	 */
	weights?: { quality: number; latency: number };

	/**
	 * Latency budget in ms (for balanced mode normalization)
	 */
	latencyBudgetMs?: number;
}

export interface TrialRunnerOptions {
	/**
	 * Tuner service client
	 */
	client: TunerClient;

	/**
	 * Study name to run trials for
	 */
	studyName: string;

	/**
	 * Function to evaluate with given config and return metrics.
	 * Receives the full trial config (reranker, search, abstention settings).
	 */
	evaluationFn: (config: TrialConfig) => Promise<TrialMetrics>;

	/**
	 * Objective configuration
	 */
	objectives: ObjectiveConfig;

	/**
	 * Optional callback for progress reporting
	 */
	onProgress?: (event: TrialProgressEvent) => void;
}

export interface TrialProgressEvent {
	type: "suggest" | "evaluate" | "complete" | "error";
	trialId?: number;
	params?: Record<string, number | string | boolean>;
	config?: TrialConfig;
	metrics?: TrialMetrics;
	objectiveValue?: number | number[];
	error?: Error;
}

/**
 * Compute objective value(s) from metrics based on objective config
 */
export function computeObjectiveValues(
	metrics: TrialMetrics,
	config: ObjectiveConfig,
): number | number[] {
	const { mode, weights, latencyBudgetMs = 500 } = config;

	switch (mode) {
		case "quality":
			return metrics.ndcg ?? 0;

		case "latency":
			// Minimize latency (negate for maximization)
			return -(metrics.p95Latency ?? 1000);

		case "balanced": {
			const w = weights ?? { quality: 0.7, latency: 0.3 };
			const qualityScore = metrics.ndcg ?? 0;
			const latencyScore =
				1 - Math.min((metrics.p95Latency ?? latencyBudgetMs) / latencyBudgetMs, 1);
			return w.quality * qualityScore + w.latency * latencyScore;
		}

		case "pareto":
			// Multi-objective: [maximize quality, minimize latency]
			return [metrics.ndcg ?? 0, -(metrics.p95Latency ?? 1000)];

		default:
			return metrics.ndcg ?? 0;
	}
}

/**
 * Run a single optimization trial
 *
 * 1. Gets next parameters from tuner service
 * 2. Maps parameters to trial configuration
 * 3. Runs evaluation function with full config (includes reranker, search, abstention settings)
 * 4. Computes objective value from metrics
 * 5. Reports results back to tuner service
 *
 * The evaluation function is responsible for passing the config settings
 * to the search service per-request.
 */
export async function runTrial(options: TrialRunnerOptions): Promise<void> {
	const { client, studyName, evaluationFn, objectives, onProgress } = options;

	let trialId: number | undefined;

	try {
		// 1. Get next parameters
		const suggestion = await client.suggestTrial(studyName);
		trialId = suggestion.trial_id;

		// 2. Parse parameters into structured config
		const config = mapParamsToConfig(suggestion.params);

		onProgress?.({
			type: "suggest",
			trialId,
			params: suggestion.params,
			config,
		});

		// 3. Run evaluation with full config
		// The evaluation function should pass reranker settings to search requests
		onProgress?.({ type: "evaluate", trialId });
		const metrics = await evaluationFn(config);

		// 4. Compute objective value(s)
		const objectiveValue = computeObjectiveValues(metrics, objectives);

		// 5. Report results
		await client.completeTrial(studyName, trialId, {
			values: objectiveValue,
			user_attrs: metrics as Record<string, unknown>,
		});

		onProgress?.({
			type: "complete",
			trialId,
			metrics,
			objectiveValue,
		});
	} catch (error) {
		onProgress?.({
			type: "error",
			trialId,
			error: error instanceof Error ? error : new Error(String(error)),
		});
		throw error;
	}
}

/**
 * Run multiple trials in sequence
 */
export async function runTrials(options: TrialRunnerOptions, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await runTrial(options);
	}
}
