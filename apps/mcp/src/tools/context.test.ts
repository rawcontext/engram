import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingService } from "../capabilities";
import type { IEngramClient, IMemoryRetriever } from "../services/interfaces";
import { registerContextTool } from "./context";

describe("registerContextTool", () => {
	let mockServer: McpServer;
	let mockMemoryRetriever: IMemoryRetriever;
	let mockClient: IEngramClient;
	let mockSamplingService: SamplingService;
	let registeredHandler: (args: Record<string, unknown>) => Promise<unknown>;

	beforeEach(() => {
		mockServer = {
			registerTool: mock((name, options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockMemoryRetriever = {
			recall: mock(async () => []),
		} as unknown as IMemoryRetriever;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;

		mockSamplingService = {
			enabled: false,
			summarize: mock(async () => null),
		} as unknown as SamplingService;
	});

	describe("registration", () => {
		it("should register the context tool with correct name", () => {
			registerContextTool(mockServer, mockMemoryRetriever, mockClient, () => ({}));

			expect(mockServer.registerTool).toHaveBeenCalledWith(
				"context",
				expect.objectContaining({
					title: "Get Context",
					description: expect.stringContaining("Assemble comprehensive context"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler - basic functionality", () => {
		beforeEach(() => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should search for memories based on task", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ task: "implement authentication" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"implement authentication",
				expect.any(Number),
				expect.objectContaining({ project: "test-project" }),
			);
		});

		it("should search for related decisions", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ task: "implement authentication" });

			// Should also search for decisions
			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"decisions about implement authentication",
				3,
				expect.objectContaining({ type: "decision" }),
			);
		});

		it("should return memories in context", async () => {
			const memories = [
				{
					id: "mem-1",
					content: "Auth decision content",
					score: 0.9,
					type: "decision",
				},
			];
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue(memories);

			const result = (await registeredHandler({ task: "implement auth" })) as any;

			expect(result.structuredContent.context).toContainEqual(
				expect.objectContaining({
					type: "decision",
					content: "Auth decision content",
					source: "memory:mem-1",
				}),
			);
		});
	});

	describe("handler - depth levels", () => {
		beforeEach(() => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should use shallow limits when depth is shallow", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ task: "test task", depth: "shallow" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test task",
				3, // shallow memory limit
				expect.any(Object),
			);
		});

		it("should use medium limits by default", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ task: "test task" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test task",
				5, // medium memory limit
				expect.any(Object),
			);
		});

		it("should use deep limits when depth is deep", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler({ task: "test task", depth: "deep" });

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				"test task",
				10, // deep memory limit
				expect.any(Object),
			);
		});
	});

	describe("handler - file history", () => {
		beforeEach(() => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should query file history when files are provided", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockClient, "query").mockResolvedValue([]);

			await registeredHandler({
				task: "test task",
				files: ["/src/auth.ts"],
			});

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("FileTouch"),
				expect.objectContaining({ filePath: "/src/auth.ts" }),
				undefined,
			);
		});

		it("should add file history to context", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockClient, "query").mockResolvedValue([
				{
					ft: {
						properties: {
							action: "edit",
							diff_preview: "Added authentication logic",
						},
					},
				},
			]);

			const result = (await registeredHandler({
				task: "test task",
				files: ["/src/auth.ts"],
			})) as any;

			expect(result.structuredContent.context).toContainEqual(
				expect.objectContaining({
					type: "file_history",
					source: "file:/src/auth.ts",
				}),
			);
		});

		it("should limit files based on depth", async () => {
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockClient, "query").mockResolvedValue([]);

			const manyFiles = [
				"/src/file1.ts",
				"/src/file2.ts",
				"/src/file3.ts",
				"/src/file4.ts",
				"/src/file5.ts",
				"/src/file6.ts",
			];

			await registeredHandler({
				task: "test task",
				files: manyFiles,
				depth: "shallow", // Only 2 files
			});

			// Should only query first 2 files
			expect(mockClient.query).toHaveBeenCalledTimes(2);
		});
	});

	describe("handler - deduplication", () => {
		beforeEach(() => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should not duplicate memories found in both searches", async () => {
			const sharedMemory = {
				id: "mem-shared",
				content: "Shared content",
				score: 0.9,
				type: "decision",
			};

			// First call returns the memory, second call (decisions) returns the same memory
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([sharedMemory])
				.mockResolvedValueOnce([sharedMemory]);

			const result = (await registeredHandler({ task: "test task" })) as any;

			// Should only appear once
			const memoryOccurrences = result.structuredContent.context.filter(
				(c: any) => c.source === "memory:mem-shared",
			);
			expect(memoryOccurrences).toHaveLength(1);
		});
	});

	describe("handler - sorting", () => {
		beforeEach(() => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should sort context by relevance descending", async () => {
			const memories = [
				{ id: "mem-1", content: "Low relevance", score: 0.5, type: "context" },
				{ id: "mem-2", content: "High relevance", score: 0.95, type: "context" },
				{ id: "mem-3", content: "Medium relevance", score: 0.75, type: "context" },
			];
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce(memories)
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ task: "test task" })) as any;

			const relevances = result.structuredContent.context.map((c: any) => c.relevance);
			expect(relevances).toEqual([...relevances].sort((a, b) => b - a));
		});
	});

	describe("handler - sampling integration", () => {
		beforeEach(() => {
			mockSamplingService = {
				enabled: true,
				summarize: mock(async () => "Summarized context for task"),
			} as unknown as SamplingService;

			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({ project: "test-project" }),
				mockSamplingService,
			);
		});

		it("should generate summary when sampling enabled and enough context", async () => {
			const memories = [
				{ id: "mem-1", content: "Memory 1", score: 0.9, type: "decision" },
				{ id: "mem-2", content: "Memory 2", score: 0.85, type: "insight" },
				{ id: "mem-3", content: "Memory 3", score: 0.8, type: "fact" },
				{ id: "mem-4", content: "Memory 4", score: 0.75, type: "context" },
			];
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce(memories)
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ task: "test task" })) as any;

			expect(mockSamplingService.summarize).toHaveBeenCalled();
			expect(result.structuredContent.summary).toBe("Summarized context for task");
		});

		it("should not summarize when context is small", async () => {
			const memories = [{ id: "mem-1", content: "Memory 1", score: 0.9, type: "decision" }];
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce(memories)
				.mockResolvedValueOnce([]);

			await registeredHandler({ task: "test task" });

			expect(mockSamplingService.summarize).not.toHaveBeenCalled();
		});

		it("should provide fallback summary when sampling returns null", async () => {
			mockSamplingService.summarize = mock(async () => null);

			const memories = [
				{ id: "mem-1", content: "Memory 1", score: 0.9, type: "decision" },
				{ id: "mem-2", content: "Memory 2", score: 0.85, type: "insight" },
				{ id: "mem-3", content: "Memory 3", score: 0.8, type: "fact" },
				{ id: "mem-4", content: "Memory 4", score: 0.75, type: "context" },
			];
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce(memories)
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler({ task: "test task" })) as any;

			expect(result.structuredContent.summary).toContain("relevant context items");
		});
	});

	describe("handler - tenant context", () => {
		it("should include tenant when org is available", async () => {
			registerContextTool(
				mockServer,
				mockMemoryRetriever,
				mockClient,
				() => ({
					project: "test-project",
					orgId: "org-123",
					orgSlug: "my-org",
				}),
				mockSamplingService,
			);

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);
			spyOn(mockClient, "query").mockResolvedValue([]);

			await registeredHandler({
				task: "test task",
				files: ["/src/auth.ts"],
			});

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Number),
				expect.objectContaining({
					tenant: { orgId: "org-123", orgSlug: "my-org" },
				}),
			);

			expect(mockClient.query).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
				orgId: "org-123",
				orgSlug: "my-org",
			});
		});
	});
});
