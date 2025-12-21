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

	it("should return unknown for array bodyChunk", () => {
		expect(detectProtocol({}, [])).toBe("unknown");
	});

	it("should detect Azure OpenAI from body chunk", () => {
		expect(detectProtocol({}, { object: "chat.completion.chunk", model_extra: {} })).toBe("openai");
	});

	it("should detect Azure OpenAI without model_extra (standard OpenAI path)", () => {
		// Line 29-30: Tests the standard OpenAI path without model_extra
		expect(detectProtocol({}, { object: "chat.completion.chunk" })).toBe("openai");
	});

	it("should return unknown for non-record types", () => {
		expect(detectProtocol({}, "string")).toBe("unknown");
		expect(detectProtocol({}, 123)).toBe("unknown");
		expect(detectProtocol({}, true)).toBe("unknown");
	});

	it("should detect Azure OpenAI with model_extra", () => {
		// Tests line 29-30: Azure OpenAI specific branch
		expect(
			detectProtocol({}, { object: "chat.completion.chunk", model_extra: { key: "value" } }),
		).toBe("openai");
	});
});
