import { describe, expect, it } from "vitest";
import { buildBenchmarkConfig, DEFAULT_BENCHMARK_CONFIG } from "../../src/core/config.js";

describe("buildBenchmarkConfig", () => {
	it("should require dataset", () => {
		const config = buildBenchmarkConfig({ dataset: "/path/to/data.json" });
		expect(config.dataset).toBe("/path/to/data.json");
	});

	it("should apply defaults for missing fields", () => {
		const config = buildBenchmarkConfig({ dataset: "/path/to/data.json" });

		expect(config.variant).toBe(DEFAULT_BENCHMARK_CONFIG.variant);
		expect(config.topK).toBe(DEFAULT_BENCHMARK_CONFIG.topK);
		expect(config.retriever).toBe(DEFAULT_BENCHMARK_CONFIG.retriever);
		expect(config.embeddings).toBe(DEFAULT_BENCHMARK_CONFIG.embeddings);
		expect(config.hybridSearch).toBe(DEFAULT_BENCHMARK_CONFIG.hybridSearch);
		expect(config.rerank).toBe(DEFAULT_BENCHMARK_CONFIG.rerank);
		expect(config.rerankTier).toBe(DEFAULT_BENCHMARK_CONFIG.rerankTier);
		expect(config.rerankDepth).toBe(DEFAULT_BENCHMARK_CONFIG.rerankDepth);
		expect(config.llm).toBe(DEFAULT_BENCHMARK_CONFIG.llm);
	});

	it("should allow overriding defaults", () => {
		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			variant: "s",
			topK: 5,
			retriever: "dense",
			embeddings: "qdrant",
			rerank: false,
			llm: "anthropic",
			limit: 100,
		});

		expect(config.variant).toBe("s");
		expect(config.topK).toBe(5);
		expect(config.retriever).toBe("dense");
		expect(config.embeddings).toBe("qdrant");
		expect(config.rerank).toBe(false);
		expect(config.llm).toBe("anthropic");
		expect(config.limit).toBe(100);
	});

	it("should use environment variable fallback for qdrantUrl", () => {
		const originalQdrantUrl = process.env.QDRANT_URL;

		process.env.QDRANT_URL = "http://qdrant.example.com:6333";

		const config = buildBenchmarkConfig({ dataset: "/path/to/data.json" });
		expect(config.qdrantUrl).toBe("http://qdrant.example.com:6333");

		// Restore
		if (originalQdrantUrl === undefined) {
			delete process.env.QDRANT_URL;
		} else {
			process.env.QDRANT_URL = originalQdrantUrl;
		}
	});

	it("should prefer explicit option over env var", () => {
		const originalQdrantUrl = process.env.QDRANT_URL;
		process.env.QDRANT_URL = "http://env.example.com:6333";

		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			qdrantUrl: "http://explicit.example.com:6333",
		});

		expect(config.qdrantUrl).toBe("http://explicit.example.com:6333");

		// Restore
		if (originalQdrantUrl === undefined) {
			delete process.env.QDRANT_URL;
		} else {
			process.env.QDRANT_URL = originalQdrantUrl;
		}
	});

	it("should configure multi-query settings", () => {
		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			multiQuery: true,
			multiQueryVariations: 5,
		});

		expect(config.multiQuery).toBe(true);
		expect(config.multiQueryVariations).toBe(5);
	});

	it("should configure abstention settings", () => {
		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			abstention: true,
			abstentionThreshold: 0.5,
		});

		expect(config.abstention).toBe(true);
		expect(config.abstentionThreshold).toBe(0.5);
	});

	it("should configure session-aware settings", () => {
		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			sessionAware: true,
			topSessions: 10,
			turnsPerSession: 5,
		});

		expect(config.sessionAware).toBe(true);
		expect(config.topSessions).toBe(10);
		expect(config.turnsPerSession).toBe(5);
	});

	it("should configure temporal settings", () => {
		const config = buildBenchmarkConfig({
			dataset: "/path/to/data.json",
			temporalAware: true,
			temporalConfidenceThreshold: 0.9,
		});

		expect(config.temporalAware).toBe(true);
		expect(config.temporalConfidenceThreshold).toBe(0.9);
	});
});

describe("DEFAULT_BENCHMARK_CONFIG", () => {
	it("should have sensible defaults", () => {
		expect(DEFAULT_BENCHMARK_CONFIG.variant).toBe("oracle");
		expect(DEFAULT_BENCHMARK_CONFIG.topK).toBe(10);
		expect(DEFAULT_BENCHMARK_CONFIG.retriever).toBe("hybrid");
		expect(DEFAULT_BENCHMARK_CONFIG.embeddings).toBe("engram");
		expect(DEFAULT_BENCHMARK_CONFIG.hybridSearch).toBe(true);
		expect(DEFAULT_BENCHMARK_CONFIG.rerank).toBe(true);
		expect(DEFAULT_BENCHMARK_CONFIG.rerankTier).toBe("accurate");
		expect(DEFAULT_BENCHMARK_CONFIG.rerankDepth).toBe(30);
		expect(DEFAULT_BENCHMARK_CONFIG.llm).toBe("stub");
	});
});
