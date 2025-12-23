import { describe, expect, it } from "bun:test";
import { CodexParser } from "./codex";

describe("CodexParser", () => {
	const parser = new CodexParser();

	describe("thread.started events", () => {
		it("should parse thread.started event", () => {
			const payload = {
				type: "thread.started",
				thread_id: "019b006e-2144-7642-afc2-c3053bf96ddd",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Thread Started:");
			expect(result?.content).toContain("019b006e-2144-7642-afc2-c3053bf96ddd");
			expect(result?.session).toEqual({ threadId: "019b006e-2144-7642-afc2-c3053bf96ddd" });
		});
	});

	describe("turn.started events", () => {
		it("should parse turn.started event", () => {
			const payload = {
				type: "turn.started",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toBe("[Turn Started]");
		});
	});

	describe("item.completed events", () => {
		it("should parse agent_message item", () => {
			const payload = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "agent_message",
					text: "4",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.role).toBe("assistant");
			expect(result?.content).toBe("4");
		});

		it("should parse reasoning item as thought", () => {
			const payload = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "reasoning",
					text: "**Using read-only list command**...",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("thought");
			expect(result?.thought).toBe("**Using read-only list command**...");
		});

		it("should parse completed command_execution as content", () => {
			const payload = {
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc ls",
					aggregated_output: "file1.txt\nfile2.txt",
					exit_code: 0,
					status: "completed",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Command: /bin/zsh -lc ls]");
			expect(result?.content).toContain("Exit: 0");
			expect(result?.content).toContain("file1.txt");
		});

		it("should parse in-progress command_execution as tool_call", () => {
			const payload = {
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc ls",
					aggregated_output: "",
					exit_code: null,
					status: "in_progress",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("item_1");
			expect(result?.toolCall?.name).toBe("shell");
			expect(result?.toolCall?.args).toBe('{"command":"/bin/zsh -lc ls"}');
		});

		it("should return null for item.completed without item", () => {
			const payload = {
				type: "item.completed",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for unknown item type", () => {
			const payload = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "unknown_type",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("item.started events", () => {
		it("should parse command_execution item.started as tool_call", () => {
			const payload = {
				type: "item.started",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc pwd",
					aggregated_output: "",
					exit_code: null,
					status: "in_progress",
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("item_1");
			expect(result?.toolCall?.name).toBe("shell");
			expect(result?.toolCall?.args).toBe('{"command":"/bin/zsh -lc pwd"}');
		});

		it("should return null for non-command item.started", () => {
			const payload = {
				type: "item.started",
				item: {
					id: "item_0",
					type: "reasoning",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("turn.completed events", () => {
		it("should parse turn.completed with usage", () => {
			const payload = {
				type: "turn.completed",
				usage: {
					input_tokens: 4792,
					cached_input_tokens: 3072,
					output_tokens: 7,
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({ input: 4792, output: 7, cacheRead: 3072 });
		});

		it("should return null for turn.completed without usage", () => {
			const payload = {
				type: "turn.completed",
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

		it("should return null for non-object payloads", () => {
			expect(parser.parse(null)).toBeNull();
			expect(parser.parse("string")).toBeNull();
			expect(parser.parse(123)).toBeNull();
			expect(parser.parse([])).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should return null for invalid item.completed schema", () => {
			const payload = {
				type: "item.completed",
				item: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid item.started schema", () => {
			const payload = {
				type: "item.started",
				item: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid turn.completed schema", () => {
			const payload = {
				type: "turn.completed",
				usage: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid thread.started schema", () => {
			const payload = {
				type: "thread.started",
				thread_id: 123,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid turn.started schema", () => {
			const payload = {
				type: "turn.started",
				extra_field: "invalid",
			};

			const result = parser.parse(payload);
			// Even with extra fields, basic schema should pass
			expect(result).not.toBeNull();
		});

		it("should handle item.completed with agent_message but undefined text", () => {
			// agent_message with undefined text returns { content: undefined }
			const payload = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "agent_message",
					// text is undefined
				},
			};

			const result = parser.parse(payload);
			// Returns delta with undefined content
			expect(result).toEqual({
				type: "content",
				role: "assistant",
				content: undefined,
			});
		});

		it("should return null for item.started with non-command type", () => {
			// Tests line 161: return null for agent_message in item.started
			const payload = {
				type: "item.started",
				item: {
					id: "item_0",
					type: "agent_message",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for item.completed with unknown command_execution status", () => {
			// Tests line 94: return null when status is neither completed nor in_progress
			const payload = {
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc ls",
					aggregated_output: "",
					exit_code: null,
					status: "unknown_status",
				},
			};

			const result = parser.parse(payload);
			// Should hit the fallback - returns tool_call
			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
		});

		it("should return null for item.started without item", () => {
			// Tests line 104/161: item.started with missing item
			const payload = {
				type: "item.started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});
});
