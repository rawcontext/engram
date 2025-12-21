/**
 * Engram-specific search space definitions
 *
 * These parameters map to RuntimeConfig in @engram/search
 * Priority is based on parameter sensitivity analysis from docs/auto-tuning.md
 */

import type {
	CategoricalParameter,
	FloatParameter,
	IntParameter,
	SearchSpaceParameter,
} from "../client/types.js";

/**
 * Full Engram search space with all tunable parameters
 */
export const EngramSearchSpace = {
	// Search thresholds (Priority 3-4)
	"search.minScore.dense": {
		type: "float",
		name: "search.minScore.dense",
		low: 0.6,
		high: 0.9,
		step: 0.05,
	} satisfies FloatParameter,

	"search.minScore.hybrid": {
		type: "float",
		name: "search.minScore.hybrid",
		low: 0.35,
		high: 0.65,
		step: 0.05,
	} satisfies FloatParameter,

	"search.minScore.sparse": {
		type: "float",
		name: "search.minScore.sparse",
		low: 0.05,
		high: 0.2,
		step: 0.05,
	} satisfies FloatParameter,

	// Reranker settings (Priority 1-2)
	"reranker.depth": {
		type: "int",
		name: "reranker.depth",
		low: 10,
		high: 100,
		step: 10,
	} satisfies IntParameter,

	"reranker.defaultTier": {
		type: "categorical",
		name: "reranker.defaultTier",
		choices: ["fast", "accurate", "code"],
	} satisfies CategoricalParameter,

	"reranker.timeoutMs": {
		type: "int",
		name: "reranker.timeoutMs",
		low: 200,
		high: 2000,
		step: 100,
	} satisfies IntParameter,

	// Abstention thresholds (Priority 5)
	"abstention.minRetrievalScore": {
		type: "float",
		name: "abstention.minRetrievalScore",
		low: 0.15,
		high: 0.5,
		step: 0.05,
	} satisfies FloatParameter,

	"abstention.minScoreGap": {
		type: "float",
		name: "abstention.minScoreGap",
		low: 0.05,
		high: 0.25,
		step: 0.05,
	} satisfies FloatParameter,

	// Tier-specific settings
	"reranker.tiers.fast.maxCandidates": {
		type: "int",
		name: "reranker.tiers.fast.maxCandidates",
		low: 20,
		high: 100,
		step: 10,
	} satisfies IntParameter,

	"reranker.tiers.accurate.maxCandidates": {
		type: "int",
		name: "reranker.tiers.accurate.maxCandidates",
		low: 10,
		high: 50,
		step: 5,
	} satisfies IntParameter,

	"reranker.tiers.code.maxCandidates": {
		type: "int",
		name: "reranker.tiers.code.maxCandidates",
		low: 10,
		high: 50,
		step: 5,
	} satisfies IntParameter,
} as const;

export type EngramSearchSpaceKey = keyof typeof EngramSearchSpace;

/**
 * Build a search space from selected parameter keys
 */
export function buildSearchSpace(keys: EngramSearchSpaceKey[]): SearchSpaceParameter[] {
	return keys.map((key) => EngramSearchSpace[key]);
}

/**
 * Pre-defined search space presets for common optimization scenarios
 */
export const SearchSpacePresets = {
	/**
	 * Quick optimization - only the highest impact parameters
	 * ~27 trials for reasonable coverage (3^3)
	 */
	quick: buildSearchSpace(["reranker.depth", "reranker.defaultTier", "search.minScore.dense"]),

	/**
	 * Standard optimization - balanced coverage
	 * ~729 trials for full grid (would use TPE sampling)
	 */
	standard: buildSearchSpace([
		"reranker.depth",
		"reranker.defaultTier",
		"search.minScore.dense",
		"search.minScore.hybrid",
		"abstention.minRetrievalScore",
		"reranker.timeoutMs",
	]),

	/**
	 * Full optimization - all parameters
	 * Requires many trials, use with Bayesian optimization
	 */
	full: buildSearchSpace(Object.keys(EngramSearchSpace) as EngramSearchSpaceKey[]),
} as const;

export type SearchSpacePresetName = keyof typeof SearchSpacePresets;
