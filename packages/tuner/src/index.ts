/**
 * @engram/tuner - Hyperparameter optimization orchestration for Engram search
 *
 * This package provides:
 * - TunerClient: HTTP client for the tuner service API
 * - Search space definitions for Engram parameters
 * - Trial execution and config mapping
 * - CLI commands for optimization workflows
 */

// Client
export { TunerClient, TunerClientError, type TunerClientOptions } from "./client/tuner-client.js";
export * from "./client/types.js";
// Executor
export {
	type AbstentionSettings,
	flattenConfig,
	mapParamsToConfig,
	type PartialRerankerConfig,
	type SearchSettings,
	type TrialConfig,
} from "./executor/config-mapper.js";
export {
	computeObjectiveValues,
	type ObjectiveConfig,
	runTrial,
	runTrials,
	type TrialMetrics,
	type TrialProgressEvent,
	type TrialRunnerOptions,
} from "./executor/trial-runner.js";
// Search spaces
export {
	buildSearchSpace,
	EngramSearchSpace,
	type EngramSearchSpaceKey,
	type SearchSpacePresetName,
	SearchSpacePresets,
} from "./spaces/engram.js";
