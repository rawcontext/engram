import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiQueryRetriever } from "./multi-query-retriever";

// Mock logger
vi.mock("@engram/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("MultiQueryRetriever", () => {
	let retriever: MultiQueryRetriever;
	let mockLLMClient: any;
	let mockBaseRetriever: any;

	const mockSearchResults = [
		{ id: "doc-1", score: 0.95, payload: { content: "OAuth2 guide" } },
		{ id: "doc-2", score: 0.9, payload: { content: "JWT tokens" } },
		{ id: "doc-3", score: 0.85, payload: { content: "API security" } },
	];

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock LLM client
		mockLLMClient = {
			chatJSON: vi.fn(),
			getTotalCost: vi.fn().mockReturnValue(2.5),
			getTotalTokens: vi.fn().mockReturnValue(500),
			resetCounters: vi.fn(),
		};

		// Create mock base retriever
		mockBaseRetriever = {
			search: vi.fn().mockResolvedValue(mockSearchResults),
		};

		retriever = new MultiQueryRetriever({
			baseRetriever: mockBaseRetriever,
			llmClient: mockLLMClient as any,
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
				llmClient: mockLLMClient as any,
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
				llmClient: mockLLMClient as any,
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
			// Mock LLM to return expanded queries
			mockLLMClient.chatJSON.mockResolvedValueOnce([
				"OAuth2 authentication implementation",
				"how to add OAuth login",
				"authentication flow for web apps",
			]);

			await retriever.search({ text: "How to implement OAuth2?", limit: 10 });

			// Should call base retriever 4 times (original + 3 variations)
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(4);
		});

		it("should include original query when configured", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["variation1", "variation2", "variation3"]);

			await retriever.search({ text: "original query", limit: 10 });

			// First call should be with original query
			expect(mockBaseRetriever.search).toHaveBeenCalledWith(
				expect.objectContaining({ text: "original query" }),
			);
		});

		it("should exclude original query when not configured", async () => {
			const noOriginalRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				llmClient: mockLLMClient as any,
				config: { includeOriginal: false, numVariations: 2 },
			});

			mockLLMClient.chatJSON.mockResolvedValueOnce(["variation1", "variation2"]);

			await noOriginalRetriever.search({ text: "original query", limit: 10 });

			// Should only call with variations (2 times), not with original
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(2);
			expect(mockBaseRetriever.search).not.toHaveBeenCalledWith(
				expect.objectContaining({ text: "original query" }),
			);
		});

		it("should fuse results using RRF", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["variation1", "variation2"]);

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
			mockLLMClient.chatJSON.mockResolvedValueOnce(["v1", "v2"]);

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
			mockLLMClient.chatJSON.mockRejectedValueOnce(new Error("LLM API error"));

			const results = await retriever.search({ text: "test query", limit: 10 });

			// Should fall back to single query
			expect(mockBaseRetriever.search).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(3);
		});

		it("should pass through search query options", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["variation"]);

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
			mockLLMClient.chatJSON.mockResolvedValueOnce([
				"OAuth2 authentication guide",
				"implementing OAuth login",
				"secure authentication flow",
			]);

			const variations = await retriever.expandQuery("How to implement OAuth2?");

			// Should include original + 3 variations
			expect(variations).toHaveLength(4);
			expect(variations[0]).toBe("How to implement OAuth2?");
		});

		it("should filter out empty variations", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce([
				"valid query",
				"  ", // Empty/whitespace
				"another valid",
				"", // Empty
			]);

			const variations = await retriever.expandQuery("original");

			// Should include original + 2 valid variations (not 4)
			expect(variations).toHaveLength(3);
			expect(variations).not.toContain("");
			expect(variations).not.toContain("  ");
		});

		it("should not duplicate original query in variations", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce([
				"original", // Same as input
				"variation 1",
				"variation 2",
			]);

			const variations = await retriever.expandQuery("original");

			// Should have original once, not twice
			expect(variations.filter((v) => v === "original")).toHaveLength(1);
		});

		it("should limit variations to numVariations config", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce([
				"variation 1",
				"variation 2",
				"variation 3",
				"variation 4",
				"variation 5",
			]);

			const variations = await retriever.expandQuery("original");

			// Original + numVariations (3) = 4
			expect(variations).toHaveLength(4);
		});

		it("should return only original on LLM error", async () => {
			mockLLMClient.chatJSON.mockRejectedValueOnce(new Error("API error"));

			const variations = await retriever.expandQuery("original");

			expect(variations).toEqual(["original"]);
		});

		it("should build prompt with configured strategies", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["v1", "v2", "v3"]);

			await retriever.expandQuery("test query");

			const callArgs = mockLLMClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");

			expect(userMessage.content).toContain("Paraphrase");
			expect(userMessage.content).toContain("Keyword");
			expect(userMessage.content).toContain("Step-back");
		});

		it("should include decompose strategy when configured", async () => {
			const decomposeRetriever = new MultiQueryRetriever({
				baseRetriever: mockBaseRetriever,
				llmClient: mockLLMClient as any,
				config: {
					strategies: ["decompose"],
					numVariations: 2,
				},
			});

			mockLLMClient.chatJSON.mockResolvedValueOnce(["sub-q1", "sub-q2"]);

			await decomposeRetriever.expandQuery("complex query");

			const callArgs = mockLLMClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");

			expect(userMessage.content).toContain("Decompose");
		});
	});

	describe("RRF fusion", () => {
		it("should compute correct RRF scores", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["q1", "q2"]);

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
				llmClient: mockLLMClient as any,
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
			mockLLMClient.chatJSON.mockResolvedValueOnce(["v1"]);

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
			mockLLMClient.chatJSON.mockResolvedValueOnce(["v1", "v2"]);

			await retriever.search({ text: "test", limit: 10 });

			const usage = retriever.getUsage();
			expect(usage.totalCostCents).toBeGreaterThan(0);
			expect(usage.totalTokens).toBeGreaterThan(0);
		});
	});

	describe("resetUsage()", () => {
		it("should reset usage counters", async () => {
			mockLLMClient.chatJSON.mockResolvedValueOnce(["v1"]);
			await retriever.search({ text: "test", limit: 10 });

			retriever.resetUsage();

			expect(mockLLMClient.resetCounters).toHaveBeenCalled();
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
