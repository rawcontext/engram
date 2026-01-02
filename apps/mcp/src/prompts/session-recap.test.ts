import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient } from "../services/interfaces";
import { registerRecapPrompt } from "./session-recap";

describe("registerRecapPrompt", () => {
	let mockServer: McpServer;
	let mockClient: IEngramClient;
	let registeredHandler: () => Promise<{ messages: unknown[] }>;

	beforeEach(() => {
		mockServer = {
			registerPrompt: mock((name, options, handler) => {
				registeredHandler = handler;
			}),
		} as unknown as McpServer;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;
	});

	describe("registration", () => {
		it("should register the session-recap prompt with correct name", () => {
			registerRecapPrompt(mockServer, mockClient, () => ({}));

			expect(mockServer.registerPrompt).toHaveBeenCalledWith(
				"session-recap",
				expect.objectContaining({
					description: expect.stringContaining("Review what happened"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("handler", () => {
		beforeEach(() => {
			registerRecapPrompt(mockServer, mockClient, () => ({
				project: "test-project",
			}));
		});

		it("should return no sessions found message when none exist", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const result = (await registeredHandler()) as any;

			expect(result.messages).toHaveLength(1);
			expect(result.messages[0].content.text).toContain("No sessions found");
		});

		it("should query for latest session with project filter", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			await registeredHandler();

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("s.working_dir CONTAINS $project"),
				expect.objectContaining({ project: "test-project" }),
			);
		});

		it("should return session not found when transcript fails", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-123" }]) // Latest session
				.mockResolvedValueOnce([]); // Session not found

			const result = (await registeredHandler()) as any;

			expect(result.messages[0].content.text).toContain("Session not found");
		});

		it("should format session transcript with summary when available", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-abc" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-abc",
								title: "Bug Fix Session",
								agent_type: "claude-code",
								working_dir: "/projects/test-project",
								started_at: 1704067200000, // 2024-01-01
								summary: "Fixed critical authentication bug",
							},
						},
					},
				])
				.mockResolvedValueOnce([]); // No turns

			const result = (await registeredHandler()) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Bug Fix Session");
			expect(text).toContain("claude-code");
			expect(text).toContain("Fixed critical authentication bug");
		});

		it("should format turns when no summary available", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-xyz" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-xyz",
								agent_type: "claude-code",
								working_dir: "/projects/test",
								started_at: 1704067200000,
							},
						},
					},
				])
				.mockResolvedValueOnce([
					{
						t: {
							properties: {
								sequence_index: 1,
								user_content: "Fix the login bug",
								assistant_preview: "I'll investigate the login issue",
								tool_calls_count: 5,
								files_touched: ["/src/auth.ts", "/src/login.ts"],
							},
						},
					},
					{
						t: {
							properties: {
								sequence_index: 2,
								user_content: "Deploy to staging",
								assistant_preview: "Deploying changes to staging environment",
								tool_calls_count: 2,
								files_touched: [],
							},
						},
					},
				]);

			const result = (await registeredHandler()) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Turn 1");
			expect(text).toContain("Turn 2");
			expect(text).toContain("5 tool calls");
			expect(text).toContain("/src/auth.ts");
			expect(text).toContain("Fix the login bug");
		});

		it("should truncate long user content", async () => {
			const longContent = "a".repeat(300);
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-1" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-1",
								agent_type: "test",
								started_at: 1704067200000,
							},
						},
					},
				])
				.mockResolvedValueOnce([
					{
						t: {
							properties: {
								sequence_index: 1,
								user_content: longContent,
								assistant_preview: "Short response",
								tool_calls_count: 0,
								files_touched: [],
							},
						},
					},
				]);

			const result = (await registeredHandler()) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("...");
			expect(text).not.toContain(longContent);
		});

		it("should include summary instructions", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-1" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-1",
								agent_type: "claude-code",
								started_at: 1704067200000,
								summary: "Did some work",
							},
						},
					},
				])
				.mockResolvedValueOnce([]);

			const result = (await registeredHandler()) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Please provide a summary");
			expect(text).toContain("Main objectives");
			expect(text).toContain("Key decisions");
			expect(text).toContain("unfinished work");
		});

		it("should show turn count in header", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "session-1" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-1",
								agent_type: "claude-code",
								started_at: 1704067200000,
							},
						},
					},
				])
				.mockResolvedValueOnce([
					{
						t: {
							properties: {
								sequence_index: 1,
								user_content: "Turn 1",
								assistant_preview: "Response 1",
								tool_calls_count: 0,
								files_touched: [],
							},
						},
					},
					{
						t: {
							properties: {
								sequence_index: 2,
								user_content: "Turn 2",
								assistant_preview: "Response 2",
								tool_calls_count: 0,
								files_touched: [],
							},
						},
					},
				]);

			const result = (await registeredHandler()) as any;
			const text = result.messages[0].content.text;

			expect(text).toContain("Turns**: 2");
		});
	});

	describe("without project context", () => {
		it("should query for any session when no project", async () => {
			registerRecapPrompt(mockServer, mockClient, () => ({}));
			spyOn(mockClient, "query").mockResolvedValue([]);

			await registeredHandler();

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.not.stringContaining("CONTAINS $project"),
				expect.objectContaining({ now: expect.any(Number) }),
			);
		});
	});
});
