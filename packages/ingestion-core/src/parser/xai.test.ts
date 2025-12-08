import { describe, expect, it } from "bun:test";
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
});
