import { describe, expect, it } from "bun:test";
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
});
