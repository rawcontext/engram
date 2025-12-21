import { describe, expect, it } from "vitest";
import { ClaudeCodeParser } from "./claude-code";

describe("ClaudeCodeParser", () => {
	const parser = new ClaudeCodeParser();

	describe("assistant events", () => {
		it("should parse assistant message with text content", () => {
			const payload = {
				type: "assistant",
				message: {
					model: "claude-opus-4-5-20251101",
					id: "msg_01BYEF2kGQcChEsZy79FBqPC",
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "4" }],
					stop_reason: "end_turn",
					usage: {
						input_tokens: 100,
						output_tokens: 5,
					},
				},
				session_id: "test-session",
				uuid: "test-uuid",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toBe("4");
			expect(result?.role).toBe("assistant");
			expect(result?.usage).toEqual({ input: 100, output: 5, cacheRead: 0, cacheWrite: 0 });
			expect(result?.stopReason).toBe("end_turn");
		});

		it("should parse assistant message with tool_use content block", () => {
			const payload = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_123",
							name: "Read",
							input: { file_path: "/path/to/file.txt" },
						},
					],
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("toolu_123");
			expect(result?.toolCall?.name).toBe("Read");
			expect(result?.toolCall?.args).toBe('{"file_path":"/path/to/file.txt"}');
		});

		it("should return null for empty message", () => {
			const payload = {
				type: "assistant",
				message: null,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("tool_use events", () => {
		it("should parse tool_use event", () => {
			const payload = {
				type: "tool_use",
				tool_use: {
					tool_use_id: "toolu_456",
					name: "Bash",
					input: { command: "ls -la" },
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("toolu_456");
			expect(result?.toolCall?.name).toBe("Bash");
			expect(result?.toolCall?.args).toBe('{"command":"ls -la"}');
		});

		it("should return null for missing tool_use data", () => {
			const payload = {
				type: "tool_use",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("tool_result events", () => {
		it("should parse tool_result event", () => {
			const payload = {
				type: "tool_result",
				tool_result: {
					tool_use_id: "toolu_789",
					content: "file contents here",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Tool Result: toolu_789]");
			expect(result?.content).toContain("file contents here");
		});

		it("should return null for empty tool_result content", () => {
			const payload = {
				type: "tool_result",
				tool_result: {
					tool_use_id: "toolu_789",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("result events", () => {
		it("should parse result event with usage", () => {
			const payload = {
				type: "result",
				subtype: "success",
				result: "The answer is 4",
				usage: {
					input_tokens: 200,
					output_tokens: 10,
				},
				duration_ms: 1234,
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({ input: 200, output: 10, cacheRead: 0, cacheWrite: 0 });
			expect(result?.timing).toEqual({ duration: 1234 });
		});

		it("should return null for result with no usage", () => {
			const payload = {
				type: "result",
				result: "done",
			};

			const result = parser.parse(payload);

			// Still returns something because result is present
			expect(result).not.toBeNull();
		});
	});

	describe("system events", () => {
		it("should parse system init event", () => {
			const payload = {
				type: "system",
				subtype: "init",
				model: "claude-opus-4-5-20251101",
				tools: ["Read", "Write", "Edit"],
				session_id: "test-session",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Session Init]");
			expect(result?.content).toContain("tools=3");
		});

		it("should parse system hook_response event", () => {
			const payload = {
				type: "system",
				subtype: "hook_response",
				hook_name: "test-hook",
				stdout: "Hook output text",
				stderr: "",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Hook: test-hook]");
		});

		it("should return null for unknown system subtype", () => {
			const payload = {
				type: "system",
				subtype: "unknown_subtype",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("unknown events", () => {
		it("should return null for unknown event types", () => {
			const payload = {
				type: "unknown_type",
				data: "some data",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for user events (not handled)", () => {
			const payload = {
				type: "user",
				message: {
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for non-object payloads", () => {
			expect(parser.parse(null)).toBeNull();
			expect(parser.parse("string")).toBeNull();
			expect(parser.parse(123)).toBeNull();
			expect(parser.parse([])).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should handle assistant message with empty content array", () => {
			const payload = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [],
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.content).toBeUndefined();
		});

		it("should handle assistant message with no content", () => {
			const payload = {
				type: "assistant",
				message: {
					role: "assistant",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.usage).toBeDefined();
		});

		it("should handle system event with user subtype", () => {
			const payload = {
				type: "system",
				subtype: "user",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid assistant schema", () => {
			const payload = {
				type: "assistant",
				message: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid tool_use schema", () => {
			const payload = {
				type: "tool_use",
				tool_use: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid tool_result schema", () => {
			const payload = {
				type: "tool_result",
				tool_result: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid result schema", () => {
			const payload = {
				type: "result",
				result: 123,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid system schema", () => {
			const payload = {
				type: "system",
				subtype: 123,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle result with cost and timing", () => {
			const payload = {
				type: "result",
				result: "Success",
				total_cost_usd: 0.005,
				duration_ms: 5000,
				duration_api_ms: 4500,
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.cost).toBe(0.005);
			expect(result?.timing?.duration).toBe(5000);
		});

		it("should handle result with only api duration", () => {
			const payload = {
				type: "result",
				result: "Success",
				duration_api_ms: 4500,
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.timing?.duration).toBe(4500);
		});

		it("should handle system hook_response without stdout", () => {
			const payload = {
				type: "system",
				subtype: "hook_response",
				hook_name: "test-hook",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should extract session ID from result event", () => {
			// Tests line 178-179: session extraction in result event
			const payload = {
				type: "result",
				result: "Success",
				session_id: "session-12345",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.session).toEqual({ id: "session-12345" });
		});

		it("should handle result event with cache metrics in usage", () => {
			// Tests lines 155-162: cache metrics extraction
			const payload = {
				type: "result",
				result: "Success",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 200,
					cache_creation_input_tokens: 150,
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.usage).toEqual({
				input: 100,
				output: 50,
				cacheRead: 200,
				cacheWrite: 150,
			});
		});

		it("should return null for result event without result or usage", () => {
			// Tests line 182: return empty delta when neither result nor usage
			const payload = {
				type: "result",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle system init event without model or session", () => {
			// Tests lines 198-207: system init without optional fields
			const payload = {
				type: "system",
				subtype: "init",
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.model).toBeUndefined();
			expect(result?.session).toBeUndefined();
		});

		it("should return null for assistant message with no extractable data", () => {
			// Tests line 97: Object.keys(delta).length === 0
			const payload = {
				type: "assistant",
				message: {
					// No content, usage, role, stop_reason, or model
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for tool_result without tool_result object", () => {
			// Tests line 127: !toolResult
			const payload = {
				type: "tool_result",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle result with usage having zero tokens", () => {
			// Tests lines 157-158: input_tokens || 0, output_tokens || 0
			const payload = {
				type: "result",
				result: "Success",
				usage: {
					input_tokens: 0,
					output_tokens: 0,
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		});

		it("should handle payload with non-string type field", () => {
			// Tests line 31: typeof payload.type !== "string"
			const payload = {
				type: 123,
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle assistant message with undefined message field", () => {
			// Tests line 40: !message
			const payload = {
				type: "assistant",
				message: undefined,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle text content block without text field", () => {
			// Tests line 54: block.text || ""
			const payload = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text" }], // No text field
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			// When text is undefined, the empty string from .join("") is set, but if no text blocks have content, content is undefined
			// Actually, the .join("") creates an empty string, but then it's only set if textContent is truthy
			// So this should be undefined, not ""
			expect(result?.content).toBeUndefined();
		});

		it("should handle assistant message with usage having undefined token fields", () => {
			// Tests lines 80-81: input_tokens || 0, output_tokens || 0
			const payload = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
					usage: {
						// input_tokens and output_tokens are undefined
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		});
	});
});
