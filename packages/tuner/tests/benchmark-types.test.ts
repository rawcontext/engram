import { describe, expect, it } from "bun:test";
import type { BenchmarkReport } from "../src/executor/benchmark-types.js";
import { extractBenchmarkMetrics } from "../src/executor/benchmark-types.js";

describe("benchmark-types", () => {
	describe("extractBenchmarkMetrics", () => {
		it("should extract all metrics when fully populated", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
					retrieval: {
						turn_recall: 0.8,
						session_recall: 0.9,
						recall_at_k: {
							1: 0.75,
							5: 0.85,
							10: 0.92,
						},
						ndcg_at_k: {
							10: 0.78,
						},
						mrr: 0.72,
					},
					abstention: {
						true_positives: 15,
						false_positives: 3,
						false_negatives: 2,
						true_negatives: 80,
						precision: 0.8,
						recall: 0.7,
						f1: 0.75,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.accuracy).toBe(0.85);
			expect(result.recallAt1).toBe(0.75);
			expect(result.recallAt5).toBe(0.85);
			expect(result.recallAt10).toBe(0.92);
			expect(result.ndcgAt10).toBe(0.78);
			expect(result.mrr).toBe(0.72);
			expect(result.abstentionPrecision).toBe(0.8);
			expect(result.abstentionRecall).toBe(0.7);
			expect(result.abstentionF1).toBe(0.75);
			expect(result.p50Latency).toBe(0);
			expect(result.p95Latency).toBe(0);
			expect(result.p99Latency).toBe(0);
			expect(result.totalDurationMs).toBe(0);
		});

		it("should handle missing retrieval metrics", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.accuracy).toBe(0.85);
			expect(result.recallAt1).toBe(0);
			expect(result.recallAt5).toBe(0);
			expect(result.recallAt10).toBe(0);
			expect(result.ndcgAt10).toBe(0);
			expect(result.mrr).toBe(0);
		});

		it("should handle missing abstention metrics", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
					retrieval: {
						turn_recall: 0.8,
						session_recall: 0.9,
						recall_at_k: {
							1: 0.75,
							5: 0.85,
							10: 0.92,
						},
						ndcg_at_k: {
							10: 0.78,
						},
						mrr: 0.72,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.abstentionPrecision).toBe(0);
			expect(result.abstentionRecall).toBe(0);
			expect(result.abstentionF1).toBe(0);
		});

		it("should handle missing recall_at_k values", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
					retrieval: {
						turn_recall: 0.8,
						session_recall: 0.9,
						recall_at_k: {
							// Missing 1, 5, 10
						},
						ndcg_at_k: {
							10: 0.78,
						},
						mrr: 0.72,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.recallAt1).toBe(0);
			expect(result.recallAt5).toBe(0);
			expect(result.recallAt10).toBe(0);
		});

		it("should handle missing ndcg_at_k[10]", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
					retrieval: {
						turn_recall: 0.8,
						session_recall: 0.9,
						recall_at_k: {
							1: 0.75,
							5: 0.85,
							10: 0.92,
						},
						ndcg_at_k: {
							// Missing 10
						},
						mrr: 0.72,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.ndcgAt10).toBe(0);
		});

		it("should handle missing mrr", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 85,
						accuracy: 0.85,
					},
					by_ability: {
						IE: { total: 20, correct: 18, accuracy: 0.9 },
						MR: { total: 20, correct: 17, accuracy: 0.85 },
						TR: { total: 20, correct: 16, accuracy: 0.8 },
						KU: { total: 20, correct: 17, accuracy: 0.85 },
						ABS: { total: 20, correct: 17, accuracy: 0.85 },
					},
					retrieval: {
						turn_recall: 0.8,
						session_recall: 0.9,
						recall_at_k: {
							1: 0.75,
							5: 0.85,
							10: 0.92,
						},
						ndcg_at_k: {
							10: 0.78,
						},
						mrr: undefined as any,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.mrr).toBe(0);
		});

		it("should handle all missing optional fields", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 50,
						accuracy: 0.5,
					},
					by_ability: {
						IE: { total: 20, correct: 10, accuracy: 0.5 },
						MR: { total: 20, correct: 10, accuracy: 0.5 },
						TR: { total: 20, correct: 10, accuracy: 0.5 },
						KU: { total: 20, correct: 10, accuracy: 0.5 },
						ABS: { total: 20, correct: 10, accuracy: 0.5 },
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.accuracy).toBe(0.5);
			expect(result.recallAt1).toBe(0);
			expect(result.recallAt5).toBe(0);
			expect(result.recallAt10).toBe(0);
			expect(result.ndcgAt10).toBe(0);
			expect(result.mrr).toBe(0);
			expect(result.abstentionPrecision).toBe(0);
			expect(result.abstentionRecall).toBe(0);
			expect(result.abstentionF1).toBe(0);
			expect(result.p50Latency).toBe(0);
			expect(result.p95Latency).toBe(0);
			expect(result.p99Latency).toBe(0);
			expect(result.totalDurationMs).toBe(0);
		});

		it("should handle zero values", () => {
			const report: BenchmarkReport = {
				timestamp: "2025-01-01T00:00:00Z",
				dataset_path: "/path/to/dataset.json",
				total_instances: 100,
				metrics: {
					overall: {
						total: 100,
						correct: 0,
						accuracy: 0,
					},
					by_ability: {
						IE: { total: 20, correct: 0, accuracy: 0 },
						MR: { total: 20, correct: 0, accuracy: 0 },
						TR: { total: 20, correct: 0, accuracy: 0 },
						KU: { total: 20, correct: 0, accuracy: 0 },
						ABS: { total: 20, correct: 0, accuracy: 0 },
					},
					retrieval: {
						turn_recall: 0,
						session_recall: 0,
						recall_at_k: {
							1: 0,
							5: 0,
							10: 0,
						},
						ndcg_at_k: {
							10: 0,
						},
						mrr: 0,
					},
					abstention: {
						true_positives: 0,
						false_positives: 0,
						false_negatives: 0,
						true_negatives: 0,
						precision: 0,
						recall: 0,
						f1: 0,
					},
				},
				config: {},
			};

			const result = extractBenchmarkMetrics(report);

			expect(result.accuracy).toBe(0);
			expect(result.recallAt1).toBe(0);
			expect(result.recallAt5).toBe(0);
			expect(result.recallAt10).toBe(0);
			expect(result.ndcgAt10).toBe(0);
			expect(result.mrr).toBe(0);
			expect(result.abstentionPrecision).toBe(0);
			expect(result.abstentionRecall).toBe(0);
			expect(result.abstentionF1).toBe(0);
		});
	});
});
