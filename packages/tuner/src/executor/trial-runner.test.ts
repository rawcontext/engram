import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { TunerClient } from "../client/tuner-client";
import {
	computeObjectiveValues,
	type ObjectiveConfig,
	runTrial,
	runTrials,
	type TrialMetrics,
	type TrialProgressEvent,
	type TrialRunnerOptions,
} from "./trial-runner";

describe("trial-runner", () => {
	describe("computeObjectiveValues", () => {
		it("should return ndcg for quality mode", () => {
			const metrics: TrialMetrics = { ndcg: 0.85, p95Latency: 100 };
			const config: ObjectiveConfig = { mode: "quality" };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toBe(0.85);
		});

		it("should return 0 for quality mode with undefined ndcg", () => {
			const metrics: TrialMetrics = { p95Latency: 100 };
			const config: ObjectiveConfig = { mode: "quality" };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toBe(0);
		});

		it("should return negated latency for latency mode", () => {
			const metrics: TrialMetrics = { ndcg: 0.85, p95Latency: 150 };
			const config: ObjectiveConfig = { mode: "latency" };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toBe(-150);
		});

		it("should return -1000 for latency mode with undefined latency", () => {
			const metrics: TrialMetrics = { ndcg: 0.85 };
			const config: ObjectiveConfig = { mode: "latency" };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toBe(-1000);
		});

		it("should compute weighted score for balanced mode", () => {
			const metrics: TrialMetrics = { ndcg: 0.8, p95Latency: 250 };
			const config: ObjectiveConfig = {
				mode: "balanced",
				weights: { quality: 0.7, latency: 0.3 },
				latencyBudgetMs: 500,
			};

			const result = computeObjectiveValues(metrics, config);

			// quality: 0.7 * 0.8 = 0.56
			// latency: 0.3 * (1 - 250/500) = 0.3 * 0.5 = 0.15
			// total: 0.71
			expect(result).toBeCloseTo(0.71);
		});

		it("should use default weights for balanced mode", () => {
			const metrics: TrialMetrics = { ndcg: 1.0, p95Latency: 0 };
			const config: ObjectiveConfig = { mode: "balanced" };

			const result = computeObjectiveValues(metrics, config);

			// Default: 0.7 * 1.0 + 0.3 * 1.0 = 1.0
			expect(result).toBe(1.0);
		});

		it("should cap latency score at 0 when over budget", () => {
			const metrics: TrialMetrics = { ndcg: 0.8, p95Latency: 1000 };
			const config: ObjectiveConfig = {
				mode: "balanced",
				weights: { quality: 0.7, latency: 0.3 },
				latencyBudgetMs: 500,
			};

			const result = computeObjectiveValues(metrics, config);

			// latency capped: 1 - min(1000/500, 1) = 0
			// total: 0.7 * 0.8 + 0.3 * 0 = 0.56
			expect(result).toBeCloseTo(0.56);
		});

		it("should return array for pareto mode", () => {
			const metrics: TrialMetrics = { ndcg: 0.9, p95Latency: 200 };
			const config: ObjectiveConfig = { mode: "pareto" };

			const result = computeObjectiveValues(metrics, config);

			expect(Array.isArray(result)).toBe(true);
			expect(result).toEqual([0.9, -200]);
		});

		it("should return default values for pareto mode with undefined metrics", () => {
			const metrics: TrialMetrics = {};
			const config: ObjectiveConfig = { mode: "pareto" };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toEqual([0, -1000]);
		});

		it("should fallback to ndcg for unknown mode", () => {
			const metrics: TrialMetrics = { ndcg: 0.75 };
			const config: ObjectiveConfig = { mode: "unknown" as ObjectiveConfig["mode"] };

			const result = computeObjectiveValues(metrics, config);

			expect(result).toBe(0.75);
		});
	});

	describe("runTrial", () => {
		let mockClient: TunerClient;
		let mockEvaluationFn: ReturnType<typeof mock>;
		let progressEvents: TrialProgressEvent[];

		beforeEach(() => {
			progressEvents = [];

			mockClient = {
				suggestTrial: mock(async () => ({
					trial_id: 1,
					params: { "reranker.depth": 50, "search.minScore.dense": 0.8 },
				})),
				completeTrial: mock(async () => ({ trial_id: 1, state: "COMPLETE" })),
			} as unknown as TunerClient;

			mockEvaluationFn = mock(async () => ({
				ndcg: 0.85,
				p95Latency: 150,
			}));
		});

		it("should run a complete trial workflow", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
				onProgress: (event) => progressEvents.push(event),
			};

			await runTrial(options);

			expect(mockClient.suggestTrial).toHaveBeenCalledWith("test-study");
			expect(mockEvaluationFn).toHaveBeenCalled();
			expect(mockClient.completeTrial).toHaveBeenCalledWith("test-study", 1, {
				values: 0.85,
				user_attrs: { ndcg: 0.85, p95Latency: 150 },
			});
		});

		it("should emit progress events in order", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
				onProgress: (event) => progressEvents.push(event),
			};

			await runTrial(options);

			expect(progressEvents).toHaveLength(3);
			expect(progressEvents[0].type).toBe("suggest");
			expect(progressEvents[0].trialId).toBe(1);
			expect(progressEvents[0].params).toEqual({
				"reranker.depth": 50,
				"search.minScore.dense": 0.8,
			});
			expect(progressEvents[1].type).toBe("evaluate");
			expect(progressEvents[2].type).toBe("complete");
			expect(progressEvents[2].objectiveValue).toBe(0.85);
		});

		it("should pass config to evaluation function", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			await runTrial(options);

			const callArg = mockEvaluationFn.mock.calls[0][0];
			expect(callArg.reranker.depth).toBe(50);
			expect(callArg.search.minScore.dense).toBe(0.8);
		});

		it("should emit error event on failure", async () => {
			const error = new Error("Evaluation failed");
			mockEvaluationFn = mock(async () => {
				throw error;
			});

			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
				onProgress: (event) => progressEvents.push(event),
			};

			await expect(runTrial(options)).rejects.toThrow("Evaluation failed");

			const errorEvent = progressEvents.find((e) => e.type === "error");
			expect(errorEvent).toBeDefined();
			expect(errorEvent?.error?.message).toBe("Evaluation failed");
		});

		it("should work without onProgress callback", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			await runTrial(options);

			expect(mockClient.completeTrial).toHaveBeenCalled();
		});

		it("should handle pareto mode with array values", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "pareto" },
				onProgress: (event) => progressEvents.push(event),
			};

			await runTrial(options);

			expect(mockClient.completeTrial).toHaveBeenCalledWith("test-study", 1, {
				values: [0.85, -150],
				user_attrs: { ndcg: 0.85, p95Latency: 150 },
			});

			const completeEvent = progressEvents.find((e) => e.type === "complete");
			expect(completeEvent?.objectiveValue).toEqual([0.85, -150]);
		});
	});

	describe("runTrials", () => {
		let mockClient: TunerClient;
		let mockEvaluationFn: ReturnType<typeof mock>;
		let trialCount: number;

		beforeEach(() => {
			trialCount = 0;

			mockClient = {
				suggestTrial: mock(async () => ({
					trial_id: ++trialCount,
					params: { "reranker.depth": 50 },
				})),
				completeTrial: mock(async () => ({ trial_id: trialCount, state: "COMPLETE" })),
			} as unknown as TunerClient;

			mockEvaluationFn = mock(async () => ({ ndcg: 0.85 }));
		});

		it("should run specified number of trials", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			const result = await runTrials(options, 3);

			expect(result.successful).toBe(3);
			expect(result.failed).toBe(0);
			expect(result.errors).toHaveLength(0);
			expect(mockClient.suggestTrial).toHaveBeenCalledTimes(3);
		});

		it("should continue after trial failure", async () => {
			let callCount = 0;
			mockEvaluationFn = mock(async () => {
				callCount++;
				if (callCount === 2) {
					throw new Error("Trial 2 failed");
				}
				return { ndcg: 0.85 };
			});

			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			const result = await runTrials(options, 3);

			expect(result.successful).toBe(2);
			expect(result.failed).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].trialIndex).toBe(1);
			expect(result.errors[0].error.message).toBe("Trial 2 failed");
		});

		it("should handle all trials failing", async () => {
			mockEvaluationFn = mock(async () => {
				throw new Error("All fail");
			});

			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			const result = await runTrials(options, 2);

			expect(result.successful).toBe(0);
			expect(result.failed).toBe(2);
			expect(result.errors).toHaveLength(2);
		});

		it("should run zero trials", async () => {
			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			const result = await runTrials(options, 0);

			expect(result.successful).toBe(0);
			expect(result.failed).toBe(0);
			expect(mockClient.suggestTrial).not.toHaveBeenCalled();
		});

		it("should convert non-Error throws to Error objects", async () => {
			mockEvaluationFn = mock(async () => {
				throw "string error";
			});

			const options: TrialRunnerOptions = {
				client: mockClient,
				studyName: "test-study",
				evaluationFn: mockEvaluationFn,
				objectives: { mode: "quality" },
			};

			const result = await runTrials(options, 1);

			expect(result.errors[0].error).toBeInstanceOf(Error);
			expect(result.errors[0].error.message).toBe("string error");
		});
	});
});
