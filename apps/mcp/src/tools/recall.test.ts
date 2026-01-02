import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitationService } from "../capabilities";
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
			registerTool: mock((name, options, handler) => {
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
});
