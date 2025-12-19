import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock generateObject from ai - must be defined before vi.mock for hoisting
const mockGenerateObject = vi.fn();

// Mock logger
vi.mock("@engram/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

// Mock AI SDK
vi.mock("ai", () => ({
	generateObject: mockGenerateObject,
}));

// Mock xAI provider
vi.mock("@ai-sdk/xai", () => ({
	createXai: vi.fn(() => vi.fn((model: string) => ({ modelId: model }))),
}));

// Import after mocking
const { MultiQueryRetriever } = await import("./multi-query-retriever");

describe("MultiQueryRetriever", () => {
	let retriever: InstanceType<typeof MultiQueryRetriever>;
	let mockBaseRetriever: any;

	const mockSearchResults = [
		{ id: "doc-1", score: 0.95, payload: { content: "OAuth2 guide" } },
		{ id: "doc-2", score: 0.9, payload: { content: "JWT tokens" } },
		{ id: "doc-3", score: 0.85, payload: { content: "API security" } },
	];

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock base retriever
		mockBaseRetriever = {
			search: vi.fn().mockResolvedValue(mockSearchResults),
		};

		// Default mock for generateObject
		mockGenerateObject.mockResolvedValue({
			object: {
				queries: [
					"OAuth2 authentication implementation",
					"how to add OAuth login",
					"authentication flow for web apps",
				],
			},
			usage: {
				inputTokens: 500,
				outputTokens: 50,
				totalTokens: 550,
			},
		});

		retriever = new MultiQueryRetriever({
			baseRetriever: mockBaseRetriever,
			apiKey: "test-key",
			config: {
				numVariations: 3,
				strategies: ["paraphrase", "keyword", "stepback"],
				includeOriginal: true,
				rrfK: 60,
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should use default config when none provided", () => {
			const defaultRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
			});
			expect(defaultRetriever.getConfig()).toEqual({
				numVariations: 3,
				strategies: ["paraphrase", "keyword", "stepback"],
				includeOriginal: true,
				rrfK: 60,
			});
		});

		it("should use provided config options", () => {
			const customRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				config: {
					numVariations: 5,
					strategies: ["paraphrase", "decompose"],
					includeOriginal: false,
					rrfK: 30,
				},
			});

			const config = customRetriever.getConfig();
			expect(config.numVariations).toBe(5);
			expect(config.strategies).toEqual(["paraphrase", "decompose"]);
			expect(config.includeOriginal).toBe(false);
			expect(config.rrfK).toBe(30);
		});
	});

	describe("search()", () => {
		it("should generate query variations and search with each", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: {
					queries: [
						"OAuth2 authentication implementation",
						"how to add OAuth login",
						"authentication flow for web apps",
					],
				},
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await retriever.search({ text: "How to implement OAuth2?", limit: 10 });

			// Should call base retriever 4 times (original + 3 variations)
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(4);
		});

		it("should include original query when configured", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["variation1", "variation2", "variation3"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await retriever.search({ text: "original query", limit: 10 });

			// First call should be with original query
			expect(mockBaseRetriever.search).toHaveBeenCalledWith(
				expect.objectContaining({ text: "original query" }),
			);
		});

		it("should exclude original query when not configured", async () => {
			const noOriginalRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				config: { includeOriginal: false, numVariations: 2 },
			});

			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["variation1", "variation2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await noOriginalRetriever.search({ text: "original query", limit: 10 });

			// Should only call with variations (2 times), not with original
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(2);
			expect(mockBaseRetriever.search).not.toHaveBeenCalledWith(
				expect.objectContaining({ text: "original query" }),
			);
		});

		it("should fuse results using RRF", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["variation1", "variation2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			// Set up different results for each query
			const results1 = [
				{ id: "doc-1", score: 0.9, payload: { content: "A" } },
				{ id: "doc-2", score: 0.8, payload: { content: "B" } },
			];
			const results2 = [
				{ id: "doc-3", score: 0.95, payload: { content: "C" } },
				{ id: "doc-1", score: 0.85, payload: { content: "A" } }, // Duplicate
			];
			const results3 = [
				{ id: "doc-1", score: 0.88, payload: { content: "A" } }, // Triple duplicate
				{ id: "doc-4", score: 0.75, payload: { content: "D" } },
			];

			mockBaseRetriever.search
				.mockResolvedValueOnce(results1) // Original query
				.mockResolvedValueOnce(results2) // Variation 1
				.mockResolvedValueOnce(results3); // Variation 2

			const results = await retriever.search({ text: "test query", limit: 10 });

			// doc-1 appears in all 3 result sets, should have highest RRF score
			expect(results[0].id).toBe("doc-1");

			// All results should have rrfScore
			for (const result of results) {
				expect(result.rrfScore).toBeDefined();
				expect(result.rrfScore).toBeGreaterThan(0);
			}
		});

		it("should respect limit parameter", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["v1", "v2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			// Return more results than requested limit
			const manyResults = Array.from({ length: 20 }, (_, i) => ({
				id: `doc-${i}`,
				score: 0.9 - i * 0.01,
				payload: { content: `Content ${i}` },
			}));

			mockBaseRetriever.search.mockResolvedValue(manyResults);

			const results = await retriever.search({ text: "test", limit: 5 });

			expect(results.length).toBeLessThanOrEqual(5);
		});

		it("should fall back to single query on expansion error", async () => {
			mockGenerateObject.mockRejectedValueOnce(new Error("LLM API error"));

			const results = await retriever.search({ text: "test query", limit: 10 });

			// Should fall back to single query
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(3);
		});

		it("should pass through search query options", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["variation"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await retriever.search({
				text: "test query",
				limit: 5,
				strategy: "hybrid",
				filters: { session_id: "session-123" },
				rerank: true,
			});

			expect(mockBaseRetriever.search).toHaveBeenCalledWith(
				expect.objectContaining({
					strategy: "hybrid",
					filters: { session_id: "session-123" },
					rerank: true,
				}),
			);
		});
	});

	describe("expandQuery()", () => {
		it("should return variations including original query", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: {
					queries: [
						"OAuth2 authentication guide",
						"implementing OAuth login",
						"secure authentication flow",
					],
				},
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const variations = await retriever.expandQuery("How to implement OAuth2?");

			// Should include original + 3 variations
			expect(variations).toHaveLength(4);
			expect(variations[0]).toBe("How to implement OAuth2?");
		});

		it("should filter out empty variations", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: {
					queries: [
						"valid query",
						"  ", // Empty/whitespace
						"another valid",
						"", // Empty
					],
				},
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const variations = await retriever.expandQuery("original");

			// Should include original + 2 valid variations (not 4)
			expect(variations).toHaveLength(3);
			expect(variations).not.toContain("");
			expect(variations).not.toContain("  ");
		});

		it("should not duplicate original query in variations", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: {
					queries: [
						"original", // Same as input
						"variation 1",
						"variation 2",
					],
				},
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const variations = await retriever.expandQuery("original");

			// Should have original once, not twice
			expect(variations.filter((v) => v === "original")).toHaveLength(1);
		});

		it("should limit variations to numVariations config", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: {
					queries: ["variation 1", "variation 2", "variation 3", "variation 4", "variation 5"],
				},
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const variations = await retriever.expandQuery("original");

			// Original + numVariations (3) = 4
			expect(variations).toHaveLength(4);
		});

		it("should return only original on LLM error", async () => {
			mockGenerateObject.mockRejectedValueOnce(new Error("API error"));

			const variations = await retriever.expandQuery("original");

			expect(variations).toEqual(["original"]);
		});

		it("should build prompt with configured strategies", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["v1", "v2", "v3"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await retriever.expandQuery("test query");

			const callArgs = mockGenerateObject.mock.calls[0][0];

			expect(callArgs.prompt).toContain("Paraphrase");
			expect(callArgs.prompt).toContain("Keyword");
			expect(callArgs.prompt).toContain("Step-back");
		});

		it("should include decompose strategy when configured", async () => {
			const decomposeRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				config: {
					strategies: ["decompose"],
					numVariations: 2,
				},
			});

			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["sub-q1", "sub-q2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await decomposeRetriever.expandQuery("complex query");

			const callArgs = mockGenerateObject.mock.calls[0][0];

			expect(callArgs.prompt).toContain("Decompose");
		});
	});

	describe("RRF fusion", () => {
		it("should compute correct RRF scores", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["q1", "q2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			// Set up results where doc-1 appears first in both sets
			const results1 = [
				{ id: "doc-1", score: 0.9, payload: {} },
				{ id: "doc-2", score: 0.8, payload: {} },
			];
			const results2 = [
				{ id: "doc-1", score: 0.85, payload: {} },
				{ id: "doc-3", score: 0.7, payload: {} },
			];

			mockBaseRetriever.search.mockResolvedValueOnce(results1).mockResolvedValueOnce(results2);

			// Create retriever that doesn't include original
			const rrfRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				config: { includeOriginal: false, numVariations: 2, rrfK: 60 },
			});

			const results = await rrfRetriever.search({ text: "test", limit: 10 });

			// doc-1 appears at rank 0 in both sets
			// RRF score = 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.0328
			const doc1 = results.find((r) => r.id === "doc-1");
			expect(doc1).toBeDefined();

			// doc-1 should have highest RRF score
			expect(results[0].id).toBe("doc-1");
		});

		it("should deduplicate documents across result sets", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["v1"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			// Same document appears in multiple result sets
			const results1 = [{ id: "doc-1", score: 0.9, payload: {} }];
			const results2 = [{ id: "doc-1", score: 0.8, payload: {} }];

			mockBaseRetriever.search.mockResolvedValueOnce(results1).mockResolvedValueOnce(results2);

			const results = await retriever.search({ text: "test", limit: 10 });

			// doc-1 should appear only once
			const doc1Count = results.filter((r) => r.id === "doc-1").length;
			expect(doc1Count).toBe(1);
		});
	});

	describe("getUsage()", () => {
		it("should track LLM usage", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["v1", "v2"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await retriever.search({ text: "test", limit: 10 });

			const usage = retriever.getUsage();
			expect(usage.totalCostCents).toBeGreaterThan(0);
			expect(usage.totalTokens).toBeGreaterThan(0);
		});
	});

	describe("resetUsage()", () => {
		it("should reset usage counters", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { queries: ["v1"] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});
			await retriever.search({ text: "test", limit: 10 });

			retriever.resetUsage();

			const usage = retriever.getUsage();
			expect(usage.totalCostCents).toBe(0);
			expect(usage.totalTokens).toBe(0);
		});
	});

	describe("getConfig()", () => {
		it("should return current configuration", () => {
			const config = retriever.getConfig();

			expect(config).toEqual({
				numVariations: 3,
				strategies: ["paraphrase", "keyword", "stepback"],
				includeOriginal: true,
				rrfK: 60,
			});
		});

		it("should return a copy to prevent mutation", () => {
			const config1 = retriever.getConfig();
			config1.numVariations = 100;

			const config2 = retriever.getConfig();
			expect(config2.numVariations).toBe(3);
		});
	});
});
