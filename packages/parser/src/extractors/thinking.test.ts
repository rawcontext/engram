import { describe, expect, it } from "bun:test";
import { ThinkingExtractor } from "./thinking";

describe("ThinkingExtractor", () => {
	describe("basic extraction", () => {
		it("should extract thinking block from text", () => {
			const extractor = new ThinkingExtractor();
			const result = extractor.process("Hello <thinking>I am reasoning</thinking> world");

			expect(result.content).toBe("Hello  world");
			expect(result.thought).toBe("I am reasoning");
		});

		it("should handle content with no thinking blocks", () => {
			const extractor = new ThinkingExtractor();
			const result = extractor.process("Hello world without any thinking");

			expect(result.content).toBe("Hello world without any thinking");
			expect(result.thought).toBeUndefined();
		});

		it("should handle multiple thinking blocks", () => {
			const extractor = new ThinkingExtractor();
			const result = extractor.process(
				"First <thinking>thought 1</thinking> Second <thinking>thought 2</thinking> End",
			);

			expect(result.content).toBe("First  Second  End");
			expect(result.thought).toBe("thought 1thought 2");
		});

		it("should not include markers in extracted thought", () => {
			const extractor = new ThinkingExtractor();
			const result = extractor.process("<thinking>inner</thinking>");

			// Markers should not be included (includeMarkers: false)
			expect(result.thought).toBe("inner");
			expect(result.thought).not.toContain("<thinking>");
			expect(result.thought).not.toContain("</thinking>");
		});

		it("should handle multiline thinking content", () => {
			const extractor = new ThinkingExtractor();
			const result = extractor.process("Start <thinking>Line 1\nLine 2\nLine 3</thinking> End");

			expect(result.content).toBe("Start  End");
			expect(result.thought).toBe("Line 1\nLine 2\nLine 3");
		});
	});

	describe("streaming behavior", () => {
		it("should handle partial opening tag across chunks", () => {
			const extractor = new ThinkingExtractor();

			// First chunk with partial tag
			const result1 = extractor.process("Hello <think");
			expect(result1.content).toBe("Hello ");
			expect(result1.thought).toBeUndefined();

			// Second chunk completing the tag
			const result2 = extractor.process("ing>thinking content</thinking> world");
			expect(result2.content).toBe(" world");
			expect(result2.thought).toBe("thinking content");
		});

		it("should handle partial closing tag across chunks", () => {
			const extractor = new ThinkingExtractor();

			// Open the block - thought is returned immediately as buffer is processed
			const result1 = extractor.process("<thinking>content</think");
			expect(result1.thought).toBe("content");

			// Complete with "ing>" - the close tag is now complete
			const result2 = extractor.process("ing> after");
			expect(result2.content).toBe(" after");
		});

		it("should flush remaining buffered content with partial open tag", () => {
			const extractor = new ThinkingExtractor();

			// Process content that ends with partial open tag
			const result1 = extractor.process("Some content <think");
			expect(result1.content).toBe("Some content ");

			// Flush the buffered partial tag
			const result2 = extractor.flush();
			expect(result2.content).toBe("<think");
		});
	});

	describe("reset", () => {
		it("should reset state between documents", () => {
			const extractor = new ThinkingExtractor();

			// Process first document
			extractor.process("<thinking>first</thinking>");
			extractor.flush();

			// Reset and process second document
			extractor.reset();
			const result = extractor.process("<thinking>second</thinking>");

			expect(result.thought).toBe("second");
		});
	});
});
