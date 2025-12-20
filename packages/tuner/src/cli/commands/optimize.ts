/**
 * Optimize command - Start or continue an optimization study
 *
 * This command runs hyperparameter optimization trials using Optuna.
 * It evaluates configurations using the engram-benchmark package,
 * which provides the LongMemEval evaluation suite.
 *
 * @module @engram/tuner/cli/commands
 */

import { TunerClient } from "../../client/tuner-client.js";
import type { Direction, PrunerType, SamplerType } from "../../client/types.js";
import { EvaluationCache } from "../../executor/cache.js";
import { flattenConfig } from "../../executor/config-mapper.js";
import { evaluateWithBenchmark } from "../../executor/evaluation-adapter.js";
import { type ObjectiveConfig, runTrial } from "../../executor/trial-runner.js";
import { type SearchSpacePresetName, SearchSpacePresets } from "../../spaces/engram.js";

type LLMProviderType = "stub" | "anthropic" | "openai" | "gemini" | "ollama";

interface OptimizeOptions {
	dataset: string;
	name: string;
	trials: number;
	objective: "quality" | "latency" | "balanced" | "pareto";
	sampler: SamplerType;
	pruner: PrunerType;
	preset: SearchSpacePresetName;
	serviceUrl: string;
	continue?: boolean;
	// Benchmark options
	limit?: number;
	llm?: LLMProviderType;
	qdrantUrl?: string;
	// Cache options
	cache?: boolean;
	cacheDir?: string;
}

export async function optimizeCommand(options: OptimizeOptions): Promise<void> {
	const client = new TunerClient({ baseUrl: options.serviceUrl });

	console.log(`\n🔧 Engram Tuner - Optimization Study\n`);
	console.log(`  Study:     ${options.name}`);
	console.log(`  Dataset:   ${options.dataset}`);
	console.log(`  Trials:    ${options.trials}`);
	console.log(`  Objective: ${options.objective}`);
	console.log(`  Sampler:   ${options.sampler}`);
	console.log(`  Pruner:    ${options.pruner}`);
	console.log(`  Preset:    ${options.preset}`);
	console.log();

	// Check service health
	try {
		const health = await client.health();
		if (!health.storage_connected) {
			console.error("Error: Tuner service storage not connected");
			console.error("Make sure PostgreSQL is running and accessible");
			process.exit(1);
		}
	} catch (_error) {
		console.error("Error: Could not connect to tuner service at", options.serviceUrl);
		console.error("Make sure the tuner service is running (docker compose up tuner)");
		process.exit(1);
	}

	// Get search space
	const searchSpace = SearchSpacePresets[options.preset];
	if (!searchSpace) {
		console.error(`Error: Unknown preset '${options.preset}'`);
		console.error("Available presets: quick, standard, full");
		process.exit(1);
	}

	// Determine direction(s)
	const direction: Direction | Direction[] =
		options.objective === "pareto"
			? ["maximize", "minimize"] // quality up, latency down
			: "maximize";

	// Create or load study
	if (!options.continue) {
		try {
			const study = await client.createStudy({
				name: options.name,
				direction,
				search_space: searchSpace,
				sampler: options.sampler,
				pruner: options.pruner,
				load_if_exists: true,
			});
			console.log(
				`✓ Study created/loaded: ${study.study_name} (${study.n_trials} existing trials)`,
			);
		} catch (error) {
			console.error("Error creating study:", error);
			process.exit(1);
		}
	}

	// Configure objectives
	const objectives: ObjectiveConfig = {
		mode: options.objective,
		weights: { quality: 0.7, latency: 0.3 },
		latencyBudgetMs: 500,
	};

	// Run trials
	console.log(`\nRunning ${options.trials} trials...\n`);

	// Initialize cache if enabled
	const cache = options.cache ? new EvaluationCache(options.cacheDir ?? ".tuner-cache") : null;
	if (cache) {
		const stats = await cache.getStats();
		console.log(`Cache enabled: ${stats.entries} existing entries\n`);
	}

	// Evaluation using engram-benchmark package (with caching)
	const evaluationFn = async (config: import("../../executor/config-mapper.js").TrialConfig) => {
		// Check cache first
		const params = flattenConfig(config);
		if (cache) {
			const cached = await cache.get(params);
			if (cached) {
				console.log("  [Cache hit]");
				return cached;
			}
		}

		// Run actual evaluation
		const metrics = await evaluateWithBenchmark(config, {
			dataset: options.dataset,
			limit: options.limit,
			llm: options.llm ?? "stub",
			qdrantUrl: options.qdrantUrl,
			onProgress: (stage, pct) => {
				process.stdout.write(`\r  ${stage}: ${pct.toFixed(0)}%  `);
			},
		});

		// Cache the result
		if (cache) {
			await cache.set(params, metrics);
		}

		return metrics;
	};

	for (let i = 0; i < options.trials; i++) {
		try {
			await runTrial({
				client,
				studyName: options.name,
				evaluationFn,
				objectives,
				onProgress: (event) => {
					switch (event.type) {
						case "suggest":
							console.log(`Trial ${event.trialId}: Testing params...`);
							break;
						case "complete":
							console.log(
								`Trial ${event.trialId}: Complete - objective=${JSON.stringify(event.objectiveValue)}`,
							);
							break;
						case "error":
							console.error(`Trial ${event.trialId}: Error - ${event.error?.message}`);
							break;
					}
				},
			});
		} catch (error) {
			console.error(`Trial failed:`, error);
			// Continue with next trial
		}
	}

	// Show final results
	console.log("\n📊 Optimization complete!\n");

	// Show cache statistics
	if (cache) {
		const stats = await cache.getStats();
		console.log(
			`Cache stats: ${stats.hits} hits, ${stats.misses} misses (${(stats.hitRate * 100).toFixed(0)}% hit rate)\n`,
		);
	}

	try {
		const best = await client.getBestParams(options.name);
		console.log("Best parameters:");
		for (const [key, value] of Object.entries(best.params)) {
			console.log(`  ${key}: ${value}`);
		}
		console.log(`\nBest value: ${JSON.stringify(best.value)}`);
		console.log(`Trial ID: ${best.trial_id}`);
	} catch (_error) {
		console.log("Could not retrieve best params (no completed trials yet)");
	}

	console.log(`\nView dashboard: http://localhost:8080`);
}
