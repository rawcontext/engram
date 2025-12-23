import { describe, expect, it } from "bun:test";
import { OpenAIParser } from "./openai";

describe("OpenAIParser", () => {
	const parser = new OpenAIParser();

	// ============================================================================
	// Basic Content Parsing
	// ============================================================================

	describe("content parsing", () => {
		it("should parse a basic content delta", () => {
			const payload = {
				id: "chatcmpl-abc123",
				object: "chat.completion.chunk",
				created: 1700000000,
				model: "gpt-4",
				choices: [
					{
						index: 0,
						delta: { content: "Hello" },
						finish_reason: null,
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "Hello",
			});
		});

		it("should parse content with whitespace", () => {
			const payload = {
				choices: [{ delta: { content: "  spaces  " } }],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "  spaces  ",
			});
		});

		it("should parse content with newlines", () => {
			const payload = {
				choices: [{ delta: { content: "line1\nline2\n" } }],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "line1\nline2\n",
			});
		});

		it("should parse multi-byte unicode content", () => {
			const payload = {
				choices: [{ delta: { content: "Hello world!" } }],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "Hello world!",
			});
		});

		it("should parse empty string content as empty result", () => {
			const payload = {
				choices: [{ delta: { content: "" } }],
			};
			const result = parser.parse(payload);
			// Empty content should not set type or content
			expect(result).toBeNull();
		});
	});

	// ============================================================================
	// Role Parsing
	// ============================================================================

	describe("role parsing", () => {
		it("should parse assistant role", () => {
			const payload = {
				choices: [{ delta: { role: "assistant" } }],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				role: "assistant",
			});
		});

		it("should parse role with content", () => {
			const payload = {
				choices: [{ delta: { role: "assistant", content: "Hello" } }],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				role: "assistant",
				type: "content",
				content: "Hello",
			});
		});
	});

	// ============================================================================
	// Tool Call Parsing
	// ============================================================================

	describe("tool call parsing", () => {
		it("should parse tool call start with id and name", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_abc123",
									type: "function",
									function: {
										name: "get_weather",
										arguments: "",
									},
								},
							],
						},
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "tool_call",
				toolCall: {
					index: 0,
					id: "call_abc123",
					name: "get_weather",
					args: "",
				},
			});
		});

		it("should parse tool call argument chunks", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: {
										arguments: '{"location":',
									},
								},
							],
						},
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "tool_call",
				toolCall: {
					index: 0,
					id: undefined,
					name: undefined,
					args: '{"location":',
				},
			});
		});

		it("should parse complete tool call arguments", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: {
										arguments: '{"city": "San Francisco", "unit": "celsius"}',
									},
								},
							],
						},
					},
				],
			};
			const result = parser.parse(payload);
			expect(result?.toolCall?.args).toBe('{"city": "San Francisco", "unit": "celsius"}');
		});

		it("should handle tool call with missing function", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 1,
									id: "call_def456",
								},
							],
						},
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "tool_call",
				toolCall: {
					index: 1,
					id: "call_def456",
					name: undefined,
					args: undefined,
				},
			});
		});

		it("should handle empty tool_calls array", () => {
			const payload = {
				choices: [{ delta: { tool_calls: [] } }],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should parse only the first tool call when multiple present", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: "call_first", function: { name: "first_tool" } },
								{ index: 1, id: "call_second", function: { name: "second_tool" } },
							],
						},
					},
				],
			};
			const result = parser.parse(payload);
			expect(result?.toolCall?.id).toBe("call_first");
			expect(result?.toolCall?.name).toBe("first_tool");
		});
	});

	// ============================================================================
	// Usage Parsing
	// ============================================================================

	describe("usage parsing", () => {
		it("should parse usage data", () => {
			const payload = {
				id: "chatcmpl-abc123",
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				usage: {
					input: 100,
					output: 50,
				},
			});
		});

		it("should prioritize usage over choices when both present", () => {
			const payload = {
				choices: [{ delta: { content: "test" } }],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				usage: {
					input: 100,
					output: 50,
				},
			});
		});

		it("should handle zero token counts", () => {
			const payload = {
				usage: {
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				},
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				usage: {
					input: 0,
					output: 0,
				},
			});
		});
	});

	// ============================================================================
	// Finish Reason / Stop Reason
	// ============================================================================

	describe("finish reason parsing", () => {
		it("should parse stop finish reason", () => {
			const payload = {
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: "stop",
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				stopReason: "stop",
			});
		});

		it("should parse tool_calls finish reason", () => {
			const payload = {
				choices: [
					{
						delta: {},
						finish_reason: "tool_calls",
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				stopReason: "tool_calls",
			});
		});

		it("should parse length finish reason", () => {
			const payload = {
				choices: [
					{
						delta: {},
						finish_reason: "length",
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				stopReason: "length",
			});
		});

		it("should parse content_filter finish reason", () => {
			const payload = {
				choices: [
					{
						delta: {},
						finish_reason: "content_filter",
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				stopReason: "content_filter",
			});
		});

		it("should parse content with finish reason", () => {
			const payload = {
				choices: [
					{
						delta: { content: "." },
						finish_reason: "stop",
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: ".",
				stopReason: "stop",
			});
		});

		it("should handle null finish_reason", () => {
			const payload = {
				choices: [
					{
						delta: { content: "test" },
						finish_reason: null,
					},
				],
			};
			const result = parser.parse(payload);
			expect(result?.stopReason).toBeUndefined();
		});
	});

	// ============================================================================
	// Edge Cases and Error Handling
	// ============================================================================

	describe("edge cases and error handling", () => {
		it("should return null for completely invalid payload", () => {
			expect(parser.parse("not an object")).toBeNull();
			expect(parser.parse(123)).toBeNull();
			expect(parser.parse(null)).toBeNull();
			expect(parser.parse(undefined)).toBeNull();
			expect(parser.parse([])).toBeNull();
		});

		it("should return null for empty object", () => {
			const result = parser.parse({});
			expect(result).toBeNull();
		});

		it("should return null for missing choices", () => {
			const payload = {
				id: "chatcmpl-abc123",
				object: "chat.completion.chunk",
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for empty choices array", () => {
			const payload = {
				choices: [],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for choice without delta", () => {
			const payload = {
				choices: [{ index: 0 }],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for empty delta", () => {
			const payload = {
				choices: [{ delta: {} }],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for delta with null content", () => {
			const payload = {
				choices: [{ delta: { content: null } }],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for malformed choices (not array)", () => {
			const payload = {
				choices: "not an array",
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should return null for malformed delta (not object)", () => {
			const payload = {
				choices: [{ delta: "not an object" }],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should handle deeply nested invalid structures", () => {
			const payload = {
				choices: [
					{
						delta: {
							tool_calls: [{ function: { arguments: 123 } }], // arguments should be string
						},
					},
				],
			};
			const result = parser.parse(payload);
			// Zod should reject this
			expect(result).toBeNull();
		});
	});

	// ============================================================================
	// Schema Validation
	// ============================================================================

	describe("schema validation", () => {
		it("should validate correct full OpenAI chunk structure", () => {
			const payload = {
				id: "chatcmpl-abc123",
				object: "chat.completion.chunk",
				created: 1700000000,
				model: "gpt-4-turbo",
				choices: [
					{
						index: 0,
						delta: {
							role: "assistant",
							content: "Hello! How can I help you today?",
						},
						finish_reason: null,
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).not.toBeNull();
			expect(result?.role).toBe("assistant");
			expect(result?.content).toBe("Hello! How can I help you today?");
		});

		it("should accept minimal valid payload", () => {
			const payload = {
				choices: [{ delta: { content: "Hi" } }],
			};
			const result = parser.parse(payload);
			expect(result).not.toBeNull();
		});

		it("should reject invalid usage structure", () => {
			const payload = {
				usage: {
					prompt_tokens: "not a number", // should be number
					completion_tokens: 50,
				},
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});

		it("should reject invalid choice index type", () => {
			const payload = {
				choices: [
					{
						index: "zero", // should be number
						delta: { content: "test" },
					},
				],
			};
			const result = parser.parse(payload);
			expect(result).toBeNull();
		});
	});

	// ============================================================================
	// Streaming Sequence Simulation
	// ============================================================================

	describe("streaming sequence simulation", () => {
		it("should correctly parse a realistic streaming sequence", () => {
			const chunks = [
				// First chunk with role
				{
					id: "chatcmpl-abc123",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
				},
				// Content chunks
				{
					id: "chatcmpl-abc123",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
				},
				{
					id: "chatcmpl-abc123",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: { content: "!" }, finish_reason: null }],
				},
				// Final chunk with finish reason
				{
					id: "chatcmpl-abc123",
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				},
			];

			const results = chunks.map((chunk) => parser.parse(chunk));

			expect(results[0]).toEqual({ role: "assistant" });
			expect(results[1]).toEqual({ type: "content", content: "Hello" });
			expect(results[2]).toEqual({ type: "content", content: "!" });
			expect(results[3]).toEqual({ stopReason: "stop" });
		});

		it("should correctly parse a tool call streaming sequence", () => {
			const chunks = [
				// Role chunk
				{
					choices: [{ delta: { role: "assistant" }, finish_reason: null }],
				},
				// Tool call start with name
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_weather",
										type: "function",
										function: { name: "get_weather", arguments: "" },
									},
								],
							},
							finish_reason: null,
						},
					],
				},
				// Tool call argument chunks
				{
					choices: [
						{
							delta: {
								tool_calls: [{ index: 0, function: { arguments: '{"cit' } }],
							},
							finish_reason: null,
						},
					],
				},
				{
					choices: [
						{
							delta: {
								tool_calls: [{ index: 0, function: { arguments: 'y": "SF"}' } }],
							},
							finish_reason: null,
						},
					],
				},
				// Finish with tool_calls reason
				{
					choices: [{ delta: {}, finish_reason: "tool_calls" }],
				},
			];

			const results = chunks.map((chunk) => parser.parse(chunk));

			expect(results[0]).toEqual({ role: "assistant" });
			expect(results[1]?.toolCall?.id).toBe("call_weather");
			expect(results[1]?.toolCall?.name).toBe("get_weather");
			expect(results[2]?.toolCall?.args).toBe('{"cit');
			expect(results[3]?.toolCall?.args).toBe('y": "SF"}');
			expect(results[4]).toEqual({ stopReason: "tool_calls" });
		});

		it("should correctly handle sequence with usage at end", () => {
			const chunks = [
				{
					choices: [{ delta: { role: "assistant", content: "Hi" }, finish_reason: null }],
				},
				{
					choices: [{ delta: {}, finish_reason: "stop" }],
				},
				{
					choices: [],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				},
			];

			const results = chunks.map((chunk) => parser.parse(chunk));

			expect(results[0]).toEqual({ role: "assistant", type: "content", content: "Hi" });
			expect(results[1]).toEqual({ stopReason: "stop" });
			expect(results[2]).toEqual({ usage: { input: 10, output: 5 } });
		});
	});

	// ============================================================================
	// Compatibility with OpenAI-compatible APIs
	// ============================================================================

	describe("OpenAI-compatible API formats", () => {
		it("should handle Azure OpenAI format", () => {
			const payload = {
				id: "chatcmpl-abc123",
				object: "chat.completion.chunk",
				created: 1700000000,
				model: "gpt-4",
				choices: [
					{
						index: 0,
						delta: { content: "Azure response" },
						finish_reason: null,
						content_filter_results: {}, // Azure-specific field
					},
				],
				system_fingerprint: "fp_abc123",
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "Azure response",
			});
		});

		it("should handle responses with extra fields gracefully", () => {
			const payload = {
				id: "chatcmpl-abc123",
				object: "chat.completion.chunk",
				choices: [
					{
						index: 0,
						delta: { content: "test" },
						logprobs: null, // extra field
						extra_unknown_field: "ignored",
					},
				],
				custom_field: "should be ignored",
			};
			const result = parser.parse(payload);
			expect(result).toEqual({
				type: "content",
				content: "test",
			});
		});
	});
});
