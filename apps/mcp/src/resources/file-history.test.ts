import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient } from "../services/interfaces";
import { registerFileHistoryResource } from "./file-history";

describe("registerFileHistoryResource", () => {
	let mockServer: McpServer;
	let mockClient: IEngramClient;
	let registeredReadHandler: (uri: URL, params: Record<string, unknown>) => Promise<unknown>;

	beforeEach(() => {
		mockServer = {
			registerResource: mock((_name, _template, _options, handler) => {
				registeredReadHandler = handler;
			}),
		} as unknown as McpServer;

		mockClient = {
			query: mock(async () => []),
		} as unknown as IEngramClient;
	});

	describe("registration", () => {
		it("should register the file-history resource with correct name", () => {
			registerFileHistoryResource(mockServer, mockClient);

			expect(mockServer.registerResource).toHaveBeenCalledWith(
				"file-history",
				expect.any(Object),
				expect.objectContaining({
					title: "File History",
					description: expect.stringContaining("History of changes"),
				}),
				expect.any(Function),
			);
		});
	});

	describe("read handler", () => {
		beforeEach(() => {
			registerFileHistoryResource(mockServer, mockClient);
		});

		it("should query for file touches by path", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([]) // File touches query
				.mockResolvedValueOnce([{ total: 0 }]); // Count query

			const uri = new URL("file-history:///src/auth.ts");
			await registeredReadHandler(uri, { path: "/src/auth.ts" });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.stringContaining("FileTouch {file_path: $filePath}"),
				expect.objectContaining({ filePath: "/src/auth.ts" }),
			);
		});

		it("should decode URL-encoded paths", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ total: 0 }]);

			const encodedPath = encodeURIComponent("/src/path with spaces.ts");
			const uri = new URL(`file-history://${encodedPath}`);
			await registeredReadHandler(uri, { path: encodedPath });

			expect(mockClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ filePath: "/src/path with spaces.ts" }),
			);
		});

		it("should return file history as JSON", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						ft: {
							properties: {
								action: "edit",
								diff_preview: "Added auth logic",
								lines_added: 10,
								lines_removed: 2,
								vt_start: 1704067200000,
							},
						},
						s: {
							properties: {
								id: "session-123",
								started_at: 1704067200000,
								agent_type: "claude-code",
							},
						},
					},
				])
				.mockResolvedValueOnce([{ total: 1 }]);

			const uri = new URL("file-history:///src/auth.ts");
			const result = (await registeredReadHandler(uri, { path: "/src/auth.ts" })) as any;

			expect(result.contents).toHaveLength(1);
			expect(result.contents[0].mimeType).toBe("application/json");

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.path).toBe("/src/auth.ts");
			expect(parsed.history).toHaveLength(1);
			expect(parsed.history[0].action).toBe("edit");
			expect(parsed.history[0].session_id).toBe("session-123");
			expect(parsed.history[0].diff_preview).toBe("Added auth logic");
			expect(parsed.total_touches).toBe(1);
		});

		it("should handle entries without session", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						ft: {
							properties: {
								action: "read",
								vt_start: 1704067200000,
							},
						},
						s: null, // No session linked
					},
				])
				.mockResolvedValueOnce([{ total: 1 }]);

			const uri = new URL("file-history:///src/auth.ts");
			const result = (await registeredReadHandler(uri, { path: "/src/auth.ts" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.history[0].session_id).toBeUndefined();
			expect(parsed.history[0].session_date).toBeUndefined();
		});

		it("should return empty history when no touches found", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ total: 0 }]);

			const uri = new URL("file-history:///nonexistent.ts");
			const result = (await registeredReadHandler(uri, { path: "/nonexistent.ts" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.history).toEqual([]);
			expect(parsed.total_touches).toBe(0);
		});

		it("should include lines added and removed", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						ft: {
							properties: {
								action: "edit",
								lines_added: 50,
								lines_removed: 10,
								vt_start: 1704067200000,
							},
						},
						s: null,
					},
				])
				.mockResolvedValueOnce([{ total: 1 }]);

			const uri = new URL("file-history:///src/auth.ts");
			const result = (await registeredReadHandler(uri, { path: "/src/auth.ts" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.history[0].lines_added).toBe(50);
			expect(parsed.history[0].lines_removed).toBe(10);
		});

		it("should include agent type from session", async () => {
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						ft: {
							properties: {
								action: "create",
								vt_start: 1704067200000,
							},
						},
						s: {
							properties: {
								id: "session-456",
								started_at: 1704067200000,
								agent_type: "openai-gpt",
							},
						},
					},
				])
				.mockResolvedValueOnce([{ total: 1 }]);

			const uri = new URL("file-history:///src/new-file.ts");
			const result = (await registeredReadHandler(uri, { path: "/src/new-file.ts" })) as any;

			const parsed = JSON.parse(result.contents[0].text);
			expect(parsed.history[0].agent_type).toBe("openai-gpt");
		});
	});
});
