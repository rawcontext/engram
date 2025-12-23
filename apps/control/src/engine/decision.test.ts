import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mock external dependencies before importing modules that use them
const mockGenerateText = mock();
const mockTool = mock((config: object) => ({
	...config,
	_isTool: true,
}));

mock.module("ai", () => ({
	generateText: mockGenerateText,
	tool: mockTool,
}));

mock.module("@ai-sdk/xai", () => ({
	xai: mock(() => "mock-xai-model"),
}));

// Import after mocks are set up
import {
	convertMcpToolsToAiSdk,
	createDecisionEngine,
	DecisionEngine,
	extractToolCalls,
} from "./decision";

describe("extractToolCalls", () => {
	it("should return empty array when toolCalls is undefined", () => {
		const result = extractToolCalls({});
		expect(result).toEqual([]);
	});

	it("should return empty array when toolCalls is empty array", () => {
		const result = extractToolCalls({ toolCalls: [] });
		expect(result).toEqual([]);
	});

	it("should return empty array when toolCalls is not an array", () => {
		const result = extractToolCalls({ toolCalls: "not an array" as unknown as unknown[] });
		expect(result).toEqual([]);
	});

	it("should extract tool calls with toolName and args format", () => {
		const result = extractToolCalls({
			toolCalls: [{ toolName: "read_file", args: { path: "/test.txt" } }],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("read_file");
		expect(result[0].args).toEqual({ path: "/test.txt" });
	});

	it("should extract tool calls with name and input format (alternative)", () => {
		const result = extractToolCalls({
			toolCalls: [{ name: "write_file", input: { path: "/test.txt", content: "hello" } }],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("write_file");
		expect(result[0].args).toEqual({ path: "/test.txt", content: "hello" });
	});

	it("should prefer toolName over name when both present", () => {
		const result = extractToolCalls({
			toolCalls: [{ toolName: "preferred", name: "ignored", args: {} }],
		});

		expect(result[0].toolName).toBe("preferred");
	});

	it("should prefer args over input when both present", () => {
		const result = extractToolCalls({
			toolCalls: [{ toolName: "test", args: { a: 1 }, input: { b: 2 } }],
		});

		expect(result[0].args).toEqual({ a: 1 });
	});

	it("should handle multiple tool calls", () => {
		const result = extractToolCalls({
			toolCalls: [
				{ toolName: "tool1", args: { a: 1 } },
				{ toolName: "tool2", args: { b: 2 } },
				{ toolName: "tool3", args: { c: 3 } },
			],
		});

		expect(result).toHaveLength(3);
		expect(result.map((c) => c.toolName)).toEqual(["tool1", "tool2", "tool3"]);
	});

	it("should skip null entries", () => {
		const result = extractToolCalls({
			toolCalls: [{ toolName: "valid", args: {} }, null as unknown as object],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("valid");
	});

	it("should skip undefined entries", () => {
		const result = extractToolCalls({
			toolCalls: [undefined as unknown as object, { toolName: "valid", args: {} }],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("valid");
	});

	it("should skip primitive entries", () => {
		const result = extractToolCalls({
			toolCalls: ["string", 123, true, { toolName: "valid", args: {} }] as unknown[],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("valid");
	});

	it("should skip entries without toolName or name", () => {
		const result = extractToolCalls({
			toolCalls: [{ args: { foo: "bar" } }, { toolName: "valid", args: {} }],
		});

		expect(result).toHaveLength(1);
		expect(result[0].toolName).toBe("valid");
	});

	it("should use empty object for missing args", () => {
		const result = extractToolCalls({
			toolCalls: [{ toolName: "no_args" }],
		});

		expect(result).toHaveLength(1);
		expect(result[0].args).toEqual({});
	});
});

describe("convertMcpToolsToAiSdk", () => {
	beforeEach(() => {
		mockTool.mockClear();
	});

	it("should return empty object for empty array", () => {
		const result = convertMcpToolsToAiSdk([]);
		expect(result).toEqual({});
	});

	it("should convert single tool with description", () => {
		const result = convertMcpToolsToAiSdk([
			{ name: "read_file", description: "Read a file from disk" },
		]);

		expect(result).toHaveProperty("read_file");
		expect(mockTool).toHaveBeenCalledWith({
			description: "Read a file from disk",
			inputSchema: expect.any(Object),
		});
	});

	it("should generate default description when not provided", () => {
		convertMcpToolsToAiSdk([{ name: "my_tool" }]);

		expect(mockTool).toHaveBeenCalledWith({
			description: "Execute my_tool",
			inputSchema: expect.any(Object),
		});
	});

	it("should convert multiple tools", () => {
		const result = convertMcpToolsToAiSdk([
			{ name: "tool1", description: "First tool" },
			{ name: "tool2", description: "Second tool" },
			{ name: "tool3", description: "Third tool" },
		]);

		expect(Object.keys(result)).toHaveLength(3);
		expect(result).toHaveProperty("tool1");
		expect(result).toHaveProperty("tool2");
		expect(result).toHaveProperty("tool3");
		expect(mockTool).toHaveBeenCalledTimes(3);
	});

	it("should use passthrough schema for dynamic MCP tools", () => {
		convertMcpToolsToAiSdk([{ name: "dynamic_tool" }]);

		// Verify that tool was called with a Zod schema
		expect(mockTool).toHaveBeenCalledWith(
			expect.objectContaining({
				inputSchema: expect.any(Object),
			}),
		);
	});
});

describe("DecisionEngine", () => {
	const mockLogger = {
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
	};

	const createMockContextAssembler = () => ({
		assembleContext: mock().mockResolvedValue("Mock context string"),
	});

	const createMockToolAdapter = () => ({
		listTools: mock().mockResolvedValue([
			{ name: "read_file", description: "Read a file" },
			{ name: "write_file", description: "Write a file" },
		]),
		callTool: mock().mockResolvedValue({ success: true }),
	});

	beforeEach(() => {
		mockGenerateText.mockReset();
	});

	afterEach(() => {});

	describe("constructor", () => {
		it("should create engine with all dependencies", () => {
			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			expect(engine).toBeInstanceOf(DecisionEngine);
		});

		it("should use default logger when not provided", () => {
			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
			});

			expect(engine).toBeInstanceOf(DecisionEngine);
		});
	});

	describe("start and stop", () => {
		it("should start and stop the internal actor", () => {
			const engine = new DecisionEngine({
				contextAssembler: createMockContextAssembler() as any,
				toolAdapter: createMockToolAdapter() as any,
				logger: mockLogger as any,
			});

			// Should not throw
			expect(() => engine.start()).not.toThrow();
			expect(() => engine.stop()).not.toThrow();
		});

		it("should be idempotent on stop", () => {
			const engine = new DecisionEngine({
				contextAssembler: createMockContextAssembler() as any,
				toolAdapter: createMockToolAdapter() as any,
				logger: mockLogger as any,
			});

			engine.start();
			engine.stop();
			// Calling stop again should not throw
			expect(() => engine.stop()).not.toThrow();
		});
	});

	describe("handleInput", () => {
		it("should send START event with session and input", async () => {
			mockGenerateText.mockResolvedValue({
				text: "I understand. Let me help you with that.",
				toolCalls: [],
				finishReason: "stop",
			} as any);

			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-123", "Hello, world!");

			// Give XState time to process
			await new Promise((r) => setTimeout(r, 100));

			engine.stop();

			// Context assembler should be called with session and input
			expect(contextAssembler.assembleContext).toHaveBeenCalledWith("session-123", "Hello, world!");
		});

		it("should fetch tools from adapter", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Response",
				toolCalls: [],
				finishReason: "stop",
			} as any);

			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-1", "Test input");

			// Wait for state machine to process
			await new Promise((r) => setTimeout(r, 100));

			engine.stop();

			expect(toolAdapter.listTools).toHaveBeenCalled();
		});

		it("should call generateText with assembled context", async () => {
			const mockContext = "System context with memories and history";
			mockGenerateText.mockResolvedValue({
				text: "AI response",
				toolCalls: [],
				finishReason: "stop",
			} as any);

			const contextAssembler = createMockContextAssembler();
			contextAssembler.assembleContext.mockResolvedValue(mockContext);

			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-1", "User message");

			// Wait for state machine to process
			await new Promise((r) => setTimeout(r, 100));

			engine.stop();

			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					system: mockContext,
					prompt: "User message",
				}),
			);
		});

		it("should handle tool calls by calling tool adapter", async () => {
			// First call returns tool calls, second returns final response
			mockGenerateText
				.mockResolvedValueOnce({
					text: "Let me read that file for you.",
					toolCalls: [{ toolName: "read_file", args: { path: "/test.txt" } }],
					finishReason: "tool_calls",
				} as any)
				.mockResolvedValueOnce({
					text: "Here is the file content.",
					toolCalls: [],
					finishReason: "stop",
				} as any);

			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-1", "Read /test.txt");

			// Wait for state machine to process tool call
			await new Promise((r) => setTimeout(r, 200));

			engine.stop();

			expect(toolAdapter.callTool).toHaveBeenCalledWith("read_file", { path: "/test.txt" });
		});

		it("should gracefully handle context assembly failure", async () => {
			mockGenerateText.mockResolvedValue({
				text: "I'll do my best without context.",
				toolCalls: [],
				finishReason: "stop",
			} as any);

			const contextAssembler = createMockContextAssembler();
			contextAssembler.assembleContext.mockRejectedValue(new Error("Context failed"));

			const toolAdapter = createMockToolAdapter();

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-1", "Test");

			// Wait for state machine to process and recover
			await new Promise((r) => setTimeout(r, 150));

			engine.stop();

			// Should still call generateText (graceful degradation)
			expect(mockGenerateText).toHaveBeenCalled();
		});

		it("should handle tool listing failure gracefully", async () => {
			mockGenerateText.mockResolvedValue({
				text: "Response without tools",
				toolCalls: [],
				finishReason: "stop",
			} as any);

			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();
			toolAdapter.listTools.mockRejectedValue(new Error("Tool listing failed"));

			const engine = new DecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			engine.start();
			await engine.handleInput("session-1", "Test");

			// Wait for state machine to process
			await new Promise((r) => setTimeout(r, 100));

			engine.stop();

			// Should still generate response (with cached/empty tools)
			expect(mockGenerateText).toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("createDecisionEngine factory", () => {
		it("should create a DecisionEngine instance", () => {
			const engine = createDecisionEngine({
				contextAssembler: createMockContextAssembler() as any,
				toolAdapter: createMockToolAdapter() as any,
			});

			expect(engine).toBeInstanceOf(DecisionEngine);
		});

		it("should pass all dependencies to constructor", () => {
			const contextAssembler = createMockContextAssembler();
			const toolAdapter = createMockToolAdapter();

			const engine = createDecisionEngine({
				contextAssembler: contextAssembler as any,
				toolAdapter: toolAdapter as any,
				logger: mockLogger as any,
			});

			expect(engine).toBeInstanceOf(DecisionEngine);

			// Verify it works
			engine.start();
			engine.stop();
		});
	});
});
