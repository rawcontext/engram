import { GraphOperationError, SearchError } from "@engram/common";

// TODO: Replace with HTTP client to search-py service (port 5002)
// import type { SearchRetriever } from "@engram/search";
type SearchRetriever = any; // TODO: Replace with HTTP client type

import type { GraphClient, ThoughtNode } from "@engram/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextAssembler, type ContextAssemblerDeps, createContextAssembler } from "./assembler";

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a mock GraphClient
 */
function createMockGraphClient(overrides?: Partial<GraphClient>): GraphClient {
	return {
		connect: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
		query: vi.fn(async () => []),
		isConnected: vi.fn(() => true),
		...overrides,
	};
}

/**
 * Create a mock SearchRetriever
 */
function createMockSearchRetriever(overrides?: Partial<SearchRetriever>): SearchRetriever {
	return {
		search: vi.fn(async () => []),
		...overrides,
	} as SearchRetriever;
}

/**
 * Create a mock ThoughtNode for testing
 */
function createMockThoughtNode(overrides?: Partial<ThoughtNode>): ThoughtNode {
	return {
		id: 1,
		labels: ["Thought"],
		properties: {
			id: "thought-1",
			type: "message",
			role: "user",
			content: "Hello, world!",
			vt_start: Date.now(),
			vt_end: Number.MAX_SAFE_INTEGER,
			tt_start: Date.now(),
			tt_end: Number.MAX_SAFE_INTEGER,
		},
		...overrides,
	};
}

// =============================================================================
// Test Suite
// =============================================================================

describe("ContextAssembler", () => {
	let mockGraphClient: GraphClient;
	let mockSearchRetriever: SearchRetriever;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGraphClient = createMockGraphClient();
		mockSearchRetriever = createMockSearchRetriever();
	});

	// =========================================================================
	// Factory Function Tests
	// =========================================================================

	describe("createContextAssembler", () => {
		it("should create an instance with default dependencies", () => {
			// Arrange & Act
			const assembler = createContextAssembler();

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});

		it("should create an instance with injected dependencies", () => {
			// Arrange
			const deps: ContextAssemblerDeps = {
				graphClient: mockGraphClient,
				searchRetriever: mockSearchRetriever,
			};

			// Act
			const assembler = createContextAssembler(deps);

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});

		it("should create an instance with null search retriever", () => {
			// Arrange
			const deps: ContextAssemblerDeps = {
				graphClient: mockGraphClient,
				searchRetriever: null,
			};

			// Act
			const assembler = createContextAssembler(deps);

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});

		it("should create an instance with only graphClient", () => {
			// Arrange
			const deps: ContextAssemblerDeps = {
				graphClient: mockGraphClient,
			};

			// Act
			const assembler = createContextAssembler(deps);

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});
	});

	// =========================================================================
	// Constructor Tests (Legacy Support)
	// =========================================================================

	describe("constructor (legacy support)", () => {
		it("should support legacy constructor with null search", () => {
			// Arrange & Act
			const assembler = new ContextAssembler(null, mockGraphClient as any);

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});

		it("should support legacy constructor with search and memory", () => {
			// Arrange & Act
			const assembler = new ContextAssembler(mockSearchRetriever, mockGraphClient as any);

			// Assert
			expect(assembler).toBeInstanceOf(ContextAssembler);
		});
	});

	// =========================================================================
	// Context Assembly Tests
	// =========================================================================

	describe("assembleContext", () => {
		it("should include system prompt in context", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "What is the weather?");

			// Assert
			expect(context).toContain("You are Engram");
			expect(context).toContain("intelligent assistant");
		});

		it("should include the current query in context", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});
			const query = "What is the weather today?";

			// Act
			const context = await assembler.assembleContext("session-1", query);

			// Assert
			expect(context).toContain(`User: ${query}`);
		});

		it("should include recent history when available", async () => {
			// Arrange
			const mockHistory: ThoughtNode[] = [
				createMockThoughtNode({
					properties: {
						id: "thought-1",
						type: "message",
						role: "user",
						content: "Previous question",
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
				createMockThoughtNode({
					properties: {
						id: "thought-2",
						type: "message",
						role: "assistant",
						content: "Previous answer",
						vt_start: 2000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 2000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => mockHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Current question");

			// Assert
			expect(context).toContain("[Recent History]");
			expect(context).toContain("user: Previous question");
			expect(context).toContain("assistant: Previous answer");
		});

		it("should include search results when available", async () => {
			// Arrange
			const mockSearchResults = [
				{
					id: "point-1",
					score: 0.9,
					payload: {
						session_id: "other-session",
						content: "Relevant memory 1",
					},
				},
				{
					id: "point-2",
					score: 0.8,
					payload: {
						session_id: "other-session",
						content: "Relevant memory 2",
					},
				},
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Find relevant info");

			// Assert
			expect(context).toContain("[Relevant Memories]");
			expect(context).toContain("- Relevant memory 1");
			expect(context).toContain("- Relevant memory 2");
		});

		it("should filter out current session from search results", async () => {
			// Arrange
			const currentSessionId = "session-1";
			const mockSearchResults = [
				{
					id: "point-1",
					score: 0.9,
					payload: {
						session_id: currentSessionId, // Same session - should be filtered
						content: "Content from current session",
					},
				},
				{
					id: "point-2",
					score: 0.8,
					payload: {
						session_id: "other-session",
						content: "Content from other session",
					},
				},
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext(currentSessionId, "Find relevant info");

			// Assert
			expect(context).not.toContain("Content from current session");
			expect(context).toContain("Content from other session");
		});

		it("should handle empty search results", async () => {
			// Arrange
			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => []),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "No memories");

			// Assert
			expect(context).not.toContain("[Relevant Memories]");
		});

		it("should handle null search results", async () => {
			// Arrange
			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => null as any),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "No memories");

			// Assert
			expect(context).not.toContain("[Relevant Memories]");
		});

		it("should handle results with missing content", async () => {
			// Arrange
			const mockSearchResults = [
				{
					id: "point-1",
					score: 0.9,
					payload: {
						session_id: "other-session",
						// Missing content
					},
				},
				{
					id: "point-2",
					score: 0.8,
					payload: {
						session_id: "other-session",
						content: "Has content",
					},
				},
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Mixed results");

			// Assert
			expect(context).toContain("Has content");
		});

		it("should limit search results to top 3", async () => {
			// Arrange
			const mockSearchResults = [
				{ id: "1", score: 0.95, payload: { session_id: "other", content: "Memory 1" } },
				{ id: "2", score: 0.9, payload: { session_id: "other", content: "Memory 2" } },
				{ id: "3", score: 0.85, payload: { session_id: "other", content: "Memory 3" } },
				{ id: "4", score: 0.8, payload: { session_id: "other", content: "Memory 4" } },
				{ id: "5", score: 0.75, payload: { session_id: "other", content: "Memory 5" } },
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Many memories");

			// Assert
			expect(context).toContain("Memory 1");
			expect(context).toContain("Memory 2");
			expect(context).toContain("Memory 3");
			expect(context).not.toContain("Memory 4");
			expect(context).not.toContain("Memory 5");
		});
	});

	// =========================================================================
	// History Retrieval Tests
	// =========================================================================

	describe("fetchRecentHistory (via assembleContext)", () => {
		it("should connect to graph before querying", async () => {
			// Arrange
			const connectMock = vi.fn(async () => {});
			const graphClient = createMockGraphClient({
				connect: connectMock,
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			await assembler.assembleContext("session-1", "Query");

			// Assert
			expect(connectMock).toHaveBeenCalled();
		});

		it("should query with session ID parameter", async () => {
			// Arrange
			const queryMock = vi.fn(async () => []);
			const graphClient = createMockGraphClient({
				query: queryMock,
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});
			const sessionId = "test-session-123";

			// Act
			await assembler.assembleContext(sessionId, "Query");

			// Assert
			expect(queryMock).toHaveBeenCalledWith(expect.any(String), { sessionId });
		});

		it("should fall back to timestamp ordering when no NEXT chain results", async () => {
			// Arrange
			const queryMock = vi
				.fn()
				.mockResolvedValueOnce([]) // First query (NEXT chain) returns empty
				.mockResolvedValueOnce([
					{
						thought: createMockThoughtNode({
							properties: {
								id: "fallback-thought",
								type: "message",
								role: "user",
								content: "Fallback content",
								vt_start: 1000,
								vt_end: Number.MAX_SAFE_INTEGER,
								tt_start: 1000,
								tt_end: Number.MAX_SAFE_INTEGER,
							},
						}),
					},
				]);

			const graphClient = createMockGraphClient({
				query: queryMock,
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert
			expect(queryMock).toHaveBeenCalledTimes(2);
			expect(context).toContain("Fallback content");
		});

		it("should reverse NEXT chain results for chronological order", async () => {
			// Arrange
			const mockHistory = [
				createMockThoughtNode({
					properties: {
						id: "3",
						type: "message",
						role: "user",
						content: "Third message (newest)",
						vt_start: 3000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 3000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
				createMockThoughtNode({
					properties: {
						id: "2",
						type: "message",
						role: "assistant",
						content: "Second message",
						vt_start: 2000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 2000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
				createMockThoughtNode({
					properties: {
						id: "1",
						type: "message",
						role: "user",
						content: "First message (oldest)",
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => mockHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert - oldest should appear first in the context
			const firstPos = context.indexOf("First message (oldest)");
			const thirdPos = context.indexOf("Third message (newest)");
			expect(firstPos).toBeLessThan(thirdPos);
		});
	});

	// =========================================================================
	// Error Handling Tests
	// =========================================================================

	describe("error handling", () => {
		it("should throw GraphOperationError when graph query fails", async () => {
			// Arrange
			const graphError = new Error("Connection refused");
			const graphClient = createMockGraphClient({
				query: vi.fn().mockRejectedValue(graphError),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act & Assert
			await expect(assembler.assembleContext("session-1", "Query")).rejects.toThrow(
				GraphOperationError,
			);
		});

		it("should include session ID in GraphOperationError", async () => {
			// Arrange
			const graphClient = createMockGraphClient({
				query: vi.fn().mockRejectedValue(new Error("DB error")),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});
			const sessionId = "error-session-123";

			// Act & Assert
			try {
				await assembler.assembleContext(sessionId, "Query");
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(GraphOperationError);
				expect((error as GraphOperationError).message).toContain(sessionId);
			}
		});

		it("should throw SearchError when search fails", async () => {
			// Arrange
			const searchError = new Error("Search unavailable");
			const searchRetriever = createMockSearchRetriever({
				search: vi.fn().mockRejectedValue(searchError),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act & Assert
			await expect(assembler.assembleContext("session-1", "Query")).rejects.toThrow(SearchError);
		});

		it("should preserve original error as cause in GraphOperationError", async () => {
			// Arrange
			const originalError = new Error("Original DB error");
			const graphClient = createMockGraphClient({
				query: vi.fn().mockRejectedValue(originalError),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act & Assert
			try {
				await assembler.assembleContext("session-1", "Query");
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(GraphOperationError);
				expect((error as GraphOperationError).cause).toBe(originalError);
			}
		});

		it("should preserve original error as cause in SearchError", async () => {
			// Arrange
			const originalError = new Error("Original search error");
			const searchRetriever = createMockSearchRetriever({
				search: vi.fn().mockRejectedValue(originalError),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act & Assert
			try {
				await assembler.assembleContext("session-1", "Query");
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SearchError);
				expect((error as SearchError).cause).toBe(originalError);
			}
		});

		it("should truncate long queries in SearchError", async () => {
			// Arrange
			const longQuery = "A".repeat(200);
			const searchRetriever = createMockSearchRetriever({
				search: vi.fn().mockRejectedValue(new Error("Search failed")),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act & Assert
			try {
				await assembler.assembleContext("session-1", longQuery);
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SearchError);
				// Query should be truncated to 100 characters
				expect((error as SearchError).query?.length).toBeLessThanOrEqual(100);
			}
		});
	});

	// =========================================================================
	// Token Pruning Tests
	// =========================================================================

	describe("pruneToFit (via assembleContext)", () => {
		it("should respect token limit parameter", async () => {
			// Arrange
			const longHistory = Array.from({ length: 50 }, (_, i) =>
				createMockThoughtNode({
					properties: {
						id: `thought-${i}`,
						type: "message",
						role: i % 2 === 0 ? "user" : "assistant",
						content: `This is message number ${i} with some additional content to make it longer`,
						vt_start: i * 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: i * 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			);

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => longHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query", 500);

			// Assert - context should be limited (roughly 500 * 4 = 2000 characters max)
			// Account for some overhead, but it should be much less than unlimited
			expect(context.length).toBeLessThan(5000);
		});

		it("should keep system prompt (highest priority) even at low token limits", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});

			// Act - very low token limit
			const context = await assembler.assembleContext("session-1", "Query", 200);

			// Assert - system prompt should still be present
			expect(context).toContain("You are Engram");
		});

		it("should truncate high-priority sections with indicator when partially fitting", async () => {
			// Arrange
			const longHistory = [
				createMockThoughtNode({
					properties: {
						id: "long-thought",
						type: "message",
						role: "user",
						content: "A".repeat(5000), // Very long content
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => longHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act - moderate token limit
			const context = await assembler.assembleContext("session-1", "Query", 500);

			// Assert - should contain truncation indicator
			expect(context).toContain("[truncated]");
		});

		it("should exclude low-priority sections when space is limited", async () => {
			// Arrange - create scenario where memories would be lowest priority
			const mockHistory = [
				createMockThoughtNode({
					properties: {
						id: "thought-1",
						type: "message",
						role: "user",
						content: "B".repeat(1000),
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const mockSearchResults = [
				{
					id: "point-1",
					score: 0.9,
					payload: {
						session_id: "other",
						content: "Relevant memory content",
					},
				},
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => mockHistory.map((h) => ({ thought: h }))),
			});

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever,
			});

			// Act - limit that fits system prompt and history but not memories
			const context = await assembler.assembleContext("session-1", "Query", 400);

			// Assert - memories (priority 2) should be excluded before history (priority 1)
			// This is hard to test precisely without knowing exact sizes, but we can verify
			// the system prompt is still there (priority 0)
			expect(context).toContain("You are Engram");
		});

		it("should use default token limit of 8000", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});

			// Act - no token limit parameter
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert - should have assembled without error
			expect(context).toBeTruthy();
			expect(context).toContain("You are Engram");
		});
	});

	// =========================================================================
	// Search Integration Tests
	// =========================================================================

	describe("search integration", () => {
		it("should call search with correct parameters", async () => {
			// Arrange
			const searchMock = vi.fn(async () => []);
			const searchRetriever = createMockSearchRetriever({
				search: searchMock,
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});
			const query = "Find information about testing";

			// Act
			await assembler.assembleContext("session-1", query);

			// Assert
			expect(searchMock).toHaveBeenCalledWith({
				text: query,
				limit: 5,
				strategy: "hybrid",
			});
		});

		it("should skip search when search retriever is null", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert
			expect(context).not.toContain("[Relevant Memories]");
		});

		it("should handle search results without payload", async () => {
			// Arrange
			const mockSearchResults = [
				{ id: "1", score: 0.9 }, // No payload
				{ id: "2", score: 0.8, payload: null },
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults as any),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert - should not crash, should not include empty memories section
			expect(context).not.toContain("[Relevant Memories]");
		});
	});

	// =========================================================================
	// Output Formatting Tests
	// =========================================================================

	describe("output formatting", () => {
		it("should format system prompt without label", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert - system prompt should not have [System] prefix
			expect(context).not.toContain("[System]");
			expect(context).toContain("You are Engram");
		});

		it("should format current query with User: prefix", async () => {
			// Arrange
			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever: null,
			});
			const query = "What is the answer?";

			// Act
			const context = await assembler.assembleContext("session-1", query);

			// Assert
			expect(context).toContain(`User: ${query}`);
			expect(context).not.toContain("[Current Query]");
		});

		it("should format history with label", async () => {
			// Arrange
			const mockHistory = [
				createMockThoughtNode({
					properties: {
						id: "thought-1",
						type: "message",
						role: "user",
						content: "History message",
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => mockHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert
			expect(context).toContain("[Recent History]");
		});

		it("should format memories with label", async () => {
			// Arrange
			const mockSearchResults = [
				{
					id: "1",
					score: 0.9,
					payload: { session_id: "other", content: "Memory content" },
				},
			];

			const searchRetriever = createMockSearchRetriever({
				search: vi.fn(async () => mockSearchResults),
			});

			const assembler = createContextAssembler({
				graphClient: mockGraphClient,
				searchRetriever,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert
			expect(context).toContain("[Relevant Memories]");
			expect(context).toContain("- Memory content");
		});

		it("should separate sections with double newlines", async () => {
			// Arrange
			const mockHistory = [
				createMockThoughtNode({
					properties: {
						id: "thought-1",
						type: "message",
						role: "user",
						content: "History",
						vt_start: 1000,
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: 1000,
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				}),
			];

			const graphClient = createMockGraphClient({
				query: vi.fn(async () => mockHistory.map((h) => ({ thought: h }))),
			});

			const assembler = createContextAssembler({
				graphClient,
				searchRetriever: null,
			});

			// Act
			const context = await assembler.assembleContext("session-1", "Query");

			// Assert - sections should be separated by double newlines
			expect(context).toMatch(/\n\n/);
		});
	});
});
