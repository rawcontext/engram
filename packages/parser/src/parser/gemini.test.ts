import { describe, expect, it } from "vitest";
import { GeminiParser } from "./gemini";

describe("GeminiParser", () => {
	const parser = new GeminiParser();

	describe("init events", () => {
		it("should parse init event", () => {
			const payload = {
				type: "init",
				timestamp: "2025-12-09T00:13:15.893Z",
				session_id: "34ba2452-a37c-4ebf-84ad-1b61b7ca6297",
				model: "auto",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain("[Session Init]");
			expect(result?.content).toContain("model=auto");
			expect(result?.content).toContain("session_id=34ba2452-a37c-4ebf-84ad-1b61b7ca6297");
			expect(result?.model).toBe("auto");
			expect(result?.session).toEqual({ id: "34ba2452-a37c-4ebf-84ad-1b61b7ca6297" });
		});
	});

	describe("message events", () => {
		it("should parse assistant message", () => {
			const payload = {
				type: "message",
				timestamp: "2025-12-09T00:13:18.433Z",
				role: "assistant",
				content: "4",
				delta: true,
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.role).toBe("assistant");
			expect(result?.content).toBe("4");
		});

		it("should skip user messages", () => {
			const payload = {
				type: "message",
				timestamp: "2025-12-09T00:13:15.893Z",
				role: "user",
				content: "What is 2+2?",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for empty content", () => {
			const payload = {
				type: "message",
				timestamp: "2025-12-09T00:13:18.433Z",
				role: "assistant",
				content: "",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("tool_use events", () => {
		it("should parse tool_use event", () => {
			const payload = {
				type: "tool_use",
				timestamp: "2025-12-09T00:13:37.764Z",
				tool_name: "list_directory",
				tool_id: "list_directory-1765239217764-b5bcb64ac480c",
				parameters: { dir_path: "." },
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("tool_call");
			expect(result?.toolCall?.id).toBe("list_directory-1765239217764-b5bcb64ac480c");
			expect(result?.toolCall?.name).toBe("list_directory");
			expect(result?.toolCall?.args).toBe('{"dir_path":"."}');
		});

		it("should handle tool_use without parameters", () => {
			const payload = {
				type: "tool_use",
				timestamp: "2025-12-09T00:13:37.764Z",
				tool_name: "some_tool",
				tool_id: "tool-123",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.toolCall?.args).toBe("{}");
		});
	});

	describe("tool_result events", () => {
		it("should parse tool_result event with output", () => {
			const payload = {
				type: "tool_result",
				timestamp: "2025-12-09T00:13:37.793Z",
				tool_id: "list_directory-1765239217764-b5bcb64ac480c",
				status: "success",
				output: "Listed 22 item(s). (4 ignored)",
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("content");
			expect(result?.content).toContain(
				"[Tool Result: list_directory-1765239217764-b5bcb64ac480c]",
			);
			expect(result?.content).toContain("(success)");
			expect(result?.content).toContain("Listed 22 item(s)");
		});

		it("should return null for tool_result without output", () => {
			const payload = {
				type: "tool_result",
				timestamp: "2025-12-09T00:13:37.793Z",
				tool_id: "tool-123",
				status: "success",
			};

			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	describe("result events", () => {
		it("should parse result event with stats", () => {
			const payload = {
				type: "result",
				timestamp: "2025-12-09T00:13:18.434Z",
				status: "success",
				stats: {
					total_tokens: 12831,
					input_tokens: 12592,
					output_tokens: 48,
					duration_ms: 2541,
					tool_calls: 0,
				},
			};

			const result = parser.parse(payload);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("usage");
			expect(result?.usage).toEqual({ input: 12592, output: 48, total: 12831 });
			expect(result?.timing).toEqual({ duration: 2541 });
			expect(result?.stopReason).toBe("success");
		});

		it("should return null for result without stats", () => {
			const payload = {
				type: "result",
				timestamp: "2025-12-09T00:13:18.434Z",
				status: "success",
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
	});
});
