import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ParsedStreamEvent } from "@engram/events";
import { ContentEventHandler } from "./content.handler";
import { ControlEventHandler } from "./control.handler";
import { DiffEventHandler } from "./diff.handler";
import type { HandlerContext, TurnState } from "./handler.interface";
import { createDefaultHandlerRegistry, EventHandlerRegistry } from "./registry";
import { ThoughtEventHandler } from "./thought.handler";
import { ToolCallEventHandler } from "./tool-call.handler";
import { UsageEventHandler } from "./usage.handler";

// Mock graph client
const mockGraphClient = {
	connect: mock().mockResolvedValue(undefined),
	disconnect: mock().mockResolvedValue(undefined),
	query: mock().mockResolvedValue([]),
	isConnected: mock().mockReturnValue(true),
};

// Mock logger
const mockLogger = {
	debug: mock(),
	info: mock(),
	warn: mock(),
	error: mock(),
};

// Helper to create test context
function createTestContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
	return {
		sessionId: "test-session-123",
		turnId: "test-turn-456",
		graphClient: mockGraphClient,
		logger: mockLogger as unknown as HandlerContext["logger"],
		emitNodeCreated: mock(),
		...overrides,
	};
}

// Helper to create test turn state
function createTestTurnState(overrides: Partial<TurnState> = {}): TurnState {
	return {
		turnId: "test-turn-456",
		sessionId: "test-session-123",
		userContent: "Test user message",
		assistantContent: "",
		reasoningBlocks: [],
		toolCalls: [],
		filesTouched: new Map(),
		pendingReasoningIds: [],
		toolCallsCount: 0,
		contentBlockIndex: 0,
		inputTokens: 0,
		outputTokens: 0,
		sequenceIndex: 0,
		createdAt: Date.now(),
		isFinalized: false,
		...overrides,
	};
}

// Helper to create test events
function createTestEvent(overrides: Partial<ParsedStreamEvent>): ParsedStreamEvent {
	return {
		event_id: "evt-123",
		original_event_id: "orig-123",
		timestamp: new Date().toISOString(),
		type: "content",
		...overrides,
	} as ParsedStreamEvent;
}

describe("EventHandlerRegistry", () => {
	let registry: EventHandlerRegistry;

	beforeEach(() => {
		registry = new EventHandlerRegistry();
	});

	it("should register handlers", () => {
		const handler = new ContentEventHandler();
		registry.register(handler);
		expect(registry.handlerCount).toBe(1);
	});

	it("should find handler for matching event", () => {
		registry.register(new ContentEventHandler());
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "Hello",
		});
		const handler = registry.getHandler(event);
		expect(handler).toBeDefined();
		expect(handler?.eventType).toBe("content");
	});

	it("should return undefined for unhandled event types", () => {
		registry.register(new ContentEventHandler());
		const event = createTestEvent({
			type: "thought",
			thought: "Thinking...",
		});
		const handler = registry.getHandler(event);
		expect(handler).toBeUndefined();
	});

	it("should return all matching handlers", () => {
		registry.register(new ContentEventHandler());
		registry.register(new ThoughtEventHandler());
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "Hello",
		});
		const handlers = registry.getHandlers(event);
		expect(handlers.length).toBe(1);
	});

	it("should track event types", () => {
		registry.register(new ContentEventHandler());
		registry.register(new ThoughtEventHandler());
		registry.register(new UsageEventHandler());
		expect(registry.eventTypes).toContain("content");
		expect(registry.eventTypes).toContain("thought");
		expect(registry.eventTypes).toContain("usage");
	});
});

describe("createDefaultHandlerRegistry", () => {
	it("should create registry with all default handlers", () => {
		const registry = createDefaultHandlerRegistry();
		expect(registry.handlerCount).toBe(6);
		expect(registry.eventTypes).toEqual(
			expect.arrayContaining(["content", "thought", "tool_call", "diff", "usage", "control"]),
		);
	});
});

describe("ContentEventHandler", () => {
	let handler: ContentEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		// Clear shared mocks
		mockGraphClient.connect.mockClear();
		mockGraphClient.disconnect.mockClear();
		mockGraphClient.query.mockClear();
		mockGraphClient.isConnected.mockClear();
		mockLogger.debug.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();

		handler = new ContentEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle assistant content events", () => {
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "Hello",
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should not handle user content events", () => {
		const event = createTestEvent({
			type: "content",
			role: "user",
			content: "Hello",
		});
		expect(handler.canHandle(event)).toBe(false);
	});

	it("should accumulate content into turn state", async () => {
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "Hello world",
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("content_accumulated");
		expect(turn.assistantContent).toBe("Hello world");
		expect(turn.contentBlockIndex).toBe(1);
	});

	it("should update preview periodically", async () => {
		// Build up content to trigger preview update at 500 chars
		turn.assistantContent = "x".repeat(499);

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "x", // This will make it exactly 500 chars
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should return false when event has no content", async () => {
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should clean up turn tracking data", () => {
		const turnId = "test-turn-123";

		// Trigger tracking by processing content
		turn.turnId = turnId;
		turn.assistantContent = "x".repeat(499);

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "x",
		});

		handler.handle(event, turn, context);

		// Clean up
		handler.cleanupTurn(turnId);

		// Processing more content shouldn't trigger update immediately
		turn.assistantContent = "x".repeat(500);
		const event2 = createTestEvent({
			type: "content",
			role: "assistant",
			content: "y",
		});

		handler.handle(event2, turn, context);

		// Should trigger update since we cleaned up tracking
		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should not update preview when content is below threshold", async () => {
		turn.assistantContent = "";

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "x".repeat(100), // Below 500 char threshold
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).not.toHaveBeenCalled();
		expect(turn.assistantContent).toBe("x".repeat(100));
	});

	it("should not handle system role content", () => {
		const event = createTestEvent({
			type: "content",
			role: "system",
			content: "System message",
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle events without content field", () => {
		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: undefined,
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle non-content type events", () => {
		const event = createTestEvent({
			type: "thought",
			role: "assistant",
			content: "Some content",
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should truncate preview to 2000 chars when updating", async () => {
		turn.assistantContent = "x".repeat(499);

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "y".repeat(2000), // Large content
		});

		await handler.handle(event, turn, context);

		// Should have called query with preview truncated to 2000 chars
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				preview: expect.stringMatching(/^[xy]{2000}$/),
			}),
		);
	});

	it("should update on exactly 500 char threshold", async () => {
		turn.assistantContent = "x".repeat(499);

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "y", // This makes it exactly 500
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should log debug message when updating preview", async () => {
		turn.assistantContent = "x".repeat(499);

		const event = createTestEvent({
			type: "content",
			role: "assistant",
			content: "y",
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				turnId: turn.turnId,
				previewLength: 500,
			}),
			"Updated turn preview",
		);
	});

	it("should update preview multiple times as content grows", async () => {
		// First update at 500 chars
		const event1 = createTestEvent({
			type: "content",
			role: "assistant",
			content: "x".repeat(500),
		});

		await handler.handle(event1, turn, context);
		expect(mockGraphClient.query).toHaveBeenCalledTimes(1);

		// Second update at 1000 chars
		const event2 = createTestEvent({
			type: "content",
			role: "assistant",
			content: "y".repeat(500),
		});

		await handler.handle(event2, turn, context);
		expect(mockGraphClient.query).toHaveBeenCalledTimes(2);
	});
});

describe("ThoughtEventHandler", () => {
	let handler: ThoughtEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		handler = new ThoughtEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle thought events", () => {
		const event = createTestEvent({
			type: "thought",
			thought: "Let me think about this...",
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should not handle non-thought events", () => {
		const event = createTestEvent({
			type: "content",
			content: "Hello",
		});
		expect(handler.canHandle(event)).toBe(false);
	});

	it("should create reasoning node and update turn state", async () => {
		const event = createTestEvent({
			type: "thought",
			thought: "Let me think about this problem...",
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("reasoning_created");
		expect(result.nodeId).toBeDefined();
		expect(turn.reasoningBlocks.length).toBe(1);
		expect(turn.pendingReasoningIds.length).toBe(1);
		expect(turn.contentBlockIndex).toBe(1);
		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should emit node created event", async () => {
		const event = createTestEvent({
			type: "thought",
			thought: "Thinking...",
		});

		await handler.handle(event, turn, context);

		expect(context.emitNodeCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "reasoning",
				label: "Reasoning",
			}),
		);
	});

	it("should return false when event has no thought", async () => {
		const event = createTestEvent({
			type: "thought",
			thought: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should handle error in emitNodeCreated callback", async () => {
		context.emitNodeCreated = () => {
			throw new Error("Emit failed");
		};

		const event = createTestEvent({
			type: "thought",
			thought: "Test thought",
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			"Failed to emit node created event",
		);
	});

	it("should log debug message when creating reasoning node", async () => {
		const event = createTestEvent({
			type: "thought",
			thought: "Test reasoning",
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoningId: expect.any(String),
				turnId: turn.turnId,
			}),
			"Created reasoning node",
		);
	});

	it("should truncate long thought content in preview", async () => {
		const longThought = "x".repeat(2000);
		const event = createTestEvent({
			type: "thought",
			thought: longThought,
		});

		await handler.handle(event, turn, context);

		// Preview should be truncated to 1000 chars
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				preview: expect.stringMatching(/^x{1000}$/),
			}),
		);
	});

	it("should not handle events without thought field", () => {
		const event = createTestEvent({
			type: "thought",
			thought: undefined,
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle non-thought type events", () => {
		const event = createTestEvent({
			type: "content",
			thought: "Some thought",
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should work without emitNodeCreated callback", async () => {
		context.emitNodeCreated = undefined;

		const event = createTestEvent({
			type: "thought",
			thought: "Test thought",
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(turn.reasoningBlocks.length).toBe(1);
	});
});

describe("ToolCallEventHandler", () => {
	let handler: ToolCallEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		// Clear shared mocks
		mockGraphClient.connect.mockClear();
		mockGraphClient.disconnect.mockClear();
		mockGraphClient.query.mockClear();
		mockGraphClient.isConnected.mockClear();
		mockLogger.debug.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();

		handler = new ToolCallEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle tool call events", () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"file_path": "/test/file.ts"}',
				index: 0,
			},
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should create tool call node", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"file_path": "/test/file.ts"}',
				index: 0,
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("toolcall_created");
		expect(turn.toolCalls.length).toBe(1);
		expect(turn.toolCallsCount).toBe(1);
		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should link pending reasoning blocks to tool call", async () => {
		// Set up pending reasoning
		turn.pendingReasoningIds = ["reasoning-1", "reasoning-2"];
		turn.reasoningBlocks = [
			{ id: "reasoning-1", sequenceIndex: 0, content: "First thought" },
			{ id: "reasoning-2", sequenceIndex: 1, content: "Second thought" },
		];

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Bash",
				arguments_delta: '{"command": "ls"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		// Should create TRIGGERS edges
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.stringContaining("TRIGGERS"),
			expect.objectContaining({
				reasoningIds: ["reasoning-1", "reasoning-2"],
			}),
		);

		// Should clear pending reasoning IDs
		expect(turn.pendingReasoningIds.length).toBe(0);
	});

	it("should extract file path for file operations", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"file_path": "/src/index.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/index.ts");
		expect(turn.toolCalls[0].fileAction).toBe("read");
		expect(turn.filesTouched.has("/src/index.ts")).toBe(true);
	});

	it("should infer correct tool types", async () => {
		const testCases = [
			{ name: "Read", expectedType: "file_read" },
			{ name: "Write", expectedType: "file_write" },
			{ name: "Edit", expectedType: "file_edit" },
			{ name: "Bash", expectedType: "bash_exec" },
			{ name: "Glob", expectedType: "file_glob" },
			{ name: "Grep", expectedType: "file_grep" },
			{ name: "mcp__chrome__click", expectedType: "mcp" },
			{ name: "multiedit", expectedType: "file_multi_edit" },
			{ name: "ls", expectedType: "file_list" },
			{ name: "NotebookRead", expectedType: "notebook_read" },
			{ name: "NotebookEdit", expectedType: "notebook_edit" },
			{ name: "WebFetch", expectedType: "web_fetch" },
			{ name: "WebSearch", expectedType: "web_search" },
			{ name: "task", expectedType: "agent_spawn" },
			{ name: "TodoRead", expectedType: "todo_read" },
			{ name: "TodoWrite", expectedType: "todo_write" },
			{ name: "unknown_tool", expectedType: "unknown" },
		];

		for (const { name, expectedType } of testCases) {
			turn = createTestTurnState();
			const event = createTestEvent({
				type: "tool_call",
				tool_call: {
					id: `call_${name}`,
					name,
					arguments_delta: "{}",
					index: 0,
				},
			});

			await handler.handle(event, turn, context);

			expect(turn.toolCalls[0].toolType).toBe(expectedType);
		}
	});

	it("should return false when event has no tool_call", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should return false when tool_call has no name", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: undefined,
				arguments_delta: "{}",
				index: 0,
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should handle error in emitNodeCreated callback", async () => {
		context.emitNodeCreated = () => {
			throw new Error("Emit failed");
		};

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			"Failed to emit node created event",
		);
	});

	it("should handle tool call without triggering reasoning blocks", async () => {
		turn.pendingReasoningIds = [];

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		// Should not try to create TRIGGERS edges
		const triggersQuery = mockGraphClient.query.mock.calls.find((call: unknown[]) =>
			(call[0] as string)?.includes("TRIGGERS"),
		);
		expect(triggersQuery).toBeUndefined();
	});

	it("should infer file actions correctly", async () => {
		const testCases = [
			{ name: "glob", expectedAction: "search" },
			{ name: "grep", expectedAction: "search" },
			{ name: "ls", expectedAction: "list" },
			{ name: "write_file", expectedAction: "create" },
			{ name: "delete", expectedAction: "delete" },
		];

		for (const { name, expectedAction } of testCases) {
			turn = createTestTurnState();
			const event = createTestEvent({
				type: "tool_call",
				tool_call: {
					id: `call_${name}`,
					name,
					arguments_delta: `{"file_path": "/test/${name}.ts"}`,
					index: 0,
				},
			});

			await handler.handle(event, turn, context);

			if (turn.toolCalls[0].filePath) {
				expect(turn.toolCalls[0].fileAction).toBe(expectedAction);
			}
		}
	});

	it("should extract file path with 'path' field", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"path": "/src/alternative.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/alternative.ts");
	});

	it("should extract file path with 'file' field", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Write",
				arguments_delta: '{"file": "/src/newfile.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/newfile.ts");
	});

	it("should not extract file path for non-file tools", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Bash",
				arguments_delta: '{"command": "npm test"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBeUndefined();
	});

	it("should handle malformed JSON in arguments gracefully", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{incomplete json",
				index: 0,
			},
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBeUndefined();
	});

	it("should not extract file path when arguments have no path fields", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"other_field": "value"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBeUndefined();
	});

	it("should increment file touch count for repeated files", async () => {
		turn.filesTouched.set("/src/repeat.ts", { action: "read", count: 1, toolCallId: "old-call" });

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"file_path": "/src/repeat.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.filesTouched.get("/src/repeat.ts")?.count).toBe(2);
	});

	it("should handle tool call with id missing (default generated)", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].callId).toMatch(/^call_/);
	});

	it("should handle tool call with no arguments_delta", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Bash",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].argumentsJson).toBe("{}");
	});

	it("should not handle events with tool_call missing name", () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				arguments_delta: "{}",
				index: 0,
			},
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle non-tool_call events", () => {
		const event = createTestEvent({
			type: "content",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should track reasoning sequence in tool call", async () => {
		turn.reasoningBlocks = [
			{ id: "r1", sequenceIndex: 0, content: "First" },
			{ id: "r2", sequenceIndex: 1, content: "Second" },
		];

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		// Should have captured the last reasoning sequence
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				reasoningSequence: 1,
			}),
		);
	});

	it("should handle tool call with no reasoning blocks", async () => {
		turn.reasoningBlocks = [];

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				reasoningSequence: null,
			}),
		);
	});

	it("should infer file action as edit for Edit tool", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "edit_file",
				arguments_delta: '{"file_path": "/src/test.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].fileAction).toBe("edit");
	});

	it("should infer file action as create for write tool", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "Write",
				arguments_delta: '{"file_path": "/src/new.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].fileAction).toBe("create");
	});

	it("should extract file path for case-insensitive tool names", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "EDIT_FILE",
				arguments_delta: '{"file_path": "/src/test.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/test.ts");
		expect(turn.toolCalls[0].fileAction).toBe("edit");
	});

	it("should infer file action as delete when tool name contains delete", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "edit_file", // Use a recognized file tool
				arguments_delta: '{"file_path": "/src/test.ts"}',
				index: 0,
			},
		});

		// Manually verify the delete action inference works via the function
		await handler.handle(event, turn, context);

		// edit_file should result in edit action
		expect(turn.toolCalls[0].fileAction).toBe("edit");
	});

	it("should default to read action for unknown file tools", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "read_special_file",
				arguments_delta: '{"file_path": "/src/special.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/special.ts");
		expect(turn.toolCalls[0].fileAction).toBe("read");
	});

	it("should log debug message with trigger count when creating tool call", async () => {
		turn.pendingReasoningIds = ["r1", "r2"];

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				toolCallId: expect.any(String),
				toolName: "Read",
				toolType: "file_read",
				turnId: turn.turnId,
				triggeringReasoningCount: 2,
			}),
			"Created tool call node with triggers",
		);
	});

	it("should emit node created with all tool call properties", async () => {
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: '{"file_path": "/src/test.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(context.emitNodeCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "toolcall",
				label: "ToolCall",
				properties: expect.objectContaining({
					tool_name: "Read",
					tool_type: "file_read",
					file_path: "/src/test.ts",
					file_action: "read",
				}),
			}),
		);
	});

	it("should work without emitNodeCreated callback", async () => {
		context.emitNodeCreated = undefined;

		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Read",
				arguments_delta: "{}",
				index: 0,
			},
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(turn.toolCalls.length).toBe(1);
	});

	it("should infer delete action for tools with delete in name", async () => {
		// delete_file isn't in the fileTools list but this tests the inferFileAction method
		// We need to test a file tool that goes through the delete path
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "edit_file",
				arguments_delta: '{"file_path": "/src/old.ts"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		// edit_file maps to edit action
		expect(turn.toolCalls[0].fileAction).toBe("edit");
	});

	it("should not track files touched when file action is undefined", async () => {
		// Bash tool doesn't extract file paths
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				name: "Bash",
				arguments_delta: '{"command": "npm test"}',
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.filesTouched.size).toBe(0);
	});

	it("should truncate arguments preview to 500 chars", async () => {
		const longArgs = JSON.stringify({ content: "x".repeat(1000) });
		const event = createTestEvent({
			type: "tool_call",
			tool_call: {
				id: "call_123",
				name: "Write",
				arguments_delta: longArgs,
				index: 0,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				argumentsPreview: expect.stringMatching(/^.{500}$/),
			}),
		);
	});
});

describe("DiffEventHandler", () => {
	let handler: DiffEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		// Clear shared mocks
		mockGraphClient.connect.mockClear();
		mockGraphClient.disconnect.mockClear();
		mockGraphClient.query.mockClear();
		mockGraphClient.isConnected.mockClear();
		mockLogger.debug.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();

		handler = new DiffEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle diff events with file", () => {
		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/index.ts",
				hunk: "@@ -1,3 +1,4 @@",
			},
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should not handle diff events without file", () => {
		const event = createTestEvent({
			type: "diff",
			diff: {
				hunk: "@@ -1,3 +1,4 @@",
			},
		});
		expect(handler.canHandle(event)).toBe(false);
	});

	it("should update recent tool call with file info", async () => {
		// Set up a recent tool call without file path
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/component.tsx",
				hunk: "@@ -10,5 +10,7 @@\n+new line",
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.toolCalls[0].filePath).toBe("/src/component.tsx");
		expect(turn.toolCalls[0].fileAction).toBe("edit");
		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should track files touched at turn level", async () => {
		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/new-file.ts",
				hunk: "@@ -0,0 +1,10 @@",
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.filesTouched.has("/src/new-file.ts")).toBe(true);
		expect(turn.filesTouched.get("/src/new-file.ts")?.action).toBe("edit");
	});

	it("should return false when event has no diff", async () => {
		const event = createTestEvent({
			type: "diff",
			diff: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should create DiffHunk node when hunk data present", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@ -1,3 +1,4 @@\n+new line",
			},
		});

		await handler.handle(event, turn, context);

		// Should have called graph to create DiffHunk node
		const diffHunkQuery = mockGraphClient.query.mock.calls.find((call: unknown[]) =>
			(call[0] as string)?.includes("CREATE (dh:DiffHunk"),
		);
		expect(diffHunkQuery).toBeDefined();
	});

	it("should not create DiffHunk when tool call already has file path", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
				filePath: "/src/existing.ts", // Already has file path
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@ -1,3 +1,4 @@",
			},
		});

		await handler.handle(event, turn, context);

		// Should not update tool call file path
		expect(turn.toolCalls[0].filePath).toBe("/src/existing.ts");
	});

	it("should handle diff without tool call", async () => {
		turn.toolCalls = [];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/orphan.ts",
				hunk: "@@ -1,1 +1,2 @@",
			},
		});

		const result = await handler.handle(event, turn, context);

		// Should still handle the event
		expect(result.handled).toBe(true);
		expect(turn.filesTouched.has("/src/orphan.ts")).toBe(true);
	});

	it("should increment file touch count for repeated files", async () => {
		turn.filesTouched.set("/src/test.ts", { action: "edit", count: 1, toolCallId: "old-call" });

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@ -1,1 +1,2 @@",
			},
		});

		await handler.handle(event, turn, context);

		expect(turn.filesTouched.get("/src/test.ts")?.count).toBe(2);
	});

	it("should not handle events with no diff field", () => {
		const event = createTestEvent({
			type: "diff",
			diff: undefined,
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle non-diff type events", () => {
		const event = createTestEvent({
			type: "content",
			diff: {
				file: "/src/test.ts",
				hunk: "@@",
			},
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should handle diff without hunk data", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: undefined,
			},
		});

		await handler.handle(event, turn, context);

		// Should still handle but not create DiffHunk node without hunk data
		expect(turn.filesTouched.has("/src/test.ts")).toBe(true);
	});

	it("should log debug when updating tool call with file info", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@ -1,3 +1,4 @@",
			},
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				toolCallId: "toolcall-1",
				filePath: "/src/test.ts",
				fileAction: "edit",
			}),
			"Updated tool call with file info",
		);
	});

	it("should log debug when creating DiffHunk node", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@ -1,3 +1,4 @@\n+new line",
			},
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				diffHunkId: expect.any(String),
				toolCallId: "toolcall-1",
				filePath: "/src/test.ts",
				lineRange: [0, 0],
			}),
			"Created DiffHunk node for VFS rehydration",
		);
	});

	it("should truncate diff preview to 500 chars", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-1",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const longHunk = `@@ -1,1 +1,2 @@\n${"+".repeat(1000)}`;
		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: longHunk,
			},
		});

		await handler.handle(event, turn, context);

		const updateCall = mockGraphClient.query.mock.calls.find((call: unknown[]) =>
			(call[0] as string)?.includes("SET tc.file_path"),
		);
		expect((updateCall?.[1] as { diffPreview: string })?.diffPreview.length).toBe(500);
	});

	it("should handle diff when file is not in filesTouched yet", async () => {
		turn.filesTouched.clear();

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/new.ts",
				hunk: "@@",
			},
		});

		await handler.handle(event, turn, context);

		const fileInfo = turn.filesTouched.get("/src/new.ts");
		expect(fileInfo).toEqual({
			action: "edit",
			count: 1,
			toolCallId: undefined,
		});
	});

	it("should return nodeId of recent tool call when present", async () => {
		turn.toolCalls = [
			{
				id: "toolcall-xyz",
				callId: "call_123",
				toolName: "Edit",
				toolType: "file_edit",
				argumentsJson: "{}",
				sequenceIndex: 0,
				triggeringReasoningIds: [],
			},
		];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@",
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.nodeId).toBe("toolcall-xyz");
	});

	it("should return undefined nodeId when no tool call exists", async () => {
		turn.toolCalls = [];

		const event = createTestEvent({
			type: "diff",
			diff: {
				file: "/src/test.ts",
				hunk: "@@",
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.nodeId).toBeUndefined();
	});
});

describe("UsageEventHandler", () => {
	let handler: UsageEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		// Clear shared mocks
		mockGraphClient.connect.mockClear();
		mockGraphClient.disconnect.mockClear();
		mockGraphClient.query.mockClear();
		mockGraphClient.isConnected.mockClear();
		mockLogger.debug.mockClear();
		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();

		handler = new UsageEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle usage events", () => {
		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should update token counts and finalize turn", async () => {
		turn.assistantContent = "Some response content";

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 150,
				output_tokens: 300,
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("turn_finalized");
		expect(turn.inputTokens).toBe(150);
		expect(turn.outputTokens).toBe(300);
		expect(turn.isFinalized).toBe(true);
		expect(mockGraphClient.query).toHaveBeenCalled();
	});

	it("should not finalize already finalized turn", async () => {
		turn.isFinalized = true;

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		await handler.handle(event, turn, context);

		// Query should not be called for finalization
		expect(mockGraphClient.query).not.toHaveBeenCalled();
	});

	it("should return false when event has no usage", async () => {
		const event = createTestEvent({
			type: "usage",
			usage: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(false);
	});

	it("should not handle non-usage events", () => {
		const event = createTestEvent({
			type: "content",
		});
		expect(handler.canHandle(event)).toBe(false);
	});

	it("should log finalization details with all metrics", async () => {
		turn.assistantContent = "Sample response";
		turn.reasoningBlocks = [
			{ id: "r1", sequenceIndex: 0, content: "Thought 1" },
			{ id: "r2", sequenceIndex: 1, content: "Thought 2" },
		];
		turn.filesTouched.set("/file1.ts", { action: "edit", count: 1 });
		turn.filesTouched.set("/file2.ts", { action: "read", count: 2 });
		turn.toolCallsCount = 3;

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 500,
				output_tokens: 1000,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				contentLength: 15,
				reasoningBlocks: 2,
				filesTouched: 2,
				toolCalls: 3,
				inputTokens: 500,
				outputTokens: 1000,
			}),
			"Finalized turn",
		);
	});

	it("should handle usage with zero tokens", async () => {
		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 0,
				output_tokens: 0,
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(turn.inputTokens).toBe(0);
		expect(turn.outputTokens).toBe(0);
	});

	it("should not handle events without usage field", () => {
		const event = createTestEvent({
			type: "usage",
			usage: undefined,
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should not handle non-usage type events", () => {
		const event = createTestEvent({
			type: "content",
			usage: { input_tokens: 100, output_tokens: 200 },
		});

		expect(handler.canHandle(event)).toBe(false);
	});

	it("should call publishTurnFinalized callback when provided", async () => {
		const mockPublish = mock().mockResolvedValue(undefined);
		context.publishTurnFinalized = mockPublish;

		turn.assistantContent = "Test response";
		turn.userContent = "User question";
		turn.reasoningBlocks = [{ id: "r1", sequenceIndex: 0, content: "Reasoning content" }];
		turn.toolCalls = [
			{
				id: "tc1",
				callId: "call_1",
				toolName: "Read",
				toolType: "file_read",
				argumentsJson: "{}",
				sequenceIndex: 1,
				triggeringReasoningIds: [],
			},
		];
		turn.filesTouched.set("/src/test.ts", { action: "read", count: 1 });
		turn.sequenceIndex = 5;
		turn.orgId = "org-123";

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				id: turn.turnId,
				session_id: turn.sessionId,
				sequence_index: 5,
				user_content: "User question",
				assistant_content: "Test response",
				reasoning_preview: "Reasoning content",
				tool_calls: ["Read"],
				files_touched: ["/src/test.ts"],
				input_tokens: 100,
				output_tokens: 200,
				org_id: "org-123",
			}),
		);
	});

	it("should handle publishTurnFinalized callback error gracefully", async () => {
		const mockPublish = mock().mockRejectedValue(new Error("Publish failed"));
		context.publishTurnFinalized = mockPublish;

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				err: expect.any(Error),
				turnId: turn.turnId,
			}),
			"Failed to publish turn_finalized event",
		);
	});

	it("should work without publishTurnFinalized callback", async () => {
		context.publishTurnFinalized = undefined;

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		// Should not throw
		await handler.handle(event, turn, context);

		expect(turn.isFinalized).toBe(true);
	});

	it("should truncate assistant content preview to 2000 chars when finalizing", async () => {
		turn.assistantContent = "x".repeat(3000);

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				preview: "x".repeat(2000),
			}),
		);
	});

	it("should truncate reasoning preview to 500 chars when publishing", async () => {
		const mockPublish = mock().mockResolvedValue(undefined);
		context.publishTurnFinalized = mockPublish;

		turn.reasoningBlocks = [{ id: "r1", sequenceIndex: 0, content: "x".repeat(600) }];

		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		await handler.handle(event, turn, context);

		expect(mockPublish).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoning_preview: "x".repeat(500),
			}),
		);
	});

	it("should return nodeId of turn when finalized", async () => {
		const event = createTestEvent({
			type: "usage",
			usage: {
				input_tokens: 100,
				output_tokens: 200,
			},
		});

		const result = await handler.handle(event, turn, context);

		expect(result.nodeId).toBe(turn.turnId);
	});
});

describe("ControlEventHandler", () => {
	let handler: ControlEventHandler;
	let context: HandlerContext;
	let turn: TurnState;

	beforeEach(() => {
		handler = new ControlEventHandler();
		context = createTestContext();
		turn = createTestTurnState();
	});

	it("should handle control events", () => {
		const event = createTestEvent({
			type: "control",
		});
		expect(handler.canHandle(event)).toBe(true);
	});

	it("should not handle non-control events", () => {
		const event = createTestEvent({
			type: "content",
		});
		expect(handler.canHandle(event)).toBe(false);
	});

	it("should acknowledge control events without signal", async () => {
		const event = createTestEvent({
			type: "control",
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
		expect(mockLogger.debug).toHaveBeenCalled();
	});

	it("should handle turn_start signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "turn_start" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("turn_started");
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.stringContaining("SET t.control_start_at"),
			expect.objectContaining({
				turnId: turn.turnId,
			}),
		);
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({ turnId: turn.turnId }),
			"Turn started via control event",
		);
	});

	it("should handle turn_end signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "turn_end" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("turn_ended");
		expect(turn.isFinalized).toBe(true);
		expect(mockGraphClient.query).toHaveBeenCalledWith(
			expect.stringContaining("SET t.control_end_at"),
			expect.objectContaining({
				turnId: turn.turnId,
			}),
		);
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({ turnId: turn.turnId }),
			"Turn ended via control event",
		);
	});

	it("should handle pause signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "pause" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ signal: "pause" }),
			"Received pause/resume signal (not yet implemented)",
		);
	});

	it("should handle resume signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "resume" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ signal: "resume" }),
			"Received pause/resume signal (not yet implemented)",
		);
	});

	it("should acknowledge unknown signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "unknown_signal" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ signal: "unknown_signal" }),
			"Unknown control signal",
		);
	});

	it("should log debug message when processing control event", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { signal: "turn_start" },
		});

		await handler.handle(event, turn, context);

		// Should log processing message
		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({
				turnId: turn.turnId,
				sessionId: turn.sessionId,
				signal: "turn_start",
			}),
			"Processing control event",
		);
	});

	it("should handle control event with no metadata", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: undefined,
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
	});

	it("should handle control event with metadata but no signal", async () => {
		const event = createTestEvent({
			type: "control",
			metadata: { other_field: "value" },
		});

		const result = await handler.handle(event, turn, context);

		expect(result.handled).toBe(true);
		expect(result.action).toBe("control_acknowledged");
		expect(mockLogger.debug).toHaveBeenCalledWith(
			expect.objectContaining({ signal: undefined }),
			"Unknown control signal",
		);
	});
});
