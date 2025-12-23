import { describe, expect, it } from "bun:test";
import { ClineParser } from "./cline";

describe("ClineParser", () => {
	const parser = new ClineParser();

	describe("text events", () => {
		it("should parse text event with content", () => {
			const payload = {
				type: "say",
				text: "What is 2+2? Just reply with the number.",
				ts: 1765240685121,
				say: "text",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.role).toBe("assistant");
			expect(result?.content).toBe("What is 2+2? Just reply with the number.");
		});

		it("should parse multi-line text", () => {
			const payload = {
				type: "say",
				text: "The current directory contains:\n*   **Files:** README.md\n*   **Directories:** apps/",
				ts: 1765239736493,
				say: "text",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.content).toContain("README.md");
			expect(result?.content).toContain("apps/");
		});

		it("should return null for empty text", () => {
			const payload = {
				type: "say",
				text: "",
				ts: 1765240685121,
				say: "text",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for missing text field", () => {
			const payload = {
				type: "say",
				ts: 1765240685121,
				say: "text",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("api_req_started events", () => {
		it("should parse api_req_started with token usage", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					request: "<task>Test task</task>",
					tokensIn: 10,
					tokensOut: 210,
					cacheWrites: 2670,
					cacheReads: 7982,
					cost: 0,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({ input: 10, output: 210, cacheRead: 7982, cacheWrite: 2670 });
		});

		it("should return null for zero token counts", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					request: "<task>Test task</task>",
					tokensIn: 0,
					tokensOut: 0,
					cost: 0,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid JSON text", () => {
			const payload = {
				type: "say",
				text: "not valid json",
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for missing text field", () => {
			const payload = {
				type: "say",
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("api_req_finished events", () => {
		it("should parse api_req_finished with token usage", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 500,
					tokensOut: 150,
					cost: 0.001,
				}),
				ts: 1765240790000,
				say: "api_req_finished",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({ input: 500, output: 150, cacheRead: 0, cacheWrite: 0 });
			expect(result?.cost).toBe(0.001);
		});
	});

	describe("tool events", () => {
		it("should parse tool event with input", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					id: "tool-123",
					tool: "read_file",
					input: {
						path: "/test/file.ts",
					},
				}),
				ts: 1765240785741,
				say: "tool",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("tool-123");
			expect(result?.toolCall?.name).toBe("read_file");
			expect(result?.toolCall?.args).toContain("/test/file.ts");
		});

		it("should handle tool event without input", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					id: "tool-456",
					tool: "list_files",
				}),
				ts: 1765240785741,
				say: "tool",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.toolCall?.args).toBe("{}");
		});

		it("should return null for invalid tool JSON", () => {
			const payload = {
				type: "say",
				text: "not valid json",
				ts: 1765240785741,
				say: "tool",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("checkpoint events", () => {
		it("should return null for checkpoint_created events", () => {
			const payload = {
				type: "say",
				text: "",
				ts: 1765240688497,
				say: "checkpoint_created",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("unknown events", () => {
		it("should return null for non-say type events", () => {
			const payload = {
				type: "other",
				data: "some data",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for unknown say subtypes", () => {
			const payload = {
				type: "say",
				text: "some text",
				ts: 1765240688497,
				say: "unknown_subtype",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for invalid schema", () => {
			const payload = {
				type: "say",
				say: 123,
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should handle api_req_started with cost but no tokens", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 0,
					tokensOut: 0,
					cost: 0.001,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle api_req_started with zero cost", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 100,
					tokensOut: 50,
					cost: 0,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.cost).toBeUndefined();
		});

		it("should handle api_req_finished with zero cost", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 100,
					tokensOut: 50,
					cost: 0,
				}),
				ts: 1765240790000,
				say: "api_req_finished",
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.cost).toBeUndefined();
		});

		it("should handle api_req_started with failed schema validation", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: "invalid",
					tokensOut: 50,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle api_req_finished with failed schema validation", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: "invalid",
					tokensOut: 50,
				}),
				ts: 1765240790000,
				say: "api_req_finished",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle tool event with failed schema validation", () => {
			const payload = {
				type: "say",
				text: JSON.stringify({
					id: 123,
					tool: "some_tool",
				}),
				ts: 1765240785741,
				say: "tool",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null when say type is not handled", () => {
			// Tests line 30: when data.type === "say" but sayType doesn't match known types
			const payload = {
				type: "say",
				text: "Some text",
				ts: 1765240785741,
				say: "unknown_say_type",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should extract cost when present and non-zero in api_req_started", () => {
			// Tests lines 77-79: cost extraction branch
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 100,
					tokensOut: 50,
					cost: 0.005,
				}),
				ts: 1765240785741,
				say: "api_req_started",
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.cost).toBe(0.005);
		});

		it("should extract cost when present and non-zero in api_req_finished", () => {
			// Tests lines 118-120: cost extraction branch in api_req_finished
			const payload = {
				type: "say",
				text: JSON.stringify({
					tokensIn: 100,
					tokensOut: 50,
					cost: 0.005,
				}),
				ts: 1765240790000,
				say: "api_req_finished",
			};

			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.cost).toBe(0.005);
		});
	});
});
