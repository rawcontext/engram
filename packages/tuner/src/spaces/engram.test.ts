import { describe, expect, it } from "bun:test";
import { buildSearchSpace, EngramSearchSpace, SearchSpacePresets } from "./engram";

describe("engram search space", () => {
	describe("EngramSearchSpace", () => {
		it("should define search.minScore parameters", () => {
			expect(EngramSearchSpace["search.minScore.dense"]).toEqual({
				type: "float",
				name: "search.minScore.dense",
				low: 0.6,
				high: 0.9,
				step: 0.05,
			});

			expect(EngramSearchSpace["search.minScore.hybrid"]).toEqual({
				type: "float",
				name: "search.minScore.hybrid",
				low: 0.35,
				high: 0.65,
				step: 0.05,
			});

			expect(EngramSearchSpace["search.minScore.sparse"]).toEqual({
				type: "float",
				name: "search.minScore.sparse",
				low: 0.05,
				high: 0.2,
				step: 0.05,
			});
		});

		it("should define reranker parameters", () => {
			expect(EngramSearchSpace["reranker.depth"]).toEqual({
				type: "int",
				name: "reranker.depth",
				low: 10,
				high: 100,
				step: 10,
			});

			expect(EngramSearchSpace["reranker.defaultTier"]).toEqual({
				type: "categorical",
				name: "reranker.defaultTier",
				choices: ["fast", "accurate", "code"],
			});

			expect(EngramSearchSpace["reranker.timeoutMs"]).toEqual({
				type: "int",
				name: "reranker.timeoutMs",
				low: 200,
				high: 2000,
				step: 100,
			});
		});

		it("should define abstention parameters", () => {
			expect(EngramSearchSpace["abstention.minRetrievalScore"]).toEqual({
				type: "float",
				name: "abstention.minRetrievalScore",
				low: 0.15,
				high: 0.5,
				step: 0.05,
			});

			expect(EngramSearchSpace["abstention.minScoreGap"]).toEqual({
				type: "float",
				name: "abstention.minScoreGap",
				low: 0.05,
				high: 0.25,
				step: 0.05,
			});
		});

		it("should define tier-specific parameters", () => {
			expect(EngramSearchSpace["reranker.tiers.fast.maxCandidates"]).toEqual({
				type: "int",
				name: "reranker.tiers.fast.maxCandidates",
				low: 20,
				high: 100,
				step: 10,
			});

			expect(EngramSearchSpace["reranker.tiers.accurate.maxCandidates"]).toEqual({
				type: "int",
				name: "reranker.tiers.accurate.maxCandidates",
				low: 10,
				high: 50,
				step: 5,
			});

			expect(EngramSearchSpace["reranker.tiers.code.maxCandidates"]).toEqual({
				type: "int",
				name: "reranker.tiers.code.maxCandidates",
				low: 10,
				high: 50,
				step: 5,
			});
		});
	});

	describe("buildSearchSpace", () => {
		it("should build search space from selected keys", () => {
			const space = buildSearchSpace(["reranker.depth", "search.minScore.dense"]);

			expect(space).toHaveLength(2);
			expect(space[0]).toEqual(EngramSearchSpace["reranker.depth"]);
			expect(space[1]).toEqual(EngramSearchSpace["search.minScore.dense"]);
		});

		it("should return empty array for empty keys", () => {
			const space = buildSearchSpace([]);

			expect(space).toHaveLength(0);
		});

		it("should preserve order of keys", () => {
			const space = buildSearchSpace([
				"abstention.minScoreGap",
				"reranker.defaultTier",
				"search.minScore.hybrid",
			]);

			expect(space[0].name).toBe("abstention.minScoreGap");
			expect(space[1].name).toBe("reranker.defaultTier");
			expect(space[2].name).toBe("search.minScore.hybrid");
		});
	});

	describe("SearchSpacePresets", () => {
		it("should define quick preset with 3 parameters", () => {
			const quick = SearchSpacePresets.quick;

			expect(quick).toHaveLength(3);
			expect(quick.map((p) => p.name)).toEqual([
				"reranker.depth",
				"reranker.defaultTier",
				"search.minScore.dense",
			]);
		});

		it("should define standard preset with 6 parameters", () => {
			const standard = SearchSpacePresets.standard;

			expect(standard).toHaveLength(6);
			expect(standard.map((p) => p.name)).toContain("reranker.depth");
			expect(standard.map((p) => p.name)).toContain("reranker.defaultTier");
			expect(standard.map((p) => p.name)).toContain("search.minScore.dense");
			expect(standard.map((p) => p.name)).toContain("search.minScore.hybrid");
			expect(standard.map((p) => p.name)).toContain("abstention.minRetrievalScore");
			expect(standard.map((p) => p.name)).toContain("reranker.timeoutMs");
		});

		it("should define full preset with all parameters", () => {
			const full = SearchSpacePresets.full;
			const allKeys = Object.keys(EngramSearchSpace);

			expect(full).toHaveLength(allKeys.length);
		});

		it("should have valid parameter types in all presets", () => {
			for (const [presetName, preset] of Object.entries(SearchSpacePresets)) {
				for (const param of preset) {
					expect(param.type).toMatch(/^(float|int|categorical)$/);
					expect(param.name).toBeDefined();

					if (param.type === "float" || param.type === "int") {
						expect(typeof param.low).toBe("number");
						expect(typeof param.high).toBe("number");
						expect(param.low).toBeLessThan(param.high);
					}

					if (param.type === "categorical") {
						expect(Array.isArray(param.choices)).toBe(true);
						expect(param.choices.length).toBeGreaterThan(0);
					}
				}
			}
		});
	});
});
