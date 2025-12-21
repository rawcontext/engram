import { describe, expect, it } from "vitest";
import { XAIParser } from "./xai";

describe("XAIParser", () => {
	const parser = new XAIParser();

	it("should parse standard content", () => {
		const payload = {
			choices: [{ delta: { content: "Hello" } }],
		};
		const result = parser.parse(payload);
		expect(result).toEqual({ type: "content", content: "Hello" });
	});

	it("should parse reasoning_content as thought", () => {
		const payload = {
			choices: [{ delta: { reasoning_content: "Thinking..." } }],
		};
		const result = parser.parse(payload);
		expect(result).toEqual({ type: "thought", thought: "Thinking..." });
	});

	it("should parse both content and reasoning", () => {
		const payload = {
			choices: [{ delta: { content: "Result", reasoning_content: "Logic" } }],
		};
		const result = parser.parse(payload);
		// Note: current logic overrides type to "thought" if reasoning is present.
		// Ideally it might be "mixed" or we handle it.
		// But for streaming, usually chunks are one or the other.
		expect(result?.thought).toBe("Logic");
		expect(result?.content).toBe("Result");
	});

	it("should return base parser result when xAI schema validation fails", () => {
		const payload = {
			choices: [{ delta: { content: "Hello" }, invalid_field: "causes schema fail" }],
			invalid_top: true,
		};
		const result = parser.parse(payload);
		// Should fall back to OpenAI parsing
		expect(result?.content).toBe("Hello");
	});

	it("should return null when both parsers fail", () => {
		const payload = {
			invalid: "structure",
		};
		const result = parser.parse(payload);
		expect(result).toBeNull();
	});

	it("should handle empty payload", () => {
		const result = parser.parse({});
		expect(result).toBeNull();
	});

	it("should handle payload with no reasoning_content", () => {
		const payload = {
			choices: [{ delta: {} }],
		};
		const result = parser.parse(payload);
		expect(result).toBeNull();
	});

	it("should return base parser result when result exists but no reasoning", () => {
		// Tests line 13: When base parser returns a result but xAI schema fails or has no reasoning
		const payload = {
			choices: [{ delta: { content: "Text", role: "assistant" } }],
		};
		const result = parser.parse(payload);
		// Should return the base OpenAI parser result (includes role from delta)
		expect(result).toEqual({ type: "content", content: "Text", role: "assistant" });
	});

	it("should return null when xAI schema fails and base parser returns null", () => {
		// Tests line 13 with result=null path
		const payload = {
			choices: [],
		};
		const result = parser.parse(payload);
		expect(result).toBeNull();
	});

	it("should handle xAI schema validation failure", () => {
		// Tests line 12-13: when XAIChunkSchema.safeParse fails
		const payload = {
			choices: "invalid",
		};
		const result = parser.parse(payload);
		// Base parser should also fail, returning null
		expect(result).toBeNull();
	});
});
