import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchClient } from "../clients/search";
import { MemoryRetriever } from "./memory-retriever";

// Mock the graph client
const mockGraphClient = {
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	query: vi.fn(),
};

// Mock the search client
const mockSearchClient: SearchClient = {
	search: vi.fn(),
} as unknown as SearchClient;

// Mock the logger
const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

describe("MemoryRetriever", () => {
	let retriever: MemoryRetriever;

	beforeEach(() => {
		vi.clearAllMocks();
		retriever = new MemoryRetriever({
			graphClient: mockGraphClient as any,
			searchClient: mockSearchClient,
			logger: mockLogger as any,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("recall", () => {
		it("should combine results from Qdrant and graph search", async () => {
			// Search-py results
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [
					{
						id: "qdrant-1",
						score: 0.9,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: {
							node_id: "qdrant-1",
							content: "Qdrant result 1",
							type: "decision",
							timestamp: Date.now(),
						},
					},
					{
						id: "qdrant-2",
						score: 0.8,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: {
							node_id: "qdrant-2",
							content: "Qdrant result 2",
							type: "context",
							timestamp: Date.now(),
						},
					},
				],
				total: 2,
				took_ms: 50,
			});

			// Graph results
			mockGraphClient.query.mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: "graph-1",
							content: "Graph result 1",
							type: "insight",
							vt_start: Date.now(),
							source: "user",
						},
					},
				},
			]);

			const results = await retriever.recall("test query", 5);

			expect(results).toHaveLength(3);
			// Qdrant results should have higher scores
			expect(results[0].id).toBe("qdrant-1");
			expect(results[0].score).toBe(0.9);
			expect(results[1].id).toBe("qdrant-2");
			expect(results[1].score).toBe(0.8);
			// Graph result should have default score
			expect(results[2].id).toBe("graph-1");
			expect(results[2].score).toBe(0.5);
		});

		it("should deduplicate results from Qdrant and graph", async () => {
			const sharedId = "shared-memory";

			// Same memory in both Qdrant and graph
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [
					{
						id: sharedId,
						score: 0.9,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: {
							node_id: sharedId,
							content: "Shared memory content",
							type: "decision",
							timestamp: Date.now(),
						},
					},
				],
				total: 1,
				took_ms: 50,
			});

			mockGraphClient.query.mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: sharedId, // Same ID
							content: "Shared memory content",
							type: "decision",
							vt_start: Date.now(),
						},
					},
				},
			]);

			const results = await retriever.recall("test query", 5);

			// Should only have one result (deduplicated)
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(sharedId);
			// Should use Qdrant score (higher priority)
			expect(results[0].score).toBe(0.9);
		});

		it("should apply type filter to search", async () => {
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [],
				total: 0,
				took_ms: 10,
			});
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { type: "decision" });

			// Search should be called with type filter mapped to search type
			expect(mockSearchClient.search).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: expect.objectContaining({ type: "doc" }),
				}),
			);

			// Graph query should include type filter
			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.type = $type"),
				expect.objectContaining({ type: "decision" }),
			);
		});

		it("should apply project filter to graph query", async () => {
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [],
				total: 0,
				took_ms: 10,
			});
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { project: "my-project" });

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.project = $project"),
				expect.objectContaining({ project: "my-project" }),
			);
		});

		it("should respect limit parameter", async () => {
			// Return more results than limit
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: Array.from({ length: 10 }, (_, i) => ({
					id: `result-${i}`,
					score: 0.9 - i * 0.05,
					rrf_score: null,
					reranker_score: null,
					rerank_tier: null,
					degraded: false,
					payload: {
						node_id: `result-${i}`,
						content: `Result ${i}`,
						type: "context",
						timestamp: Date.now(),
					},
				})),
				total: 10,
				took_ms: 50,
			});
			mockGraphClient.query.mockResolvedValueOnce([]);

			const results = await retriever.recall("test query", 3);

			expect(results).toHaveLength(3);
		});

		it("should sort results by score descending", async () => {
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [
					{
						id: "low",
						score: 0.5,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: { node_id: "low", content: "Low", type: "context" },
					},
					{
						id: "high",
						score: 0.9,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: { node_id: "high", content: "High", type: "context" },
					},
					{
						id: "mid",
						score: 0.7,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: { node_id: "mid", content: "Mid", type: "context" },
					},
				],
				total: 3,
				took_ms: 50,
			});
			mockGraphClient.query.mockResolvedValueOnce([]);

			const results = await retriever.recall("test query", 5);

			expect(results[0].id).toBe("high");
			expect(results[1].id).toBe("mid");
			expect(results[2].id).toBe("low");
		});

		it("should handle turn type mapping to thought search type", async () => {
			vi.mocked(mockSearchClient.search).mockResolvedValueOnce({
				results: [],
				total: 0,
				took_ms: 10,
			});
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { type: "turn" });

			expect(mockSearchClient.search).toHaveBeenCalledWith(
				expect.objectContaining({
					filters: expect.objectContaining({ type: "thought" }),
				}),
			);
		});
	});

	describe("connect", () => {
		it("should connect to graph client", async () => {
			await retriever.connect();

			expect(mockGraphClient.connect).toHaveBeenCalled();
		});
	});
});
