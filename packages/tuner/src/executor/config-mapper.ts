/**
 * Maps flat parameter names to configuration structures
 *
 * TODO: Update to work with Python search service API
 * Previously used @engram/search RuntimeConfig which has been migrated to Python.
 */

// TODO: Define based on Python search service API
type RerankerTier = "fast" | "accurate" | "code";

/**
 * Partial RerankerConfig structure for RuntimeConfig.update()
 */
export interface PartialRerankerConfig {
	enabled?: boolean;
	defaultTier?: RerankerTier;
	depth?: number;
	timeoutMs?: number;
	tiers?: {
		fast?: { maxCandidates?: number; maxLatencyMs?: number };
		accurate?: { maxCandidates?: number; maxLatencyMs?: number };
		code?: { maxCandidates?: number; maxLatencyMs?: number };
	};
}

/**
 * Search and abstention settings (passed to benchmark, not RuntimeConfig)
 */
export interface SearchSettings {
	minScore?: {
		dense?: number;
		sparse?: number;
		hybrid?: number;
	};
}

export interface AbstentionSettings {
	minRetrievalScore?: number;
	minScoreGap?: number;
}

/**
 * Complete trial configuration split by destination
 */
export interface TrialConfig {
	/** Settings for RuntimeConfig.update() */
	reranker: PartialRerankerConfig;
	/** Settings to pass to benchmark evaluation */
	search: SearchSettings;
	/** Settings to pass to benchmark evaluation */
	abstention: AbstentionSettings;
}

/**
 * Map flat parameter names (from search space) to split config structures
 *
 * @param params - Flat parameter map from trial suggestion
 * @returns Split config: reranker for RuntimeConfig, search/abstention for benchmark
 */
export function mapParamsToConfig(params: Record<string, number | string | boolean>): TrialConfig {
	const config: TrialConfig = {
		reranker: {},
		search: {},
		abstention: {},
	};

	for (const [key, value] of Object.entries(params)) {
		const parts = key.split(".");

		if (parts[0] === "search" && parts[1] === "minScore") {
			config.search.minScore ??= {};
			if (parts[2] === "dense") config.search.minScore.dense = value as number;
			if (parts[2] === "sparse") config.search.minScore.sparse = value as number;
			if (parts[2] === "hybrid") config.search.minScore.hybrid = value as number;
		} else if (parts[0] === "reranker") {
			if (parts.length === 2) {
				// Direct reranker properties
				if (parts[1] === "depth") config.reranker.depth = value as number;
				if (parts[1] === "defaultTier") config.reranker.defaultTier = value as RerankerTier;
				if (parts[1] === "timeoutMs") config.reranker.timeoutMs = value as number;
				if (parts[1] === "enabled") config.reranker.enabled = value as boolean;
			} else if (parts[1] === "tiers" && parts.length === 4) {
				// Tier-specific properties: reranker.tiers.{tier}.{property}
				const tier = parts[2] as "fast" | "accurate" | "code";
				const prop = parts[3];

				config.reranker.tiers ??= {};
				config.reranker.tiers[tier] ??= {};
				const tierConfig = config.reranker.tiers[tier];

				if (prop === "maxCandidates" && tierConfig) {
					tierConfig.maxCandidates = value as number;
				}
				if (prop === "maxLatencyMs" && tierConfig) {
					tierConfig.maxLatencyMs = value as number;
				}
			}
		} else if (parts[0] === "abstention") {
			if (parts[1] === "minRetrievalScore") {
				config.abstention.minRetrievalScore = value as number;
			}
			if (parts[1] === "minScoreGap") {
				config.abstention.minScoreGap = value as number;
			}
		}
	}

	return config;
}

/**
 * Flatten a trial config back to parameter names
 * (inverse of mapParamsToConfig, useful for logging/display)
 */
export function flattenConfig(config: TrialConfig): Record<string, number | string | boolean> {
	const params: Record<string, number | string | boolean> = {};

	if (config.search?.minScore) {
		const ms = config.search.minScore;
		if (ms.dense !== undefined) params["search.minScore.dense"] = ms.dense;
		if (ms.sparse !== undefined) params["search.minScore.sparse"] = ms.sparse;
		if (ms.hybrid !== undefined) params["search.minScore.hybrid"] = ms.hybrid;
	}

	const r = config.reranker;
	if (r.depth !== undefined) params["reranker.depth"] = r.depth;
	if (r.defaultTier !== undefined) params["reranker.defaultTier"] = r.defaultTier;
	if (r.timeoutMs !== undefined) params["reranker.timeoutMs"] = r.timeoutMs;
	if (r.enabled !== undefined) params["reranker.enabled"] = r.enabled;

	if (r.tiers) {
		for (const [tier, props] of Object.entries(r.tiers)) {
			if (props?.maxCandidates !== undefined) {
				params[`reranker.tiers.${tier}.maxCandidates`] = props.maxCandidates;
			}
			if (props?.maxLatencyMs !== undefined) {
				params[`reranker.tiers.${tier}.maxLatencyMs`] = props.maxLatencyMs;
			}
		}
	}

	const a = config.abstention;
	if (a.minRetrievalScore !== undefined) {
		params["abstention.minRetrievalScore"] = a.minRetrievalScore;
	}
	if (a.minScoreGap !== undefined) {
		params["abstention.minScoreGap"] = a.minScoreGap;
	}

	return params;
}
