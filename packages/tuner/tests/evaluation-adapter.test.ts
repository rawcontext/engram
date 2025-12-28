import { describe, expect, it } from "bun:test";
import type { BenchmarkReport } from "../src/executor/benchmark-types.js";
import type { TrialConfig } from "../src/executor/config-mapper.js";
import {
	evaluateWithBenchmark,
	mapBenchmarkToTrialMetrics,
	mapTrialToBenchmarkConfig,
} from "../src/executor/evaluation-adapter.js";

/**
 * Helper to create a BenchmarkReport from simplified metrics for testing
 */
function createBenchmarkReport(metrics: {
	accuracy: number;
	recallAt1: number;
	recallAt5: number;
	recallAt10: number;
	ndcgAt10: number;
	mrr: number;
	abstentionPrecision: number;
	abstentionRecall: number;
	abstentionF1: number;
	p50Latency: number;
	p95Latency: number;
	p99Latency: number;
	totalDurationMs: number;
}): BenchmarkReport {
	return {
		timestamp: new Date().toISOString(),
		dataset_path: "/test/dataset.json",
		total_instances: 100,
		metrics: {
			overall: {
				total: 100,
				correct: Math.round(metrics.accuracy * 100),
				accuracy: metrics.accuracy,
			},
			by_ability: {
				IE: { total: 20, correct: 18, accuracy: 0.9 },
				MR: { total: 20, correct: 16, accuracy: 0.8 },
				TR: { total: 20, correct: 14, accuracy: 0.7 },
				KU: { total: 20, correct: 12, accuracy: 0.6 },
				ABS: { total: 20, correct: 10, accuracy: 0.5 },
			},
			retrieval: {
				turn_recall: 0.8,
				session_recall: 0.9,
				recall_at_k: {
					1: metrics.recallAt1,
					5: metrics.recallAt5,
					10: metrics.recallAt10,
				},
				ndcg_at_k: { 10: metrics.ndcgAt10 },
				mrr: metrics.mrr,
			},
			abstention: {
				true_positives: 10,
				false_positives: 2,
				false_negatives: 3,
				true_negatives: 85,
				precision: metrics.abstentionPrecision,
				recall: metrics.abstentionRecall,
				f1: metrics.abstentionF1,
			},
		},
	};
}

describe("mapTrialToBenchmarkConfig", () => {
	const baseTrialConfig: TrialConfig = {
		reranker: {
			enabled: true,
			defaultTier: "accurate",
			depth: 30,
		},
		search: {
			minScore: { hybrid: 0.5 },
		},
		abstention: {
			minRetrievalScore: 0.3,
		},
	};

	const baseOptions = {
		dataset: "/path/to/dataset.json",
	};

	it("should map dataset from options", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.dataset).toBe("/path/to/dataset.json");
	});

	it("should map variant from options with default", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.variant).toBe("oracle");

		const resultWithVariant = mapTrialToBenchmarkConfig(baseTrialConfig, {
			...baseOptions,
			variant: "s",
		});
		expect(resultWithVariant.variant).toBe("s");
	});

	it("should map limit from options", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, {
			...baseOptions,
			limit: 100,
		});
		expect(result.limit).toBe(100);
	});

	it("should map reranker settings from trial config", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);

		expect(result.rerank).toBe(true);
		expect(result.rerankTier).toBe("accurate");
		expect(result.rerankDepth).toBe(30);
	});

	it("should use defaults for missing reranker settings", () => {
		const sparseConfig: TrialConfig = {
			reranker: {},
			search: {},
			abstention: {},
		};

		const result = mapTrialToBenchmarkConfig(sparseConfig, baseOptions);

		expect(result.rerank).toBe(true);
		expect(result.rerankTier).toBe("accurate");
		expect(result.rerankDepth).toBe(30);
	});

	it("should map abstention threshold from trial config", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.abstentionThreshold).toBe(0.3);
	});

	it("should use default abstention threshold when not specified", () => {
		const sparseConfig: TrialConfig = {
			reranker: {},
			search: {},
			abstention: {},
		};

		const result = mapTrialToBenchmarkConfig(sparseConfig, baseOptions);
		expect(result.abstentionThreshold).toBe(0.3);
	});

	it("should map LLM provider from options", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, {
			...baseOptions,
			llm: "anthropic",
		});
		expect(result.llm).toBe("anthropic");
	});

	it("should default to stub LLM", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.llm).toBe("stub");
	});

	it("should map qdrantUrl from options", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, {
			...baseOptions,
			qdrantUrl: "http://qdrant.example.com:6333",
		});
		expect(result.qdrantUrl).toBe("http://qdrant.example.com:6333");
	});

	it("should always use engram embeddings for tuning", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.embeddings).toBe("engram");
	});

	it("should always enable hybrid search", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.hybridSearch).toBe(true);
	});

	it("should always enable abstention", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.abstention).toBe(true);
	});

	it("should disable session-aware by default", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.sessionAware).toBe(false);
	});

	it("should disable temporal-aware by default", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, baseOptions);
		expect(result.temporalAware).toBe(false);
	});

	it("should map Ollama settings from options", () => {
		const result = mapTrialToBenchmarkConfig(baseTrialConfig, {
			...baseOptions,
			llm: "ollama",
			ollamaUrl: "http://localhost:11434",
			ollamaModel: "llama3",
		});

		expect(result.llm).toBe("ollama");
		expect(result.ollamaUrl).toBe("http://localhost:11434");
		expect(result.ollamaModel).toBe("llama3");
	});
});

describe("mapBenchmarkToTrialMetrics", () => {
	it("should map all quality metrics", () => {
		const report = createBenchmarkReport({
			accuracy: 0.88,
			recallAt1: 0.75,
			recallAt5: 0.85,
			recallAt10: 0.92,
			ndcgAt10: 0.78,
			mrr: 0.72,
			abstentionPrecision: 0.8,
			abstentionRecall: 0.7,
			abstentionF1: 0.75,
			p50Latency: 50,
			p95Latency: 100,
			p99Latency: 150,
			totalDurationMs: 10000,
		});

		const result = mapBenchmarkToTrialMetrics(report);

		expect(result.ndcg).toBe(0.78);
		expect(result.mrr).toBe(0.72);
		expect(result.hitRate).toBe(0.75); // recallAt1
		expect(result.precision).toBe(0.88); // accuracy
		expect(result.recall).toBe(0.92); // recallAt10
	});

	it("should map latency metrics", () => {
		const report = createBenchmarkReport({
			accuracy: 0.5,
			recallAt1: 0.5,
			recallAt5: 0.5,
			recallAt10: 0.5,
			ndcgAt10: 0.5,
			mrr: 0.5,
			abstentionPrecision: 0.5,
			abstentionRecall: 0.5,
			abstentionF1: 0.5,
			p50Latency: 25,
			p95Latency: 75,
			p99Latency: 125,
			totalDurationMs: 5000,
		});

		const result = mapBenchmarkToTrialMetrics(report);

		// Note: latency metrics are not currently provided by benchmark API
		expect(result.p50Latency).toBe(0);
		expect(result.p95Latency).toBe(0);
		expect(result.p99Latency).toBe(0);
	});

	it("should map abstention metrics", () => {
		const report = createBenchmarkReport({
			accuracy: 0.5,
			recallAt1: 0.5,
			recallAt5: 0.5,
			recallAt10: 0.5,
			ndcgAt10: 0.5,
			mrr: 0.5,
			abstentionPrecision: 0.85,
			abstentionRecall: 0.65,
			abstentionF1: 0.74,
			p50Latency: 50,
			p95Latency: 100,
			p99Latency: 150,
			totalDurationMs: 5000,
		});

		const result = mapBenchmarkToTrialMetrics(report);

		expect(result.abstentionPrecision).toBe(0.85);
		expect(result.abstentionRecall).toBe(0.65);
		expect(result.abstentionF1).toBe(0.74);
	});

	it("should handle zeros correctly", () => {
		const report = createBenchmarkReport({
			accuracy: 0,
			recallAt1: 0,
			recallAt5: 0,
			recallAt10: 0,
			ndcgAt10: 0,
			mrr: 0,
			abstentionPrecision: 0,
			abstentionRecall: 0,
			abstentionF1: 0,
			p50Latency: 0,
			p95Latency: 0,
			p99Latency: 0,
			totalDurationMs: 0,
		});

		const result = mapBenchmarkToTrialMetrics(report);

		expect(result.ndcg).toBe(0);
		expect(result.mrr).toBe(0);
		expect(result.hitRate).toBe(0);
		expect(result.precision).toBe(0);
		expect(result.recall).toBe(0);
		expect(result.p50Latency).toBe(0);
		expect(result.p95Latency).toBe(0);
		expect(result.p99Latency).toBe(0);
		expect(result.abstentionF1).toBe(0);
	});

	it("should handle missing retrieval metrics", () => {
		const report: any = {
			timestamp: new Date().toISOString(),
			dataset_path: "/test/dataset.json",
			total_instances: 100,
			metrics: {
				overall: { total: 100, correct: 50, accuracy: 0.5 },
				by_ability: {
					IE: { total: 20, correct: 10, accuracy: 0.5 },
					MR: { total: 20, correct: 10, accuracy: 0.5 },
					TR: { total: 20, correct: 10, accuracy: 0.5 },
					KU: { total: 20, correct: 10, accuracy: 0.5 },
					ABS: { total: 20, correct: 10, accuracy: 0.5 },
				},
				// No retrieval metrics
			},
		};

		const result = mapBenchmarkToTrialMetrics(report);

		expect(result.ndcg).toBe(0);
		expect(result.mrr).toBe(0);
		expect(result.hitRate).toBe(0);
		expect(result.recall).toBe(0);
	});

	it("should handle missing abstention metrics", () => {
		const report: any = {
			timestamp: new Date().toISOString(),
			dataset_path: "/test/dataset.json",
			total_instances: 100,
			metrics: {
				overall: { total: 100, correct: 50, accuracy: 0.5 },
				by_ability: {
					IE: { total: 20, correct: 10, accuracy: 0.5 },
					MR: { total: 20, correct: 10, accuracy: 0.5 },
					TR: { total: 20, correct: 10, accuracy: 0.5 },
					KU: { total: 20, correct: 10, accuracy: 0.5 },
					ABS: { total: 20, correct: 10, accuracy: 0.5 },
				},
				retrieval: {
					turn_recall: 0.8,
					session_recall: 0.9,
					recall_at_k: { 1: 0.7, 5: 0.8, 10: 0.9 },
					ndcg_at_k: { 10: 0.75 },
					mrr: 0.72,
				},
				// No abstention metrics
			},
		};

		const result = mapBenchmarkToTrialMetrics(report);

		expect(result.abstentionPrecision).toBe(0);
		expect(result.abstentionRecall).toBe(0);
		expect(result.abstentionF1).toBe(0);
	});
});

// NOTE: evaluateWithBenchmark involves spawning child processes which is difficult to test
// in a unit test environment. The function is primarily tested via integration tests.
describe("evaluateWithBenchmark", () => {
	it("should throw when dataset is not a string", async () => {
		const config: TrialConfig = {
			reranker: { enabled: true, defaultTier: "accurate", depth: 30 },
			search: { minScore: { hybrid: 0.5 } },
			abstention: { minRetrievalScore: 0.3 },
		};

		await expect(
			evaluateWithBenchmark(config, {
				dataset: null as any,
			}),
		).rejects.toThrow("dataset must be a string");
	});

	it("should throw when rerankTier is not a string", async () => {
		const config: TrialConfig = {
			reranker: { defaultTier: 123 as any },
			search: {},
			abstention: {},
		};

		await expect(
			evaluateWithBenchmark(config, {
				dataset: "/test/dataset.json",
			}),
		).rejects.toThrow("rerankTier must be a string");
	});
});
