import { describe, it, expect, beforeEach } from "vitest";
import {
	Evaluator,
	DEFAULT_EVALUATOR_CONFIG,
	formatMetricsReport,
	resultsToJsonl,
	parseJsonlResults,
	type RetrievalData,
} from "../src/longmemeval/evaluator.js";
import type { BenchmarkResult, ParsedInstance, MemoryAbility } from "../src/longmemeval/types.js";
import type { LLMProvider, LLMResponse } from "../src/longmemeval/reader.js";

const createMockInstance = (
	questionId: string,
	answer: string,
	memoryAbility: MemoryAbility = "IE",
): ParsedInstance => ({
	questionId,
	questionType: "single-session-user",
	memoryAbility,
	question: `Question for ${questionId}`,
	answer,
	questionDate: new Date("2024-03-15"),
	sessions: [],
	answerSessionIds: [],
	isAbstention: memoryAbility === "ABS",
});

const createMockResult = (questionId: string, hypothesis: string): BenchmarkResult => ({
	questionId,
	hypothesis,
});

describe("Evaluator", () => {
	describe("string matching", () => {
		const evaluator = new Evaluator({ strictMatching: false });

		it("should match exact answers", async () => {
			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "blue");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should match case-insensitive", async () => {
			const instance = createMockInstance("q1", "Blue");
			const result = createMockResult("q1", "BLUE");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should match answer contained in hypothesis", async () => {
			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "The color is blue.");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should match hypothesis contained in answer", async () => {
			const instance = createMockInstance("q1", "The user's favorite color is blue");
			const result = createMockResult("q1", "blue");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should match with word overlap", async () => {
			const instance = createMockInstance("q1", "favorite color blue");
			const result = createMockResult("q1", "blue is the favorite color");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should not match unrelated answers", async () => {
			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "red");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(false);
		});
	});

	describe("strict matching", () => {
		const evaluator = new Evaluator({ strictMatching: true });

		it("should require exact match", async () => {
			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "Blue");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			// Still matches because normalization lowercases
			expect(evaluated[0].correct).toBe(true);
		});

		it("should not match partial answers in strict mode", async () => {
			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "The color is blue");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(false);
		});
	});

	describe("per-ability metrics", () => {
		it("should compute metrics by memory ability", async () => {
			const evaluator = new Evaluator();
			const instances = [
				createMockInstance("q1", "blue", "IE"),
				createMockInstance("q2", "red", "IE"),
				createMockInstance("q3", "2023", "TR"),
				createMockInstance("q4", "I don't know", "ABS"), // Match the expected response
			];

			const results = [
				createMockResult("q1", "blue"), // correct IE
				createMockResult("q2", "green"), // wrong IE
				createMockResult("q3", "2023"), // correct TR
				createMockResult("q4", "I don't know"), // correct ABS
			];

			const { metrics } = await evaluator.evaluateAll(results, instances);

			expect(metrics.byAbility.IE.total).toBe(2);
			expect(metrics.byAbility.IE.correct).toBe(1);
			expect(metrics.byAbility.IE.accuracy).toBe(0.5);

			expect(metrics.byAbility.TR.total).toBe(1);
			expect(metrics.byAbility.TR.correct).toBe(1);
			expect(metrics.byAbility.TR.accuracy).toBe(1);

			expect(metrics.overall.total).toBe(4);
			expect(metrics.overall.correct).toBe(3);
		});
	});

	describe("LLM-based evaluation", () => {
		class MockLLMJudge implements LLMProvider {
			async complete(prompt: string): Promise<LLMResponse> {
				// Simple mock that checks if "blue" is in both
				if (prompt.includes("blue") && prompt.includes("Generated Answer")) {
					return { text: "CORRECT" };
				}
				return { text: "INCORRECT" };
			}
		}

		it("should use LLM for evaluation when enabled", async () => {
			const llm = new MockLLMJudge();
			const evaluator = new Evaluator({ useLLMEvaluation: true }, llm);

			const instance = createMockInstance("q1", "blue");
			const result = createMockResult("q1", "The color is blue");

			const { evaluated } = await evaluator.evaluateAll([result], [instance]);

			expect(evaluated[0].correct).toBe(true);
		});

		it("should use GPT-4o prompt by default", () => {
			expect(DEFAULT_EVALUATOR_CONFIG.useGPT4oPrompt).toBe(true);
		});
	});

	describe("NDCG computation", () => {
		it("should compute NDCG for perfect ranking", async () => {
			const evaluator = new Evaluator({ kValues: [3, 5] });

			const retrievalData: RetrievalData[] = [
				{
					questionId: "q1",
					retrievedIds: ["doc1", "doc2", "doc3"],
					scores: [0.9, 0.8, 0.7],
					evidenceIds: ["doc1", "doc2"],
				},
			];

			const { metrics } = await evaluator.evaluateAll(
				[createMockResult("q1", "answer")],
				[createMockInstance("q1", "answer")],
				retrievalData,
			);

			// Perfect ranking - NDCG should be 1
			expect(metrics.retrieval?.ndcgAtK[3]).toBe(1);
		});

		it("should compute lower NDCG for imperfect ranking", async () => {
			const evaluator = new Evaluator({ kValues: [3] });

			const retrievalData: RetrievalData[] = [
				{
					questionId: "q1",
					retrievedIds: ["irrelevant", "doc1", "doc2"],
					scores: [0.9, 0.8, 0.7],
					evidenceIds: ["doc1", "doc2"],
				},
			];

			const { metrics } = await evaluator.evaluateAll(
				[createMockResult("q1", "answer")],
				[createMockInstance("q1", "answer")],
				retrievalData,
			);

			// Imperfect ranking - NDCG should be less than 1
			expect(metrics.retrieval?.ndcgAtK[3]).toBeLessThan(1);
			expect(metrics.retrieval?.ndcgAtK[3]).toBeGreaterThan(0);
		});

		it("should compute MRR correctly", async () => {
			const evaluator = new Evaluator({ kValues: [5] });

			const retrievalData: RetrievalData[] = [
				{
					questionId: "q1",
					retrievedIds: ["x", "x", "doc1", "x", "x"],
					scores: [0.9, 0.8, 0.7, 0.6, 0.5],
					evidenceIds: ["doc1"],
				},
			];

			const { metrics } = await evaluator.evaluateAll(
				[createMockResult("q1", "answer")],
				[createMockInstance("q1", "answer")],
				retrievalData,
			);

			// First relevant at position 3, so MRR = 1/3
			expect(metrics.retrieval?.mrr).toBeCloseTo(1 / 3);
		});

		it("should compute Recall@K correctly", async () => {
			const evaluator = new Evaluator({ kValues: [1, 5, 10] });

			const retrievalData: RetrievalData[] = [
				{
					questionId: "q1",
					retrievedIds: ["doc1", "x", "doc2", "x", "doc3", "x", "x", "x", "x", "x"],
					scores: [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45],
					evidenceIds: ["doc1", "doc2", "doc3", "doc4"], // 4 evidence docs
				},
			];

			const { metrics } = await evaluator.evaluateAll(
				[createMockResult("q1", "answer")],
				[createMockInstance("q1", "answer")],
				retrievalData,
			);

			// Recall@1 = 1/4 (only doc1 in top 1)
			expect(metrics.retrieval?.recallAtK[1]).toBe(0.25);
			// Recall@5 = 3/4 (doc1, doc2, doc3 in top 5)
			expect(metrics.retrieval?.recallAtK[5]).toBe(0.75);
			// Recall@10 = 3/4 (still only 3 found)
			expect(metrics.retrieval?.recallAtK[10]).toBe(0.75);
		});
	});

	describe("abstention metrics", () => {
		it("should compute abstention precision and recall", async () => {
			const evaluator = new Evaluator();

			const instances = [
				createMockInstance("q1", "unknown", "ABS"),
				createMockInstance("q2", "unknown", "ABS"),
				createMockInstance("q3", "blue", "IE"),
				createMockInstance("q4", "red", "IE"),
			];

			const results = [
				createMockResult("q1", "I don't know"),
				createMockResult("q2", "Some answer"), // Wrong - should abstain
				createMockResult("q3", "I don't know"), // Wrong - shouldn't abstain
				createMockResult("q4", "red"),
			];

			const abstentionFlags = new Map([
				["q1", true], // Correctly abstained
				["q2", false], // Should have abstained
				["q3", true], // Incorrectly abstained
				["q4", false], // Correctly answered
			]);

			const { metrics } = await evaluator.evaluateAll(
				results,
				instances,
				undefined,
				abstentionFlags,
			);

			expect(metrics.abstention).toBeDefined();
			expect(metrics.abstention?.truePositives).toBe(1); // q1
			expect(metrics.abstention?.falseNegatives).toBe(1); // q2
			expect(metrics.abstention?.falsePositives).toBe(1); // q3
			expect(metrics.abstention?.trueNegatives).toBe(1); // q4

			// Precision = TP / (TP + FP) = 1 / 2 = 0.5
			expect(metrics.abstention?.precision).toBe(0.5);
			// Recall = TP / (TP + FN) = 1 / 2 = 0.5
			expect(metrics.abstention?.recall).toBe(0.5);
			// F1 = 2 * P * R / (P + R) = 0.5
			expect(metrics.abstention?.f1).toBe(0.5);
		});
	});
});

describe("formatMetricsReport", () => {
	it("should format basic metrics", () => {
		const metrics = {
			overall: { total: 10, correct: 7, accuracy: 0.7 },
			byAbility: {
				IE: { total: 4, correct: 3, accuracy: 0.75 },
				MR: { total: 2, correct: 1, accuracy: 0.5 },
				TR: { total: 2, correct: 2, accuracy: 1 },
				KU: { total: 1, correct: 0, accuracy: 0 },
				ABS: { total: 1, correct: 1, accuracy: 1 },
			},
		};

		const report = formatMetricsReport(metrics);

		expect(report).toContain("LongMemEval Benchmark Results");
		expect(report).toContain("70.0%");
		expect(report).toContain("Information Extraction");
	});

	it("should include retrieval metrics when present", () => {
		const metrics = {
			overall: { total: 10, correct: 7, accuracy: 0.7 },
			byAbility: {
				IE: { total: 10, correct: 7, accuracy: 0.7 },
				MR: { total: 0, correct: 0, accuracy: 0 },
				TR: { total: 0, correct: 0, accuracy: 0 },
				KU: { total: 0, correct: 0, accuracy: 0 },
				ABS: { total: 0, correct: 0, accuracy: 0 },
			},
			retrieval: {
				turnRecall: 0.8,
				sessionRecall: 0.85,
				recallAtK: { 1: 0.5, 5: 0.7, 10: 0.8 },
				ndcgAtK: { 1: 0.5, 5: 0.65, 10: 0.75 },
				mrr: 0.6,
			},
		};

		const report = formatMetricsReport(metrics);

		expect(report).toContain("Retrieval Metrics");
		expect(report).toContain("Turn Recall");
		expect(report).toContain("NDCG@K");
		expect(report).toContain("MRR");
	});

	it("should include abstention metrics when present", () => {
		const metrics = {
			overall: { total: 10, correct: 7, accuracy: 0.7 },
			byAbility: {
				IE: { total: 10, correct: 7, accuracy: 0.7 },
				MR: { total: 0, correct: 0, accuracy: 0 },
				TR: { total: 0, correct: 0, accuracy: 0 },
				KU: { total: 0, correct: 0, accuracy: 0 },
				ABS: { total: 0, correct: 0, accuracy: 0 },
			},
			abstention: {
				truePositives: 5,
				falsePositives: 2,
				falseNegatives: 1,
				trueNegatives: 12,
				precision: 0.714,
				recall: 0.833,
				f1: 0.769,
			},
		};

		const report = formatMetricsReport(metrics);

		expect(report).toContain("Abstention Metrics");
		expect(report).toContain("Precision");
		expect(report).toContain("Recall");
		expect(report).toContain("F1 Score");
		expect(report).toContain("Confusion Matrix");
	});
});

describe("JSONL utilities", () => {
	it("should convert results to JSONL", () => {
		const results: BenchmarkResult[] = [
			{ questionId: "q1", hypothesis: "blue" },
			{ questionId: "q2", hypothesis: "red" },
		];

		const jsonl = resultsToJsonl(results);

		expect(jsonl).toContain("q1");
		expect(jsonl).toContain("blue");
		expect(jsonl.split("\n")).toHaveLength(2);
	});

	it("should parse JSONL to results", () => {
		const jsonl = `{"question_id": "q1", "hypothesis": "blue"}
{"question_id": "q2", "hypothesis": "red"}`;

		const results = parseJsonlResults(jsonl);

		expect(results).toHaveLength(2);
		expect(results[0].questionId).toBe("q1");
		expect(results[0].hypothesis).toBe("blue");
	});
});
