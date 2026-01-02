import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient } from "../services/interfaces";
import { registerSessionResource } from "./session";

describe("registerSessionResource", () => {
	let mockServer: McpServer;
	let mockClient: IEngramClient;
	let transcriptReadHandler: (uri: URL, params: Record<string, unknown>) => Promise<unknown>;
	let summaryReadHandler: (uri: URL, params: Record<string, unknown>) => Promise<unknown>;

	beforeEach(() => {
		mockServer = {
			registerResource: mock((name, template, options, handler) => {
				if (name === "session-transcript") {
					transcriptReadHandler = handler;
				} else if (name === "session-summary") {
					summaryReadHandler = handler;
				}
			}),
		} as unknown as McpServer;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;
	});

	describe("registration", () => {
		it("should register both transcript and summary resources", () => {
			registerSessionResource(mockServer, mockClient, () => ({}));

			expect(mockServer.registerResource).toHaveBeenCalledTimes(2);
			expect(mockServer.registerResource).toHaveBeenCalledWith(
				"session-transcript",
				expect.any(Object),
				expect.objectContaining({ title: "Session Transcript" }),
				expect.any(Function),
			);
			expect(mockServer.registerResource).toHaveBeenCalledWith(
				"session-summary",
				expect.any(Object),
				expect.objectContaining({ title: "Session Summary" }),
				expect.any(Function),
			);
		});
	});

	describe("transcript read handler", () => {
		beforeEach(() => {
			registerSessionResource(mockServer, mockClient, () => ({}));
		});

		it("should query for session and turns", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-123",
								title: "Test Session",
								agent_type: "claude-code",
								working_dir: "/projects",
								started_at: 1704067200000,
								summary: null,
							},
						},
					},
				])
				.mockResolvedValueOnce([]);

			const uri = new URL("session://session-123/transcript");
			await transcriptReadHandler(uri, { session_id: "session-123" });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("Session {id: $sessionId}"),
				expect.objectContaining({ sessionId: "session-123" }),
			);
		});

		it("should return transcript with turns", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "session-123",
								title: "Test Session",
								agent_type: "claude-code",
								working_dir: "/projects",
								started_at: 1704067200000,
								summary: "Implemented auth",
							},
						},
					},
				])
				.mockResolvedValueOnce([
					{
						t: {
							properties: {
								sequence_index: 1,
								user_content: "Hello",
								assistant_preview: "Hi there!",
								tool_calls_count: 0,
								files_touched: [],
							},
						},
					},
					{
						t: {
							properties: {
								sequence_index: 2,
								user_content: "Fix the bug",
								assistant_preview: "I'll look into that",
								tool_calls_count: 3,
								files_touched: ["/src/auth.ts"],
							},
						},
					},
				]);

			const uri = new URL("session://session-123/transcript");
			const result = (await transcriptReadHandler(uri, {
				session_id: "session-123",
			})) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.id).toBe("session-123");
			expect(parsed.turns).toHaveLength(2);
			expect(parsed.turns[0].sequence).toBe(1);
			expect(parsed.turns[1].files_touched).toContain("/src/auth.ts");
		});

		it("should handle 'latest' as session_id", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "latest-session-456" }]) // Latest query
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "latest-session-456",
								title: "Latest",
								agent_type: "claude-code",
								started_at: 1704067200000,
							},
						},
					},
				])
				.mockResolvedValueOnce([]);

			const uri = new URL("session://latest/transcript");
			const result = (await transcriptReadHandler(uri, { session_id: "latest" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.id).toBe("latest-session-456");
		});

		it("should return error when session not found", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const uri = new URL("session://nonexistent/transcript");
			const result = (await transcriptReadHandler(uri, {
				session_id: "nonexistent",
			})) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.error).toContain("Session not found");
		});

		it("should return error when no latest session found", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const uri = new URL("session://latest/transcript");
			const result = (await transcriptReadHandler(uri, { session_id: "latest" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.error).toContain("No sessions found");
		});
	});

	describe("summary read handler", () => {
		beforeEach(() => {
			registerSessionResource(mockServer, mockClient, () => ({}));
		});

		it("should return session summary with turn count", async () => {
			spyOn(mockClient, "query").mockResolvedValue([
				{
					s: {
						properties: {
							id: "session-123",
							title: "Test Session",
							agent_type: "claude-code",
							working_dir: "/projects",
							started_at: 1704067200000,
							summary: "Implemented auth feature",
						},
					},
					turn_count: 15,
				},
			]);

			const uri = new URL("session://session-123/summary");
			const result = (await summaryReadHandler(uri, { session_id: "session-123" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.id).toBe("session-123");
			expect(parsed.turn_count).toBe(15);
			expect(parsed.summary).toBe("Implemented auth feature");
		});

		it("should handle 'latest' for summary", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "latest-session" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "latest-session",
								title: "Latest",
								agent_type: "claude-code",
								started_at: 1704067200000,
							},
						},
						turn_count: 5,
					},
				]);

			const uri = new URL("session://latest/summary");
			const result = (await summaryReadHandler(uri, { session_id: "latest" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.id).toBe("latest-session");
		});

		it("should return error when session not found", async () => {
			spyOn(mockClient, "query").mockResolvedValue([]);

			const uri = new URL("session://nonexistent/summary");
			const result = (await summaryReadHandler(uri, {
				session_id: "nonexistent",
			})) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.error).toContain("Session not found");
		});
	});

	describe("project context", () => {
		it("should filter latest session by project", async () => {
			registerSessionResource(mockServer, mockClient, () => ({
				project: "engram",
			}));

			spyOn(mockClient, "query")
				.mockResolvedValueOnce([{ "s.id": "project-session" }])
				.mockResolvedValueOnce([
					{
						s: {
							properties: {
								id: "project-session",
								title: "Project Session",
								agent_type: "claude-code",
								started_at: 1704067200000,
							},
						},
					},
				])
				.mockResolvedValueOnce([]);

			const uri = new URL("session://latest/transcript");
			await transcriptReadHandler(uri, { session_id: "latest" });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("CONTAINS $project"),
				expect.objectContaining({ project: "engram" }),
			);
		});
	});
});
