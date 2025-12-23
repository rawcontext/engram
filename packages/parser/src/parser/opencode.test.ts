import { describe, expect, it } from "bun:test";
import { OpenCodeParser } from "./opencode";

describe("OpenCodeParser", () => {
	const parser = new OpenCodeParser();

	describe("text events", () => {
		it("should parse text event with content", () => {
			const payload = {
				type: "text",
				timestamp: 1765239707589,
				sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
				part: {
					id: "prt_b007c57bf0018R7z4L334TKoL9",
					sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
					messageID: "msg_b007c473e001oQ8P3p5GFXp3lR",
					type: "text",
					text: "4",
					time: { start: 1765239707585, end: 1765239707585 },
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.role).toBe("assistant");
			expect(result?.content).toBe("4");
		});

		it("should parse multi-line text", () => {
			const payload = {
				type: "text",
				timestamp: 1765239736493,
				sessionID: "ses_4ff83552fffep7Wo0sG5WWQ16W",
				part: {
					type: "text",
					text: "The current directory contains:\n*   **Files:** README.md\n*   **Directories:** apps/",
					time: { start: 1765239736491, end: 1765239736491 },
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.content).toContain("README.md");
			expect(result?.content).toContain("apps/");
		});

		it("should return null for empty text", () => {
			const payload = {
				type: "text",
				timestamp: 1765239707589,
				sessionID: "ses_test",
				part: {
					type: "text",
					text: "",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for missing part", () => {
			const payload = {
				type: "text",
				timestamp: 1765239707589,
				sessionID: "ses_test",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("tool_use events", () => {
		it("should parse tool_use event with bash tool", () => {
			const payload = {
				type: "tool_use",
				timestamp: 1765239733333,
				sessionID: "ses_4ff83552fffep7Wo0sG5WWQ16W",
				part: {
					id: "prt_b007cbc2b001ROZzuct0GsK1wB",
					sessionID: "ses_4ff83552fffep7Wo0sG5WWQ16W",
					messageID: "msg_b007caaea001t7ReqfQAHTiLf2",
					type: "tool",
					callID: "GlouLMGVZLPNsUaL",
					tool: "bash",
					state: {
						status: "completed",
						input: {
							description: "List files in the current directory",
							command: "ls -F",
						},
						output: "AGENTS.md\napps/\nbiome.json\n",
						title: "List files in the current directory",
					},
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("GlouLMGVZLPNsUaL");
			expect(result?.toolCall?.name).toBe("bash");
			expect(result?.toolCall?.args).toContain("ls -F");
			expect(result?.toolCall?.args).toContain("List files in the current directory");
		});

		it("should handle tool_use without input", () => {
			const payload = {
				type: "tool_use",
				timestamp: 1765239733333,
				sessionID: "ses_test",
				part: {
					type: "tool",
					callID: "test-call-id",
					tool: "some_tool",
					state: {
						status: "completed",
					},
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.toolCall?.args).toBe("{}");
		});

		it("should return null for missing part", () => {
			const payload = {
				type: "tool_use",
				timestamp: 1765239733333,
				sessionID: "ses_test",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("step_finish events", () => {
		it("should parse step_finish with token usage", () => {
			const payload = {
				type: "step_finish",
				timestamp: 1765239707611,
				sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
				part: {
					id: "prt_b007c57c3001jzAx3id2i7Cuya",
					sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
					messageID: "msg_b007c473e001oQ8P3p5GFXp3lR",
					type: "step-finish",
					reason: "stop",
					snapshot: "1367efd5cc155116e36e75903033888058819df1",
					cost: 0.0122134,
					tokens: {
						input: 4794,
						output: 1,
						reasoning: 82,
						cache: { read: 8147, write: 0 },
					},
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({
				input: 4794,
				output: 1,
				reasoning: 82,
				cacheRead: 8147,
				cacheWrite: 0,
			});
			expect(result?.cost).toBe(0.0122134);
			expect(result?.gitSnapshot).toBe("1367efd5cc155116e36e75903033888058819df1");
			expect(result?.stopReason).toBe("stop");
		});

		it("should return null for step_finish without tokens", () => {
			const payload = {
				type: "step_finish",
				timestamp: 1765239707611,
				sessionID: "ses_test",
				part: {
					type: "step-finish",
					reason: "stop",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for zero token counts", () => {
			const payload = {
				type: "step_finish",
				timestamp: 1765239707611,
				sessionID: "ses_test",
				part: {
					type: "step-finish",
					reason: "stop",
					tokens: {
						input: 0,
						output: 0,
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("step_start events", () => {
		it("should return null for step_start events", () => {
			const payload = {
				type: "step_start",
				timestamp: 1765239707071,
				sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
				part: {
					id: "prt_b007c55bd001a0J0uGWLPmJuX4",
					sessionID: "ses_4ff83b8ddffeSi0vH5k6KmdnDu",
					messageID: "msg_b007c473e001oQ8P3p5GFXp3lR",
					type: "step-start",
					snapshot: "1367efd5cc155116e36e75903033888058819df1",
				},
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
		it("should handle text event without timing", () => {
			const payload = {
				type: "text",
				sessionID: "ses_test",
				part: {
					type: "text",
					text: "Hello",
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.content).toBe("Hello");
			expect(result?.timing).toBeUndefined();
		});

		it("should handle text event without session info", () => {
			const payload = {
				type: "text",
				part: {
					type: "text",
					text: "Hello",
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.content).toBe("Hello");
			expect(result?.session).toBeUndefined();
		});

		it("should handle step_finish with minimal fields", () => {
			const payload = {
				type: "step_finish",
				sessionID: "ses_test",
				part: {
					type: "step-finish",
					tokens: {
						input: 100,
						output: 50,
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.usage).toEqual({
				input: 100,
				output: 50,
				reasoning: 0,
				cacheRead: undefined,
				cacheWrite: undefined,
			});
			expect(result?.cost).toBeUndefined();
			expect(result?.gitSnapshot).toBeUndefined();
		});

		it("should handle invalid text event schema", () => {
			const payload = {
				type: "text",
				timestamp: "invalid",
				part: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle invalid tool_use event schema", () => {
			const payload = {
				type: "tool_use",
				timestamp: "invalid",
				part: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle invalid step_finish event schema", () => {
			const payload = {
				type: "step_finish",
				timestamp: "invalid",
				part: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle invalid step_start event schema", () => {
			const payload = {
				type: "step_start",
				timestamp: "invalid",
				part: "invalid",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle tool_use with missing callID", () => {
			// Tests line 94: callID || ""
			const payload = {
				type: "tool_use",
				sessionID: "ses_test",
				part: {
					type: "tool",
					tool: "bash",
					state: {
						status: "completed",
						input: { command: "ls" },
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.toolCall?.id).toBe("");
		});

		it("should handle tool_use with missing tool name", () => {
			// Tests line 95: tool || ""
			const payload = {
				type: "tool_use",
				sessionID: "ses_test",
				part: {
					type: "tool",
					callID: "call-123",
					state: {
						status: "completed",
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.toolCall?.name).toBe("");
		});

		it("should handle step_finish without part", () => {
			// Tests line 110: if (!part) return null
			const payload = {
				type: "step_finish",
				sessionID: "ses_test",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle step_finish with session info extraction", () => {
			// Tests lines 149-158: session info extraction in step_finish
			const payload = {
				type: "step_finish",
				sessionID: "ses_test",
				part: {
					id: "prt_test",
					messageID: "msg_test",
					type: "step-finish",
					tokens: {
						input: 100,
						output: 50,
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.session).toEqual({
				id: "ses_test",
				messageId: "msg_test",
				partId: "prt_test",
			});
		});

		it("should handle text event with all session info fields", () => {
			// Tests lines 60-69: session info extraction with all fields
			const payload = {
				type: "text",
				sessionID: "ses_test",
				part: {
					id: "prt_test",
					messageID: "msg_test",
					type: "text",
					text: "Hello",
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.session).toEqual({
				id: "ses_test",
				messageId: "msg_test",
				partId: "prt_test",
			});
		});

		it("should handle payload with non-string type field", () => {
			// Tests line 29: typeof payload.type !== "string"
			const payload = {
				type: 123,
				part: {
					type: "text",
					text: "Hello",
				},
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle step_finish without session info", () => {
			// Tests line 152: when sessionID, messageID, and partId are all falsy
			const payload = {
				type: "step_finish",
				part: {
					type: "step-finish",
					tokens: {
						input: 100,
						output: 50,
					},
				},
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.session).toBeUndefined();
		});
	});
});
