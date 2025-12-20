import { describe, expect, it } from "vitest";
import type { TrialConfig } from "../src/executor/config-mapper.js";
import {
	mapBenchmarkToTrialMetrics,
	mapTrialToBenchmarkConfig,
} from "../src/executor/evaluation-adapter.js";

// TODO: Define based on Python benchmark API response
type BenchmarkMetrics = {
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
};

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
		const benchmarkMetrics: BenchmarkMetrics = {
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
		};

		const result = mapBenchmarkToTrialMetrics(benchmarkMetrics);

		expect(result.ndcg).toBe(0.78);
		expect(result.mrr).toBe(0.72);
		expect(result.hitRate).toBe(0.75); // recallAt1
		expect(result.precision).toBe(0.88); // accuracy
		expect(result.recall).toBe(0.92); // recallAt10
	});

	it("should map latency metrics", () => {
		const benchmarkMetrics: BenchmarkMetrics = {
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
		};

		const result = mapBenchmarkToTrialMetrics(benchmarkMetrics);

		expect(result.p50Latency).toBe(25);
		expect(result.p95Latency).toBe(75);
		expect(result.p99Latency).toBe(125);
	});

	it("should map abstention metrics", () => {
		const benchmarkMetrics: BenchmarkMetrics = {
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
		};

		const result = mapBenchmarkToTrialMetrics(benchmarkMetrics);

		expect(result.abstentionPrecision).toBe(0.85);
		expect(result.abstentionRecall).toBe(0.65);
		expect(result.abstentionF1).toBe(0.74);
	});

	it("should handle zeros correctly", () => {
		const benchmarkMetrics: BenchmarkMetrics = {
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
		};

		const result = mapBenchmarkToTrialMetrics(benchmarkMetrics);

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
});
