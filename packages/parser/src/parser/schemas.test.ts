import { describe, expect, it } from "vitest";
import {
	parseAnthropicEvent,
	parseClaudeCodeEvent,
	parseClineEvent,
	parseCodexEvent,
	parseGeminiEvent,
	parseOpenAIChunk,
	parseOpenCodeEvent,
	parseXAIChunk,
} from "./schemas";

describe("Schema Helper Functions", () => {
	describe("parseAnthropicEvent", () => {
		it("should successfully parse valid Anthropic event", () => {
			const event = {
				type: "message_start",
				message: {
					usage: { input_tokens: 100 },
				},
			};
			const result = parseAnthropicEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("message_start");
			}
		});

		it("should fail to parse invalid Anthropic event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseAnthropicEvent(event);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeDefined();
			}
		});
	});

	describe("parseOpenAIChunk", () => {
		it("should successfully parse valid OpenAI chunk", () => {
			const chunk = {
				id: "chatcmpl-123",
				object: "chat.completion.chunk",
				choices: [{ delta: { content: "Hello" } }],
			};
			const result = parseOpenAIChunk(chunk);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe("chatcmpl-123");
			}
		});

		it("should pass lenient parsing for OpenAI chunk", () => {
			// OpenAI schema is very permissive with all optional fields
			const chunk = {
				invalid: "structure",
			};
			const result = parseOpenAIChunk(chunk);
			// Schema passes because all fields are optional
			expect(result.success).toBe(true);
		});
	});

	describe("parseXAIChunk", () => {
		it("should successfully parse valid xAI chunk", () => {
			const chunk = {
				id: "chatcmpl-123",
				choices: [{ delta: { reasoning_content: "Thinking..." } }],
			};
			const result = parseXAIChunk(chunk);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.choices?.[0]?.delta?.reasoning_content).toBe("Thinking...");
			}
		});

		it("should pass lenient parsing for xAI chunk", () => {
			// xAI schema extends OpenAI which is very permissive
			const chunk = {
				invalid: "structure",
			};
			const result = parseXAIChunk(chunk);
			// Schema passes because all fields are optional
			expect(result.success).toBe(true);
		});
	});

	describe("parseClaudeCodeEvent", () => {
		it("should successfully parse valid Claude Code event", () => {
			const event = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello" }],
				},
			};
			const result = parseClaudeCodeEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("assistant");
			}
		});

		it("should fail to parse invalid Claude Code event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseClaudeCodeEvent(event);
			expect(result.success).toBe(false);
		});
	});

	describe("parseGeminiEvent", () => {
		it("should successfully parse valid Gemini event", () => {
			const event = {
				type: "init",
				session_id: "test-session",
				model: "auto",
			};
			const result = parseGeminiEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("init");
			}
		});

		it("should fail to parse invalid Gemini event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseGeminiEvent(event);
			expect(result.success).toBe(false);
		});
	});

	describe("parseCodexEvent", () => {
		it("should successfully parse valid Codex event", () => {
			const event = {
				type: "thread.started",
				thread_id: "test-thread",
			};
			const result = parseCodexEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("thread.started");
			}
		});

		it("should fail to parse invalid Codex event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseCodexEvent(event);
			expect(result.success).toBe(false);
		});
	});

	describe("parseClineEvent", () => {
		it("should successfully parse valid Cline event", () => {
			const event = {
				type: "say",
				say: "text",
				text: "Hello",
			};
			const result = parseClineEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("say");
			}
		});

		it("should fail to parse invalid Cline event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseClineEvent(event);
			expect(result.success).toBe(false);
		});
	});

	describe("parseOpenCodeEvent", () => {
		it("should successfully parse valid OpenCode event", () => {
			const event = {
				type: "text",
				part: {
					type: "text",
					text: "Hello",
				},
			};
			const result = parseOpenCodeEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("text");
			}
		});

		it("should fail to parse invalid OpenCode event", () => {
			const event = {
				type: "invalid_type",
			};
			const result = parseOpenCodeEvent(event);
			expect(result.success).toBe(false);
		});
	});
});
