import { describe, expect, it } from "bun:test";
import { flattenConfig, mapParamsToConfig, type TrialConfig } from "./config-mapper";

describe("config-mapper", () => {
	describe("mapParamsToConfig", () => {
		it("should map search.minScore parameters", () => {
			const params = {
				"search.minScore.dense": 0.75,
				"search.minScore.sparse": 0.1,
				"search.minScore.hybrid": 0.5,
			};

			const config = mapParamsToConfig(params);

			expect(config.search.minScore).toEqual({
				dense: 0.75,
				sparse: 0.1,
				hybrid: 0.5,
			});
		});

		it("should map reranker direct properties", () => {
			const params = {
				"reranker.depth": 50,
				"reranker.defaultTier": "accurate",
				"reranker.timeoutMs": 1000,
				"reranker.enabled": true,
			};

			const config = mapParamsToConfig(params);

			expect(config.reranker.depth).toBe(50);
			expect(config.reranker.defaultTier).toBe("accurate");
			expect(config.reranker.timeoutMs).toBe(1000);
			expect(config.reranker.enabled).toBe(true);
		});

		it("should map reranker tier-specific properties", () => {
			const params = {
				"reranker.tiers.fast.maxCandidates": 50,
				"reranker.tiers.fast.maxLatencyMs": 100,
				"reranker.tiers.accurate.maxCandidates": 30,
				"reranker.tiers.code.maxLatencyMs": 200,
			};

			const config = mapParamsToConfig(params);

			expect(config.reranker.tiers?.fast?.maxCandidates).toBe(50);
			expect(config.reranker.tiers?.fast?.maxLatencyMs).toBe(100);
			expect(config.reranker.tiers?.accurate?.maxCandidates).toBe(30);
			expect(config.reranker.tiers?.code?.maxLatencyMs).toBe(200);
		});

		it("should map abstention parameters", () => {
			const params = {
				"abstention.minRetrievalScore": 0.25,
				"abstention.minScoreGap": 0.15,
			};

			const config = mapParamsToConfig(params);

			expect(config.abstention.minRetrievalScore).toBe(0.25);
			expect(config.abstention.minScoreGap).toBe(0.15);
		});

		it("should handle empty params", () => {
			const config = mapParamsToConfig({});

			expect(config.reranker).toEqual({});
			expect(config.search).toEqual({});
			expect(config.abstention).toEqual({});
		});

		it("should ignore unknown parameters", () => {
			const params = {
				"unknown.param": 123,
				"another.unknown": "value",
			};

			const config = mapParamsToConfig(params);

			expect(config.reranker).toEqual({});
			expect(config.search).toEqual({});
			expect(config.abstention).toEqual({});
		});

		it("should ignore invalid tier names", () => {
			const params = {
				"reranker.tiers.invalid.maxCandidates": 50,
			};

			const config = mapParamsToConfig(params);

			expect(config.reranker.tiers).toBeUndefined();
		});

		it("should ignore type mismatches", () => {
			const params = {
				"reranker.depth": "not a number" as unknown as number,
				"reranker.defaultTier": 123 as unknown as string,
				"reranker.enabled": "true" as unknown as boolean,
			};

			const config = mapParamsToConfig(params);

			expect(config.reranker.depth).toBeUndefined();
			expect(config.reranker.defaultTier).toBeUndefined();
			expect(config.reranker.enabled).toBeUndefined();
		});

		it("should handle all parameters together", () => {
			const params = {
				"search.minScore.dense": 0.8,
				"reranker.depth": 40,
				"reranker.defaultTier": "fast",
				"reranker.tiers.fast.maxCandidates": 60,
				"abstention.minRetrievalScore": 0.3,
			};

			const config = mapParamsToConfig(params);

			expect(config.search.minScore?.dense).toBe(0.8);
			expect(config.reranker.depth).toBe(40);
			expect(config.reranker.defaultTier).toBe("fast");
			expect(config.reranker.tiers?.fast?.maxCandidates).toBe(60);
			expect(config.abstention.minRetrievalScore).toBe(0.3);
		});
	});

	describe("flattenConfig", () => {
		it("should flatten search.minScore", () => {
			const config: TrialConfig = {
				reranker: {},
				search: { minScore: { dense: 0.8, sparse: 0.1, hybrid: 0.5 } },
				abstention: {},
			};

			const params = flattenConfig(config);

			expect(params["search.minScore.dense"]).toBe(0.8);
			expect(params["search.minScore.sparse"]).toBe(0.1);
			expect(params["search.minScore.hybrid"]).toBe(0.5);
		});

		it("should flatten reranker properties", () => {
			const config: TrialConfig = {
				reranker: {
					depth: 50,
					defaultTier: "accurate",
					timeoutMs: 1000,
					enabled: true,
				},
				search: {},
				abstention: {},
			};

			const params = flattenConfig(config);

			expect(params["reranker.depth"]).toBe(50);
			expect(params["reranker.defaultTier"]).toBe("accurate");
			expect(params["reranker.timeoutMs"]).toBe(1000);
			expect(params["reranker.enabled"]).toBe(true);
		});

		it("should flatten reranker tier properties", () => {
			const config: TrialConfig = {
				reranker: {
					tiers: {
						fast: { maxCandidates: 50, maxLatencyMs: 100 },
						accurate: { maxCandidates: 30 },
					},
				},
				search: {},
				abstention: {},
			};

			const params = flattenConfig(config);

			expect(params["reranker.tiers.fast.maxCandidates"]).toBe(50);
			expect(params["reranker.tiers.fast.maxLatencyMs"]).toBe(100);
			expect(params["reranker.tiers.accurate.maxCandidates"]).toBe(30);
		});

		it("should flatten abstention properties", () => {
			const config: TrialConfig = {
				reranker: {},
				search: {},
				abstention: { minRetrievalScore: 0.25, minScoreGap: 0.15 },
			};

			const params = flattenConfig(config);

			expect(params["abstention.minRetrievalScore"]).toBe(0.25);
			expect(params["abstention.minScoreGap"]).toBe(0.15);
		});

		it("should handle empty config", () => {
			const config: TrialConfig = {
				reranker: {},
				search: {},
				abstention: {},
			};

			const params = flattenConfig(config);

			expect(Object.keys(params).length).toBe(0);
		});

		it("should be inverse of mapParamsToConfig", () => {
			const originalParams = {
				"search.minScore.dense": 0.75,
				"reranker.depth": 40,
				"reranker.defaultTier": "fast" as const,
				"reranker.tiers.accurate.maxCandidates": 25,
				"abstention.minScoreGap": 0.1,
			};

			const config = mapParamsToConfig(originalParams);
			const flattened = flattenConfig(config);

			expect(flattened).toEqual(originalParams);
		});
	});
});
