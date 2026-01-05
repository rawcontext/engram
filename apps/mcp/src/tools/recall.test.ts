import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitationService } from "../capabilities";
import type { ICommunityRetriever } from "../services/community-retriever";
import type { IMemoryRetriever } from "../services/interfaces";
import { registerRecallTool } from "./recall";

describe("registerRecallTool", () => {
	let mockServer: McpServer;
	let mockMemoryRetriever: IMemoryRetriever;
	let mockElicitationService: ElicitationService;
	let registeredHandler: (args: Record<string, unknown>) => Promise<unknown>;

	beforeEach(() => {
		// Capture the handler when registerTool is called
		mockServer = {
			registerTool: mock((_name, _options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockMemoryRetriever = {
			recall: mock(async () => []),
		} as unknown as IMemoryRetriever;

		mockElicitationService = {
			enabled: false,
			selectMemory: mock(async () => ({ accepted: false })),
		} as unknown as ElicitationService;
	});

	describe("registration", () => {
		it("should register the recall tool with correct name", () => {
			registerRecallTool(mockServer, mockMemoryRetriever, () => ({}));

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"recall",
				expect.objectContaining({
					title: "Recall",
					description: expect.stringContaining("Search past memories"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
			);
		});

		it("should call memoryRetriever.recall with query and default limit", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith("test query", 5, expect.any(Object));
		});

		it("should pass custom limit to memoryRetriever.recall", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query", limit: 10 });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith("test query", 10, expect.any(Object));
		});

		it("should pass filters to memoryRetriever.recall", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({
				query: "test query",
				filters: { type: "decision" },
			});

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ type: "decision" }),
			);
		});

		it("should enable reranking by default", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ rerank: true }),
			);
		});

		it("should use fast rerank tier by default", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ rerank_tier: "fast" }),
			);
		});

		it("should allow disabling reranking", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query", rerank: false });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ rerank: false }),
			);
		});

		it("should use custom rerank tier", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query", rerank_tier: "accurate" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ rerank_tier: "accurate" }),
			);
		});

		it("should filter by valid time end when not including invalidated", async () => {
			const now = Date.now();
			spyOn(Date, "now").mockReturnValue(now);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ vtEndAfter: now }),
			);
		});

		it("should set vtEndAfter to 0 when includeInvalidated is true", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query", includeInvalidated: true });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({ vtEndAfter: 0 }),
			);
		});

		it("should return memories in structured output", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "Test memory content",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({ query: "test query" })) as any;

			expect(result.structuredContent.memories).toHaveLength(1);
			expect(result.structuredContent.memories[0].id).toBe("mem-1");
			expect(result.structuredContent.query).toBe("test query");
			expect(result.structuredContent.count).toBe(1);
		});

		it("should format invalidated memories with strikethrough", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "Outdated content\nWith multiple lines",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					invalidated: true,
					invalidatedAt: 1704067200000,
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({ query: "test query" })) as any;

			expect(result.structuredContent.memories[0].content).toBe(
				"~~Outdated content~~\n~~With multiple lines~~",
			);
		});

		it("should include tenant context when org is available", async () => {
			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({
					project: "test-project",
					orgId: "org-123",
					orgSlug: "my-org",
				}),
				mockElicitationService,
			);

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test query",
				5,
				expect.objectContaining({
					tenant: { orgId: "org-123", orgSlug: "my-org" },
				}),
			);
		});
	});

	describe("disambiguation", () => {
		beforeEach(() => {
			mockElicitationService = {
				enabled: true,
				selectMemory: mock(async () => ({
					accepted: true,
					content: { selectedId: "mem-1" },
				})),
			} as unknown as ElicitationService;

			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
			);
		});

		it("should trigger disambiguation when enabled and multiple similar results", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "First memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-2",
					content: "Second memory",
					score: 0.93,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(mockElicitationService.selectMemory).toHaveBeenCalled();
			expect(result.structuredContent.disambiguated).toBe(true);
			expect(result.structuredContent.selectedId).toBe("mem-1");
			expect(result.structuredContent.memories).toHaveLength(1);
		});

		it("should not disambiguate when scores are not similar", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "First memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-2",
					content: "Second memory",
					score: 0.5, // Much lower score
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(mockElicitationService.selectMemory).not.toHaveBeenCalled();
			expect(result.structuredContent.disambiguated).toBe(false);
		});

		it("should not disambiguate when only one result", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "Only memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(mockElicitationService.selectMemory).not.toHaveBeenCalled();
		});

		it("should return all results when user declines disambiguation", async () => {
			mockElicitationService.selectMemory = mock(async () => ({
				accepted: false,
			}));

			const memories = [
				{
					id: "mem-1",
					content: "First memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-2",
					content: "Second memory",
					score: 0.93,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(result.structuredContent.memories).toHaveLength(2);
			expect(result.structuredContent.disambiguated).toBe(false);
		});

		it("should not disambiguate when elicitation is disabled", async () => {
			mockElicitationService.enabled = false;

			const memories = [
				{
					id: "mem-1",
					content: "First memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-2",
					content: "Second memory",
					score: 0.93,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(mockElicitationService.selectMemory).not.toHaveBeenCalled();
			expect(result.structuredContent.memories).toHaveLength(2);
		});
	});

	describe("community summaries", () => {
		let mockCommunityRetriever: ICommunityRetriever;

		beforeEach(() => {
			mockCommunityRetriever = {
				search: mock(async () => []),
			} as unknown as ICommunityRetriever;

			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
				{ communityRetriever: mockCommunityRetriever },
			);
		});

		it("should include communities in output when available", async () => {
			const communities = [
				{
					id: "comm-1",
					name: "Authentication Cluster",
					summary: "Group of entities related to user authentication and authorization",
					keywords: ["auth", "login", "OAuth"],
					memberCount: 5,
					memoryCount: 12,
					score: 0.85,
				},
			];
			spyOn(mockCommunityRetriever, "search").mockResolvedValue(communities);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ query: "authentication" })) as any;

			expect(mockCommunityRetriever.search).toHaveBeenCalledWith(
				"authentication",
				expect.objectContaining({
					project: "test-project",
					limit: 3,
					threshold: 0.5,
				}),
			);
			expect(result.structuredContent.communities).toHaveLength(1);
			expect(result.structuredContent.communities[0].name).toBe("Authentication Cluster");
			expect(result.structuredContent.communities[0].summary).toBe(
				"Group of entities related to user authentication and authorization",
			);
		});

		it("should not include communities when search returns empty", async () => {
			spyOn(mockCommunityRetriever, "search").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ query: "test query" })) as any;

			expect(result.structuredContent.communities).toBeUndefined();
		});

		it("should respect includeCommunities=false option", async () => {
			spyOn(mockCommunityRetriever, "search").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ query: "test query", includeCommunities: false });

			expect(mockCommunityRetriever.search).not.toHaveBeenCalled();
		});

		it("should use custom communityLimit and communityThreshold", async () => {
			spyOn(mockCommunityRetriever, "search").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({
				query: "test query",
				communityLimit: 5,
				communityThreshold: 0.7,
			});

			expect(mockCommunityRetriever.search).toHaveBeenCalledWith(
				"test query",
				expect.objectContaining({
					limit: 5,
					threshold: 0.7,
				}),
			);
		});

		it("should handle community search failure gracefully", async () => {
			spyOn(mockCommunityRetriever, "search").mockRejectedValue(new Error("Search failed"));
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test memory",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);

			// Suppress console.error for this test
			const consoleError = spyOn(console, "error").mockImplementation(() => {});

			const result = (await registeredHandler({ query: "test query" })) as any;

			expect(result.structuredContent.communities).toBeUndefined();
			expect(result.structuredContent.memories).toHaveLength(1);

			consoleError.mockRestore();
		});

		it("should not search communities when retriever is not provided", async () => {
			// Re-register without community retriever
			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
			);

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler({ query: "test query" })) as any;

			expect(result.structuredContent.communities).toBeUndefined();
		});
	});

	describe("graph expansion", () => {
		let mockGraphExpansion: {
			expand: ReturnType<typeof mock>;
			rerank: ReturnType<typeof mock>;
		};

		beforeEach(() => {
			mockGraphExpansion = {
				expand: mock(async () => []),
				rerank: mock(() => []),
			};

			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
				{ graphExpansion: mockGraphExpansion as any },
			);
		});

		it("should call graph expansion when enabled", async () => {
			const vectorResults = [
				{
					id: "mem-1",
					content: "Test memory",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			];
			const expandedResults = [
				{
					id: "mem-1",
					content: "Test memory",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					source: "vector",
					graphDistance: 0,
				},
				{
					id: "mem-2",
					content: "Graph expanded memory",
					score: 0.7,
					type: "insight",
					created_at: "2024-01-02T00:00:00Z",
					source: "graph",
					graphDistance: 1,
					sourceEntity: "TestEntity",
				},
			];

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(vectorResults);
			spyOn(mockGraphExpansion, "expand").mockResolvedValue(expandedResults);
			spyOn(mockGraphExpansion, "rerank").mockReturnValue(expandedResults);

			const result = (await registeredHandler({
				query: "test query",
				includeEntities: true,
				graphDepth: 2,
			})) as any;

			expect(mockGraphExpansion.expand).toHaveBeenCalledWith("test query", vectorResults, {
				graphDepth: 2,
				maxQueryEntities: 5,
				entityMatchThreshold: 0.7,
				maxMemoriesPerEntity: 10,
			});
			expect(mockGraphExpansion.rerank).toHaveBeenCalledWith(expandedResults);
			expect(result.structuredContent.graphExpanded).toBe(true);
			expect(result.structuredContent.memories).toHaveLength(2);
		});

		it("should double the limit for vector search when graph expansion is enabled", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockGraphExpansion, "expand").mockResolvedValue([]);
			spyOn(mockGraphExpansion, "rerank").mockReturnValue([]);

			await registeredHandler({
				query: "test query",
				limit: 5,
				includeEntities: true,
				graphDepth: 2,
			});

			// Should request 10 (2x the limit) from vector search
			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith("test query", 10, expect.any(Object));
		});

		it("should include graph metadata in expanded results", async () => {
			const expandedResults = [
				{
					id: "mem-1",
					content: "Graph memory",
					score: 0.8,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					source: "graph",
					graphDistance: 2,
					sourceEntity: "AuthEntity",
					invalidated: false,
					invalidatedAt: undefined,
					replacedBy: null,
				},
			];

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockGraphExpansion, "expand").mockResolvedValue(expandedResults);
			spyOn(mockGraphExpansion, "rerank").mockReturnValue(expandedResults);

			const result = (await registeredHandler({
				query: "auth query",
				includeEntities: true,
			})) as any;

			expect(result.structuredContent.memories[0].source).toBe("graph");
			expect(result.structuredContent.memories[0].graphDistance).toBe(2);
			expect(result.structuredContent.memories[0].sourceEntity).toBe("AuthEntity");
		});

		it("should not expand when graphDepth is 0", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);

			const result = (await registeredHandler({
				query: "test query",
				graphDepth: 0,
			})) as any;

			expect(mockGraphExpansion.expand).not.toHaveBeenCalled();
			expect(result.structuredContent.graphExpanded).toBe(false);
		});

		it("should not expand when includeEntities is false", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);

			const result = (await registeredHandler({
				query: "test query",
				includeEntities: false,
			})) as any;

			expect(mockGraphExpansion.expand).not.toHaveBeenCalled();
			expect(result.structuredContent.graphExpanded).toBe(false);
		});
	});

	describe("graph reranking", () => {
		let mockGraphReranker: {
			rerank: ReturnType<typeof mock>;
			updateConfig: ReturnType<typeof mock>;
		};

		beforeEach(() => {
			mockGraphReranker = {
				rerank: mock(async () => []),
				updateConfig: mock(() => {}),
			};

			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
				{ graphReranker: mockGraphReranker as any },
			);
		});

		it("should apply graph reranking when enabled", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "Memory 1",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-2",
					content: "Memory 2",
					score: 0.8,
					type: "insight",
					created_at: "2024-01-02T00:00:00Z",
				},
			];
			const rerankedResults = [
				{
					id: "mem-2",
					content: "Memory 2",
					score: 0.95,
					type: "insight",
					created_at: "2024-01-02T00:00:00Z",
					source: "graph",
					graphDistance: 1,
					graphScore: 0.8,
					connectingEntities: ["entity-1"],
				},
				{
					id: "mem-1",
					content: "Memory 1",
					score: 0.85,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					source: "vector",
				},
			];

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);
			spyOn(mockGraphReranker, "rerank").mockResolvedValue(rerankedResults);

			const result = (await registeredHandler({
				query: "test query",
				graphRerank: true,
			})) as any;

			expect(mockGraphReranker.rerank).toHaveBeenCalledWith("test query", memories, "test-project");
			expect(result.structuredContent.graphReranked).toBe(true);
			expect(result.structuredContent.memories[0].graphScore).toBe(0.8);
			expect(result.structuredContent.memories[0].connectingEntities).toEqual(["entity-1"]);
		});

		it("should update graph weight when specified", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);
			spyOn(mockGraphReranker, "rerank").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					source: "vector",
				},
			]);

			await registeredHandler({
				query: "test query",
				graphRerank: true,
				graphWeight: 0.5,
			});

			expect(mockGraphReranker.updateConfig).toHaveBeenCalledWith({ graphWeight: 0.5 });
		});

		it("should not rerank when graphRerank is false", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);

			const result = (await registeredHandler({
				query: "test query",
				graphRerank: false,
			})) as any;

			expect(mockGraphReranker.rerank).not.toHaveBeenCalled();
			expect(result.structuredContent.graphReranked).toBe(false);
		});

		it("should handle graph reranking failure gracefully", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test memory",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);
			spyOn(mockGraphReranker, "rerank").mockRejectedValue(new Error("Reranking failed"));

			// Suppress console.error for this test
			const consoleError = spyOn(console, "error").mockImplementation(() => {});

			const result = (await registeredHandler({
				query: "test query",
				graphRerank: true,
			})) as any;

			// Should still return results without graph reranking
			expect(result.structuredContent.memories).toHaveLength(1);
			expect(result.structuredContent.graphReranked).toBe(false);
			expect(consoleError).toHaveBeenCalled();

			consoleError.mockRestore();
		});

		it("should use filter project when available instead of context project", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
			]);
			spyOn(mockGraphReranker, "rerank").mockResolvedValue([
				{
					id: "mem-1",
					content: "Test",
					score: 0.9,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					source: "vector",
				},
			]);

			await registeredHandler({
				query: "test query",
				graphRerank: true,
				filters: { project: "filter-project" },
			});

			expect(mockGraphReranker.rerank).toHaveBeenCalledWith(
				"test query",
				expect.any(Array),
				"filter-project",
			);
		});
	});

	describe("disambiguation with invalidated memories", () => {
		beforeEach(() => {
			mockElicitationService = {
				enabled: true,
				selectMemory: mock(async () => ({
					accepted: true,
					content: { selectedId: "mem-invalidated" },
				})),
			} as unknown as ElicitationService;

			registerRecallTool(
				mockServer,
				mockMemoryRetriever,
				() => ({ project: "test-project" }),
				mockElicitationService,
			);
		});

		it("should format invalidated memory with strikethrough when selected via disambiguation", async () => {
			const memories = [
				{
					id: "mem-valid",
					content: "Valid memory",
					score: 0.95,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
				},
				{
					id: "mem-invalidated",
					content: "Outdated content\nWith multiple lines",
					score: 0.93,
					type: "decision",
					created_at: "2024-01-01T00:00:00Z",
					invalidated: true,
					invalidatedAt: 1704067200000,
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({
				query: "test query",
				disambiguate: true,
			})) as any;

			expect(result.structuredContent.disambiguated).toBe(true);
			expect(result.structuredContent.selectedId).toBe("mem-invalidated");
			expect(result.structuredContent.memories).toHaveLength(1);
			expect(result.structuredContent.memories[0].content).toBe(
				"~~Outdated content~~\n~~With multiple lines~~",
			);
		});
	});
});
