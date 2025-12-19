import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_RETRIEVER_CONFIG, SessionAwareRetriever } from "./session-retriever";

/**
 * Mock Qdrant client for testing
 */
function createMockQdrantClient() {
	return {
		search: vi.fn(),
		query: vi.fn(),
	};
}

/**
 * Mock reranker for testing
 */
function createMockReranker() {
	return {
		rerank: vi.fn().mockImplementation((_, docs: string[], topK: number) => {
			return Promise.resolve(
				docs.slice(0, topK).map((_, idx) => ({
					originalIndex: idx,
					score: 1 - idx * 0.1,
				})),
			);
		}),
	};
}

/**
 * Create mock session search results
 */
function createMockSessionResults(count: number = 3) {
	return Array.from({ length: count }, (_, i) => ({
		id: `session-${i}`,
		score: 0.9 - i * 0.1,
		payload: {
			session_id: `session-${i}`,
			summary: `Summary for session ${i}`,
			topics: [`topic-${i}`],
			entities: [`entity-${i}`],
		},
	}));
}

/**
 * Create mock turn search results
 */
function createMockTurnResults(sessionId: string, count: number = 2) {
	return Array.from({ length: count }, (_, i) => ({
		id: `${sessionId}-turn-${i}`,
		score: 0.85 - i * 0.05,
		payload: {
			content: `Turn ${i} content for ${sessionId}`,
			node_id: `node-${i}`,
			session_id: sessionId,
			type: "thought" as const,
			timestamp: Date.now() - i * 60000,
		},
	}));
}

describe("SessionAwareRetriever", () => {
	let mockClient: ReturnType<typeof createMockQdrantClient>;

	beforeEach(() => {
		mockClient = createMockQdrantClient();
		vi.clearAllMocks();
	});

	describe("constructor", () => {
		it("should use default config when none provided", () => {
			const retriever = new SessionAwareRetriever(mockClient as never);
			expect(retriever.getConfig()).toEqual(DEFAULT_SESSION_RETRIEVER_CONFIG);
		});

		it("should merge custom config with defaults", () => {
			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 10,
				turnsPerSession: 5,
			});
			expect(retriever.getConfig().topSessions).toBe(10);
			expect(retriever.getConfig().turnsPerSession).toBe(5);
			expect(retriever.getConfig().finalTopK).toBe(DEFAULT_SESSION_RETRIEVER_CONFIG.finalTopK);
		});
	});

	describe("retrieve", () => {
		it("should return empty array when no sessions found", async () => {
			mockClient.search.mockResolvedValue([]);

			const retriever = new SessionAwareRetriever(mockClient as never);

			// Mock the embedder
			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			expect(results).toEqual([]);
			expect(mockClient.search).toHaveBeenCalledTimes(1);
		});

		it("should perform two-stage retrieval", async () => {
			const sessionResults = createMockSessionResults(2);
			const turnResults0 = createMockTurnResults("session-0", 2);
			const turnResults1 = createMockTurnResults("session-1", 2);

			// First call: session search, subsequent calls: turn searches
			mockClient.search
				.mockResolvedValueOnce(sessionResults)
				.mockResolvedValueOnce(turnResults0)
				.mockResolvedValueOnce(turnResults1);

			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 2,
				turnsPerSession: 2,
				parallelTurnRetrieval: false, // Sequential for predictable test
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			// Should have 4 results (2 sessions × 2 turns)
			expect(results).toHaveLength(4);

			// Verify session search was called first
			expect(mockClient.search).toHaveBeenCalledWith(
				"sessions",
				expect.objectContaining({
					limit: 2,
					with_payload: true,
				}),
			);

			// Verify turn searches were called with session filters
			expect(mockClient.search).toHaveBeenCalledWith(
				"engram_memory",
				expect.objectContaining({
					filter: { must: [{ key: "session_id", match: { value: "session-0" } }] },
				}),
			);
		});

		it("should include session context in results", async () => {
			const sessionResults = createMockSessionResults(1);
			const turnResults = createMockTurnResults("session-0", 1);

			mockClient.search.mockResolvedValueOnce(sessionResults).mockResolvedValueOnce(turnResults);

			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 1,
				turnsPerSession: 1,
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			expect(results[0].sessionId).toBe("session-0");
			expect(results[0].sessionSummary).toBe("Summary for session 0");
			expect(results[0].sessionScore).toBe(0.9);
		});

		it("should apply reranking when reranker provided and results exceed finalTopK", async () => {
			const sessionResults = createMockSessionResults(3);
			const turnResults = createMockTurnResults("session-0", 5);

			mockClient.search.mockResolvedValueOnce(sessionResults).mockResolvedValue(turnResults);

			const mockReranker = createMockReranker();
			const retriever = new SessionAwareRetriever(
				mockClient as never,
				{ topSessions: 3, turnsPerSession: 5, finalTopK: 5 },
				mockReranker as never,
			);

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			await retriever.retrieve("test query");

			// Reranker should be called since we have 15 turns (3×5) > finalTopK (5)
			expect(mockReranker.rerank).toHaveBeenCalledWith("test query", expect.any(Array), 5);
		});

		it("should not rerank when results are below finalTopK", async () => {
			const sessionResults = createMockSessionResults(1);
			const turnResults = createMockTurnResults("session-0", 2);

			mockClient.search.mockResolvedValueOnce(sessionResults).mockResolvedValueOnce(turnResults);

			const mockReranker = createMockReranker();
			const retriever = new SessionAwareRetriever(
				mockClient as never,
				{ topSessions: 1, turnsPerSession: 2, finalTopK: 10 },
				mockReranker as never,
			);

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			await retriever.retrieve("test query");

			// Reranker should NOT be called since we only have 2 turns < finalTopK (10)
			expect(mockReranker.rerank).not.toHaveBeenCalled();
		});

		it("should handle session retrieval errors gracefully", async () => {
			mockClient.search.mockRejectedValueOnce(new Error("Connection failed"));

			const retriever = new SessionAwareRetriever(mockClient as never);

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			expect(results).toEqual([]);
		});

		it("should handle turn retrieval errors gracefully", async () => {
			const sessionResults = createMockSessionResults(2);

			mockClient.search
				.mockResolvedValueOnce(sessionResults)
				.mockRejectedValueOnce(new Error("Turn query failed"))
				.mockResolvedValueOnce(createMockTurnResults("session-1", 2));

			const retriever = new SessionAwareRetriever(mockClient as never, {
				parallelTurnRetrieval: false,
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			// Should still get results from session-1
			expect(results.length).toBeGreaterThan(0);
			expect(results.every((r) => r.sessionId === "session-1")).toBe(true);
		});

		it("should perform parallel turn retrieval when enabled", async () => {
			const sessionResults = createMockSessionResults(3);

			// All turn searches resolve immediately
			mockClient.search
				.mockResolvedValueOnce(sessionResults)
				.mockResolvedValue(createMockTurnResults("session-x", 2));

			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 3,
				turnsPerSession: 2,
				parallelTurnRetrieval: true,
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			await retriever.retrieve("test query");

			// 1 session search + 3 parallel turn searches = 4 total calls
			expect(mockClient.search).toHaveBeenCalledTimes(4);
		});
	});

	describe("retrieveSessions", () => {
		it("should apply score threshold filter", async () => {
			mockClient.search.mockResolvedValue([]);

			const retriever = new SessionAwareRetriever(mockClient as never, {
				sessionScoreThreshold: 0.5,
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			await retriever.retrieve("test query");

			expect(mockClient.search).toHaveBeenCalledWith(
				"sessions",
				expect.objectContaining({
					score_threshold: 0.5,
				}),
			);
		});

		it("should use configured vector name", async () => {
			mockClient.search.mockResolvedValue([]);

			const retriever = new SessionAwareRetriever(mockClient as never, {
				sessionVectorName: "custom_vector",
			});

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			await retriever.retrieve("test query");

			expect(mockClient.search).toHaveBeenCalledWith(
				"sessions",
				expect.objectContaining({
					vector: expect.objectContaining({
						name: "custom_vector",
					}),
				}),
			);
		});
	});

	describe("configuration", () => {
		it("should update config at runtime", () => {
			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 5,
			});
			expect(retriever.getConfig().topSessions).toBe(5);

			retriever.updateConfig({ topSessions: 10 });
			expect(retriever.getConfig().topSessions).toBe(10);
		});

		it("should preserve other config when updating", () => {
			const retriever = new SessionAwareRetriever(mockClient as never, {
				topSessions: 5,
				turnsPerSession: 3,
			});

			retriever.updateConfig({ topSessions: 10 });

			expect(retriever.getConfig().topSessions).toBe(10);
			expect(retriever.getConfig().turnsPerSession).toBe(3);
		});
	});

	describe("reranking", () => {
		it("should fall back to sorted results on reranker error", async () => {
			const sessionResults = createMockSessionResults(2);
			const turnResults = createMockTurnResults("session-0", 5);

			mockClient.search.mockResolvedValueOnce(sessionResults).mockResolvedValue(turnResults);

			const mockReranker = {
				rerank: vi.fn().mockRejectedValue(new Error("Reranker failed")),
			};

			const retriever = new SessionAwareRetriever(
				mockClient as never,
				{ topSessions: 2, turnsPerSession: 5, finalTopK: 3 },
				mockReranker as never,
			);

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			// Should fall back to top 3 by score
			expect(results).toHaveLength(3);
		});

		it("should preserve session context after reranking", async () => {
			const sessionResults = createMockSessionResults(1);
			const turnResults = createMockTurnResults("session-0", 3);

			mockClient.search.mockResolvedValueOnce(sessionResults).mockResolvedValueOnce(turnResults);

			const mockReranker = createMockReranker();
			const retriever = new SessionAwareRetriever(
				mockClient as never,
				{ topSessions: 1, turnsPerSession: 3, finalTopK: 2 },
				mockReranker as never,
			);

			vi.spyOn(retriever as never, "embedder", "get").mockReturnValue({
				embedQuery: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
			} as never);

			const results = await retriever.retrieve("test query");

			// All results should still have session context
			expect(results.every((r) => r.sessionId === "session-0")).toBe(true);
			expect(results.every((r) => r.sessionSummary !== undefined)).toBe(true);
		});
	});
});
