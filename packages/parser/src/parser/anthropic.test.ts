import { describe, expect, it } from "vitest";
import { AnthropicParser } from "./anthropic";

describe("AnthropicParser", () => {
	const parser = new AnthropicParser();

	it("should parse message_start event", () => {
		const event = {
			type: "message_start",
			message: {
				usage: { input_tokens: 100 },
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			usage: { input: 100 },
		});
	});

	it("should parse content_block_start for tool_use", () => {
		const event = {
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "tool-1",
				name: "search",
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			toolCall: {
				index: 0,
				id: "tool-1",
				name: "search",
				args: "",
			},
		});
	});

	it("should parse content_block_delta for text", () => {
		const event = {
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "text_delta",
				text: "Hello",
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			role: "assistant",
			content: "Hello",
		});
	});

	it("should parse content_block_delta for tool args", () => {
		const event = {
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "input_json_delta",
				partial_json: '{"arg":',
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			role: "assistant",
			toolCall: {
				index: 0,
				args: '{"arg":',
			},
		});
	});

	it("should parse message_delta for usage and stop reason", () => {
		const event = {
			type: "message_delta",
			usage: { output_tokens: 50 },
			delta: { stop_reason: "end_turn" },
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			usage: { output: 50 },
			stopReason: "end_turn",
		});
	});

	it("should return null for unknown events", () => {
		const event = { type: "ping" };
		expect(parser.parse(event)).toBeNull();
	});

	it("should return null for non-object payloads", () => {
		expect(parser.parse(null)).toBeNull();
		expect(parser.parse("string")).toBeNull();
		expect(parser.parse(123)).toBeNull();
		expect(parser.parse([])).toBeNull();
	});

	it("should include role in message_start when present", () => {
		const event = {
			type: "message_start",
			message: {
				role: "assistant",
				usage: { input_tokens: 100 },
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			usage: { input: 100 },
			role: "assistant",
		});
	});

	it("should return null for malformed message_start", () => {
		const event = {
			type: "message_start",
			message: "invalid",
		};
		expect(parser.parse(event)).toBeNull();
	});

	it("should return null for content_block_start with invalid schema", () => {
		const event = {
			type: "content_block_start",
			index: "invalid",
		};
		expect(parser.parse(event)).toBeNull();
	});

	it("should return null for content_block_start with text type", () => {
		const event = {
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "text",
				text: "Hello",
			},
		};
		const result = parser.parse(event);
		expect(result).toBeNull();
	});

	it("should return null for content_block_delta with invalid schema", () => {
		const event = {
			type: "content_block_delta",
			index: "invalid",
		};
		expect(parser.parse(event)).toBeNull();
	});

	it("should parse message_delta with only usage", () => {
		const event = {
			type: "message_delta",
			usage: { output_tokens: 50 },
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			usage: { output: 50 },
		});
	});

	it("should parse message_delta with only stop_reason", () => {
		const event = {
			type: "message_delta",
			delta: { stop_reason: "max_tokens" },
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			stopReason: "max_tokens",
		});
	});

	it("should return null for message_delta with invalid schema", () => {
		const event = {
			type: "message_delta",
			usage: "invalid",
		};
		expect(parser.parse(event)).toBeNull();
	});

	it("should return null for message_delta with neither usage nor stop_reason", () => {
		const event = {
			type: "message_delta",
		};
		const result = parser.parse(event);
		expect(result).toBeNull();
	});

	it("should handle message_start with missing usage.input_tokens", () => {
		// Tests branch coverage on line 33: usage?.input_tokens || 0
		const event = {
			type: "message_start",
			message: {
				usage: {
					input_tokens: 0,
				},
			},
		};
		const result = parser.parse(event);
		expect(result).toEqual({
			usage: { input: 0 },
		});
	});

	it("should handle content_block_delta with text_delta type but missing text", () => {
		// Tests edge case where delta.type matches but text is undefined
		const event = {
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "text_delta",
			},
		};
		const result = parser.parse(event);
		// Should still return the delta even with undefined text
		expect(result).toEqual({
			role: "assistant",
			content: undefined,
		});
	});

	it("should handle content_block_delta with input_json_delta but missing partial_json", () => {
		// Tests edge case where delta.type matches but partial_json is undefined
		const event = {
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "input_json_delta",
			},
		};
		const result = parser.parse(event);
		// Should still return the delta even with undefined args
		expect(result).toEqual({
			role: "assistant",
			toolCall: {
				index: 0,
				args: undefined,
			},
		});
	});
});
