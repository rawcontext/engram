import { describe, expect, it } from "vitest";
import { detectProtocol } from "./protocol";

describe("Protocol Detection", () => {
	it("should detect anthropic from headers", () => {
		expect(detectProtocol({ "anthropic-version": "2023-06-01" }, {})).toBe("anthropic");
	});

	it("should detect anthropic from body chunk (message_start)", () => {
		expect(detectProtocol({}, { type: "message_start" })).toBe("anthropic");
	});

	it("should detect anthropic from body chunk (content_block_delta)", () => {
		expect(detectProtocol({}, { type: "content_block_delta" })).toBe("anthropic");
	});

	it("should detect openai from body chunk", () => {
		expect(detectProtocol({}, { object: "chat.completion.chunk" })).toBe("openai");
	});

	it("should return unknown for ambiguous or empty inputs", () => {
		expect(detectProtocol({}, {})).toBe("unknown");
		expect(detectProtocol({}, null)).toBe("unknown");
	});
});
