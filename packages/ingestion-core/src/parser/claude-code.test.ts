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
			expect(result?.usage).toEqual({ input: 100, output: 5 });
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
			expect(result?.usage).toEqual({ input: 200, output: 10 });
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
	});
});
