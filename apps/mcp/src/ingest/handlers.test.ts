import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createTestGraphClient, createTestLogger } from "@engram/common/testing";
import {
	handleIngestEvent,
	handlePromptIngest,
	handleSessionIngest,
	handleToolIngest,
	type IngestHandlerDeps,
} from "./handlers";

// Mock dependencies with properly typed factories
const mockMemoryStore = {
	createMemory: mock(),
};

const mockGraphClient = createTestGraphClient();
const mockLogger = createTestLogger();

const deps: IngestHandlerDeps = {
	memoryStore: mockMemoryStore as IngestHandlerDeps["memoryStore"],
	graphClient: mockGraphClient,
	logger: mockLogger,
};

/**
 * Mock Hono context for testing handlers.
 */
interface MockContext {
	req: {
		json: ReturnType<typeof mock>;
	};
	json: ReturnType<typeof mock>;
}

// Helper to create test context
function createTestContext(body: unknown): MockContext {
	return {
		req: {
			json: mock().mockResolvedValue(body),
		},
		json: mock((data: unknown, status?: number) => ({ data, status: status ?? 200 })),
	};
}

describe("Ingest Handlers", () => {
	beforeEach(() => {});

	afterEach(() => {});

	describe("handleIngestEvent", () => {
		it("should accept valid tool_call event", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					tool_input: { path: "/test/file.ts" },
					status: "success",
				},
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.data.status).toBe("accepted");
			expect(result.data.session_id).toBe("session-123");
		});

		it("should accept valid prompt event", async () => {
			const c = createTestContext({
				client: "cursor",
				session_id: "session-456",
				event_type: "prompt",
				timestamp: new Date().toISOString(),
				data: {
					content: "Help me fix this bug",
				},
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.data.status).toBe("accepted");
		});

		it("should accept valid session_start event", async () => {
			const c = createTestContext({
				client: "codex",
				session_id: "session-789",
				event_type: "session_start",
				timestamp: new Date().toISOString(),
				data: {},
				context: {
					working_dir: "/Users/test/project",
					git_remote: "github.com/test/project",
				},
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.data.status).toBe("accepted");
			expect(mockGraphClient.query).toHaveBeenCalled();
		});

		it("should reject invalid event format", async () => {
			const c = createTestContext({
				// Missing required fields
				client: "test",
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.status).toBe(400);
			expect(result.data.error).toBe("Invalid event format");
		});

		it("should reject invalid event_type", async () => {
			const c = createTestContext({
				client: "test",
				session_id: "test",
				event_type: "invalid_type",
				timestamp: new Date().toISOString(),
				data: {},
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.status).toBe(400);
		});

		it("should accept valid response event", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-456",
				event_type: "response",
				timestamp: new Date().toISOString(),
				data: {
					content: "Here is the fix",
				},
			});

			const result = await handleIngestEvent(c, deps);

			expect(result.data.status).toBe("accepted");
		});

		it("should handle processing errors gracefully", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
				},
			});

			mockGraphClient.query.mockRejectedValueOnce(new Error("Database error"));

			const result = await handleIngestEvent(c, deps);

			expect(result.status).toBe(500);
			expect(result.data.error).toBe("Processing failed");
		});

		it("should handle non-string tool_name in data", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: 123, // non-string
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ toolName: "unknown" }),
			);
		});

		it("should handle non-object tool_input", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					tool_input: "not an object", // invalid type
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ argsJson: "{}" }),
			);
		});

		it("should handle array tool_input", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					tool_input: ["array", "values"], // array, not object
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ argsJson: "{}" }),
			);
		});

		it("should handle non-string tool_output", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					tool_output: { result: "object" }, // non-string
				},
			});

			await handleIngestEvent(c, deps);

			// Should be called but tool_output undefined
			expect(mockGraphClient.query).toHaveBeenCalled();
		});

		it("should handle valid string tool_output", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					tool_output: "File contents here", // valid string
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalled();
		});

		it("should handle invalid status value", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "tool_call",
				timestamp: new Date().toISOString(),
				data: {
					tool_name: "Read",
					status: "invalid", // not success or error
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ status: "success" }), // defaults to success
			);
		});

		it("should handle non-string prompt content", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "prompt",
				timestamp: new Date().toISOString(),
				data: {
					content: 123, // non-string
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockMemoryStore.createMemory).toHaveBeenCalledWith(
				expect.objectContaining({ content: "" }),
			);
		});

		it("should handle non-string session summary", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "session_end",
				timestamp: new Date().toISOString(),
				data: {
					summary: { obj: "value" }, // non-string
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET s.ended_at"),
				expect.objectContaining({ summary: undefined }),
			);
		});

		it("should handle valid string session summary", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				event_type: "session_end",
				timestamp: new Date().toISOString(),
				data: {
					summary: "Completed task successfully", // valid string
				},
			});

			await handleIngestEvent(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET s.ended_at"),
				expect.objectContaining({ summary: "Completed task successfully" }),
			);
		});
	});

	describe("handleToolIngest", () => {
		it("should accept valid tool event", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				timestamp: new Date().toISOString(),
				tool_name: "Bash",
				tool_input: { command: "ls -la" },
				status: "success",
				duration_ms: 150,
			});

			const result = await handleToolIngest(c, deps);

			expect(result.data.status).toBe("accepted");
			expect(mockGraphClient.query).toHaveBeenCalled();
		});

		it("should create ToolCall node in graph", async () => {
			const c = createTestContext({
				client: "cursor",
				session_id: "session-456",
				timestamp: new Date().toISOString(),
				tool_name: "Read",
				status: "success",
			});

			await handleToolIngest(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("CREATE (tc:ToolCall"),
				expect.objectContaining({
					toolName: "Read",
					status: "success",
				}),
			);
		});

		it("should categorize tool types correctly", async () => {
			const testCases = [
				{ toolName: "Read", expectedType: "file_read" },
				{ toolName: "cat", expectedType: "file_read" },
				{ toolName: "Write", expectedType: "file_write" },
				{ toolName: "Edit", expectedType: "file_write" },
				{ toolName: "Bash", expectedType: "bash_exec" },
				{ toolName: "exec", expectedType: "bash_exec" },
				{ toolName: "Grep", expectedType: "file_grep" },
				{ toolName: "search", expectedType: "file_grep" },
				{ toolName: "Glob", expectedType: "file_glob" },
				{ toolName: "find", expectedType: "file_glob" },
				{ toolName: "WebFetch", expectedType: "web_fetch" },
				{ toolName: "web_search", expectedType: "web_fetch" },
				{ toolName: "fetch", expectedType: "web_fetch" },
				{ toolName: "mcp__some_tool", expectedType: "mcp" },
				{ toolName: "UnknownTool", expectedType: "unknown" },
			];

			for (const { toolName, expectedType } of testCases) {
				const c = createTestContext({
					client: "test",
					session_id: "test",
					timestamp: new Date().toISOString(),
					tool_name: toolName,
					status: "success",
				});

				await handleToolIngest(c, deps);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.any(String),
					expect.objectContaining({ toolType: expectedType }),
				);
			}
		});

		it("should reject invalid tool event", async () => {
			const c = createTestContext({
				client: "test",
				// Missing tool_name
			});

			const result = await handleToolIngest(c, deps);

			expect(result.status).toBe(400);
			expect(result.data.error).toBe("Invalid tool event format");
		});

		it("should handle processing errors gracefully", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				timestamp: new Date().toISOString(),
				tool_name: "Read",
				status: "success",
			});

			mockGraphClient.query.mockRejectedValueOnce(new Error("Database error"));

			const result = await handleToolIngest(c, deps);

			expect(result.status).toBe(500);
			expect(result.data.error).toBe("Processing failed");
		});
	});

	describe("handlePromptIngest", () => {
		it("should store prompt as turn memory", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				timestamp: new Date().toISOString(),
				content: "Help me implement a feature",
				context: {
					working_dir: "/Users/test/my-project",
				},
			});

			await handlePromptIngest(c, deps);

			expect(mockMemoryStore.createMemory).toHaveBeenCalledWith({
				content: "Help me implement a feature",
				type: "turn",
				source: "auto",
				project: "my-project", // Extracted from working_dir
				sourceSessionId: "session-123",
			});
		});

		it("should reject invalid prompt event", async () => {
			const c = createTestContext({
				client: "test",
				// Missing content
			});

			const result = await handlePromptIngest(c, deps);

			expect(result.status).toBe(400);
			expect(result.data.error).toBe("Invalid prompt event format");
		});

		it("should handle processing errors gracefully", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				timestamp: new Date().toISOString(),
				content: "Test prompt",
			});

			mockMemoryStore.createMemory.mockRejectedValueOnce(new Error("Memory error"));

			const result = await handlePromptIngest(c, deps);

			expect(result.status).toBe(500);
			expect(result.data.error).toBe("Processing failed");
		});
	});

	describe("handleSessionIngest", () => {
		it("should create session node on start event", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-new",
				timestamp: new Date().toISOString(),
				event: "start",
				context: {
					working_dir: "/Users/test/project",
					git_remote: "github.com/test/project",
				},
			});

			await handleSessionIngest(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("CREATE (s:Session"),
				expect.objectContaining({
					id: "session-new",
					agentType: "claude-code",
					workingDir: "/Users/test/project",
					gitRemote: "github.com/test/project",
				}),
			);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-new", client: "claude-code" }),
				"Session started",
			);
		});

		it("should update session node on end event", async () => {
			const c = createTestContext({
				client: "cursor",
				session_id: "session-existing",
				timestamp: new Date().toISOString(),
				event: "end",
				summary: "Fixed authentication bug and added tests",
			});

			await handleSessionIngest(c, deps);

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET s.ended_at"),
				expect.objectContaining({
					id: "session-existing",
					summary: "Fixed authentication bug and added tests",
				}),
			);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: "session-existing" }),
				"Session ended",
			);
		});

		it("should map client names to agent types", async () => {
			const testCases = [
				{ client: "claude-code", expected: "claude-code" },
				{ client: "Claude Code CLI", expected: "claude-code" },
				{ client: "codex", expected: "codex" },
				{ client: "Codex CLI", expected: "codex" },
				{ client: "gemini-cli", expected: "gemini-cli" },
				{ client: "cursor", expected: "cursor" },
				{ client: "aider", expected: "aider" },
				{ client: "opencode", expected: "opencode" },
				{ client: "unknown-client", expected: "unknown" },
			];

			for (const { client, expected } of testCases) {
				const c = createTestContext({
					client,
					session_id: "test",
					timestamp: new Date().toISOString(),
					event: "start",
				});

				await handleSessionIngest(c, deps);

				expect(mockGraphClient.query).toHaveBeenCalledWith(
					expect.any(String),
					expect.objectContaining({ agentType: expected }),
				);
			}
		});

		it("should reject invalid session event", async () => {
			const c = createTestContext({
				client: "test",
				// Missing event field
			});

			const result = await handleSessionIngest(c, deps);

			expect(result.status).toBe(400);
			expect(result.data.error).toBe("Invalid session event format");
		});

		it("should handle processing errors gracefully", async () => {
			const c = createTestContext({
				client: "claude-code",
				session_id: "session-123",
				timestamp: new Date().toISOString(),
				event: "start",
			});

			mockGraphClient.query.mockRejectedValueOnce(new Error("Database error"));

			const result = await handleSessionIngest(c, deps);

			expect(result.status).toBe(500);
			expect(result.data.error).toBe("Processing failed");
		});
	});
});
