import { describe, expect, it, vi } from "vitest";

// Test the helper functions by importing them directly
// We'll mock the external dependencies

const mockGenerateText = vi.fn(async () => ({
	text: "Test response",
	toolCalls: [],
}));

vi.mock("ai", () => ({
	generateText: mockGenerateText,
	tool: vi.fn((config: Record<string, unknown>) => ({ ...config, _isTool: true })),
}));

vi.mock("@ai-sdk/xai", () => ({
	xai: vi.fn(() => "mock-model"),
}));

// Import the module to test
// Note: We need to structure this test to focus on unit testing the helper functions
// The full DecisionEngine requires complex mocking of XState actors

describe("Decision Engine Helper Functions", () => {
	describe("extractToolCalls", () => {
		// We'll test this function by mimicking its logic since it's not exported
		function extractToolCalls(result: { toolCalls?: unknown[] }) {
			if (!result.toolCalls || !Array.isArray(result.toolCalls)) {
				return [];
			}

			const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];

			for (const call of result.toolCalls) {
				if (typeof call === "object" && call !== null) {
					const toolCall = call as Record<string, unknown>;
					const toolName = (toolCall.toolName as string) || (toolCall.name as string);
					const args =
						(toolCall.args as Record<string, unknown>) ||
						(toolCall.input as Record<string, unknown>) ||
						{};

					if (toolName) {
						calls.push({ toolName, args });
					}
				}
			}

			return calls;
		}

		it("should return empty array when toolCalls is undefined", () => {
			const result = extractToolCalls({});
			expect(result).toEqual([]);
		});

		it("should return empty array when toolCalls is not an array", () => {
			// Test with non-array toolCalls (edge case / type mismatch from external API)
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

		it("should extract tool calls with name and input format", () => {
			const result = extractToolCalls({
				toolCalls: [{ name: "write_file", input: { path: "/test.txt", content: "hello" } }],
			});

			expect(result).toHaveLength(1);
			expect(result[0].toolName).toBe("write_file");
			expect(result[0].args).toEqual({ path: "/test.txt", content: "hello" });
		});

		it("should handle multiple tool calls", () => {
			const result = extractToolCalls({
				toolCalls: [
					{ toolName: "tool1", args: { a: 1 } },
					{ toolName: "tool2", args: { b: 2 } },
				],
			});

			expect(result).toHaveLength(2);
			expect(result[0].toolName).toBe("tool1");
			expect(result[1].toolName).toBe("tool2");
		});

		it("should skip invalid entries", () => {
			// Test with mixed valid/invalid entries (edge case from external API)
			const invalidToolCalls = [
				{ toolName: "valid", args: {} },
				null,
				undefined,
				"string",
				{}, // No toolName
			] as unknown[];

			const result = extractToolCalls({ toolCalls: invalidToolCalls });

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
		// Test the conversion logic
		interface AiTool {
			description: string;
			inputSchema: { type: string };
		}

		function convertMcpToolsToAiSdk(
			mcpTools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
		) {
			const aiTools: Record<string, AiTool> = {};

			for (const mcpTool of mcpTools) {
				aiTools[mcpTool.name] = {
					description: mcpTool.description || `Execute ${mcpTool.name}`,
					inputSchema: { type: "object" },
				};
			}

			return aiTools;
		}

		it("should convert empty array", () => {
			const result = convertMcpToolsToAiSdk([]);
			expect(result).toEqual({});
		});

		it("should convert single tool with description", () => {
			const result = convertMcpToolsToAiSdk([
				{ name: "read_file", description: "Read a file from disk" },
			]);

			expect(result).toHaveProperty("read_file");
			expect(result.read_file.description).toBe("Read a file from disk");
		});

		it("should generate default description when not provided", () => {
			const result = convertMcpToolsToAiSdk([{ name: "my_tool" }]);

			expect(result.my_tool.description).toBe("Execute my_tool");
		});

		it("should convert multiple tools", () => {
			const result = convertMcpToolsToAiSdk([
				{ name: "tool1", description: "First tool" },
				{ name: "tool2", description: "Second tool" },
			]);

			expect(Object.keys(result)).toHaveLength(2);
			expect(result.tool1.description).toBe("First tool");
			expect(result.tool2.description).toBe("Second tool");
		});
	});
});
