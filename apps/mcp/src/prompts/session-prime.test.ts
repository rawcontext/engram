import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient, IMemoryRetriever } from "../services/interfaces";
import { registerPrimePrompt } from "./session-prime";

describe("registerPrimePrompt", () => {
	let mockServer: McpServer;
	let mockMemoryRetriever: IMemoryRetriever;
	let mockClient: IEngramClient;
	let registeredHandler: () => Promise<{ messages: unknown[] }>;

	beforeEach(() => {
		mockServer = {
			registerPrompt: mock((_name, _options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockMemoryRetriever = {
			recall: mock(async () => []),
		} as unknown as IMemoryRetriever;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;
	});

	describe("registration", () => {
		it("should register the session-prime prompt with correct name", () => {
			registerPrimePrompt(mockServer, mockMemoryRetriever, mockClient, () => ({}));

			expect(mockServer.registerPrompt).toHaveBeenCalledWith(
				"session-prime",
				expect.objectContaining({
					description: expect.stringContaining("Initialize a work session"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerPrimePrompt(mockServer, mockMemoryRetriever, mockClient, () => ({
				project: "test-project",
				workingDir: "/projects/test",
			}));
		});

		it("should return a message with session context header", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = await registeredHandler();

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0]).toEqual({
				role: "user",
				content: {
					type: "text",
					text: expect.stringContaining("Session Context"),
				},
			});
		});

		it("should include project info in header", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("test-project");
		});

		it("should include directory info in header", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("/projects/test");
		});

		it("should search for decisions", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler();

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				expect.stringContaining("decisions"),
				5,
				expect.objectContaining({ type: "decision" }),
			);
		});

		it("should search for insights", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler();

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				expect.stringContaining("debugging"),
				3,
				expect.objectContaining({ type: "insight" }),
			);
		});

		it("should search for preferences", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			await registeredHandler();

			expect(mockMemoryRetriever.recall).toHaveBeenCalledWith(
				expect.stringContaining("preferences"),
				3,
				expect.objectContaining({ type: "preference" }),
			);
		});

		it("should include recent sessions in output", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						id: "session-123",
						summary: "Fixed authentication bug",
						started_at: Date.now() - 3600000, // 1 hour ago
						agent_type: "claude-code",
					},
				])
				.mockResolvedValueOnce([]); // Hot files query

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Recent Sessions");
			expect(result.messages[0].content.text).toContain("Fixed authentication bug");
		});

		it("should include decisions in output", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([
					{ id: "d1", content: "Use PostgreSQL for persistence", score: 0.9, type: "decision" },
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Active Decisions");
			expect(result.messages[0].content.text).toContain("Use PostgreSQL for persistence");
		});

		it("should include insights in output", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{
						id: "i1",
						content: "Race condition in async handler",
						score: 0.85,
						type: "insight",
					},
				])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Recent Insights");
			expect(result.messages[0].content.text).toContain("Race condition in async handler");
		});

		it("should include preferences in output", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall")
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{ id: "p1", content: "Use tabs for indentation", score: 0.95, type: "preference" },
				]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Your Preferences");
			expect(result.messages[0].content.text).toContain("Use tabs for indentation");
		});

		it("should include hot files in output", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([]) // Sessions query
				.mockResolvedValueOnce([
					{ path: "/src/auth.ts", touchCount: 5, lastAction: "edit" },
					{ path: "/src/api.ts", touchCount: 3, lastAction: "read" },
				]);

			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Hot Files");
			expect(result.messages[0].content.text).toContain("/src/auth.ts");
			expect(result.messages[0].content.text).toContain("5 touches");
		});

		it("should show fallback message when no context found", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("No context found in memory yet");
		});

		it("should handle graph query errors gracefully", async () => {
			spyOn(mockClient, "query").mockRejectedValue(new Error("Connection failed"));
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			// Should not throw
			const result = (await registeredHandler()) as any;

			expect(result.messages).toHaveLength(1);
		});

		it("should end with ready prompt", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);
			spyOn(mockMemoryRetriever, "recall").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Ready to work");
		});
	});
});
