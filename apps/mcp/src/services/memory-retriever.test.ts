import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRetriever } from "./memory-retriever";

// Mock the graph client
const mockGraphClient = {
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	query: vi.fn(),
};

// Mock the search retriever
const mockSearchRetriever = {
	search: vi.fn(),
};

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
			searchRetriever: mockSearchRetriever as any,
			logger: mockLogger as any,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("recall", () => {
		it("should combine results from Qdrant and graph search", async () => {
			// Qdrant results
			mockSearchRetriever.search.mockResolvedValueOnce([
				{
					score: 0.9,
					payload: {
						node_id: "qdrant-1",
						content: "Qdrant result 1",
						type: "decision",
						timestamp: Date.now(),
					},
				},
				{
					score: 0.8,
					payload: {
						node_id: "qdrant-2",
						content: "Qdrant result 2",
						type: "context",
						timestamp: Date.now(),
					},
				},
			]);

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
			mockSearchRetriever.search.mockResolvedValueOnce([
				{
					score: 0.9,
					payload: {
						node_id: sharedId,
						content: "Shared memory content",
						type: "decision",
						timestamp: Date.now(),
					},
				},
			]);

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
			mockSearchRetriever.search.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { type: "decision" });

			// Search should be called with type filter mapped to search type
			expect(mockSearchRetriever.search).toHaveBeenCalledWith(
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
			mockSearchRetriever.search.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { project: "my-project" });

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.project = $project"),
				expect.objectContaining({ project: "my-project" }),
			);
		});

		it("should respect limit parameter", async () => {
			// Return more results than limit
			mockSearchRetriever.search.mockResolvedValueOnce(
				Array.from({ length: 10 }, (_, i) => ({
					score: 0.9 - i * 0.05,
					payload: {
						node_id: `result-${i}`,
						content: `Result ${i}`,
						type: "context",
						timestamp: Date.now(),
					},
				})),
			);
			mockGraphClient.query.mockResolvedValueOnce([]);

			const results = await retriever.recall("test query", 3);

			expect(results).toHaveLength(3);
		});

		it("should sort results by score descending", async () => {
			mockSearchRetriever.search.mockResolvedValueOnce([
				{ score: 0.5, payload: { node_id: "low", content: "Low", type: "context" } },
				{ score: 0.9, payload: { node_id: "high", content: "High", type: "context" } },
				{ score: 0.7, payload: { node_id: "mid", content: "Mid", type: "context" } },
			]);
			mockGraphClient.query.mockResolvedValueOnce([]);

			const results = await retriever.recall("test query", 5);

			expect(results[0].id).toBe("high");
			expect(results[1].id).toBe("mid");
			expect(results[2].id).toBe("low");
		});

		it("should handle turn type mapping to thought search type", async () => {
			mockSearchRetriever.search.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce([]);

			await retriever.recall("test query", 5, { type: "turn" });

			expect(mockSearchRetriever.search).toHaveBeenCalledWith(
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
