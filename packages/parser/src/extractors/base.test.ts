import { describe, expect, it } from "bun:test";
import { BaseTagExtractor, type TagExtractorConfig } from "./base";

/**
 * Test implementation of BaseTagExtractor for unit testing.
 */
class TestExtractor extends BaseTagExtractor<"thought"> {
	protected readonly config: TagExtractorConfig<"thought"> = {
		openTag: "[START]",
		closeTag: "[END]",
		fieldName: "thought",
		includeMarkers: false,
	};
}

class TestExtractorWithMarkers extends BaseTagExtractor<"diff"> {
	protected readonly config: TagExtractorConfig<"diff"> = {
		openTag: "[[BEGIN]]",
		closeTag: "[[FINISH]]",
		fieldName: "diff",
		includeMarkers: true,
	};
}

describe("BaseTagExtractor", () => {
	describe("basic extraction", () => {
		it("should extract content between tags", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("Hello [START]extracted[END] world");

			expect(result.content).toBe("Hello  world");
			expect(result.thought).toBe("extracted");
		});

		it("should handle content with no tags", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("Hello world");

			expect(result.content).toBe("Hello world");
			expect(result.thought).toBeUndefined();
		});

		it("should handle multiple blocks in single chunk", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("A[START]1[END]B[START]2[END]C");

			expect(result.content).toBe("ABC");
			expect(result.thought).toBe("12");
		});

		it("should handle empty content between tags", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("Hello [START][END] world");

			expect(result.content).toBe("Hello  world");
			expect(result.thought).toBeUndefined(); // Empty string is falsy
		});
	});

	describe("streaming with partial tags", () => {
		it("should handle split open tag", () => {
			const extractor = new TestExtractor();

			const r1 = extractor.process("Hello [STA");
			expect(r1.content).toBe("Hello ");
			expect(r1.thought).toBeUndefined();

			const r2 = extractor.process("RT]extracted[END]");
			// When the tag completes, content is empty (no text outside tags in this chunk)
			expect(r2.content).toBeUndefined();
			expect(r2.thought).toBe("extracted");
		});

		it("should handle split close tag", () => {
			const extractor = new TestExtractor();

			const r1 = extractor.process("Hello [START]extracted[EN");
			expect(r1.content).toBe("Hello ");
			// The extracted content is returned when we have the complete tag
			// Even though close tag is partial, we return what we have so far
			expect(r1.thought).toBe("extracted");

			const r2 = extractor.process("D] world");
			expect(r2.content).toBe(" world");
			expect(r2.thought).toBeUndefined();
		});

		it("should handle tag split across multiple chunks", () => {
			const extractor = new TestExtractor();

			const r1 = extractor.process("Before [");
			expect(r1.content).toBe("Before ");

			const r2 = extractor.process("S");
			// Single character added to partial match buffer
			expect(r2.content).toBeUndefined();

			const r3 = extractor.process("TART]inside[END] after");
			expect(r3.content).toBe(" after");
			expect(r3.thought).toBe("inside");
		});
	});

	describe("includeMarkers option", () => {
		it("should include markers when configured", () => {
			const extractor = new TestExtractorWithMarkers();
			const result = extractor.process("Text [[BEGIN]]content[[FINISH]] more");

			expect(result.content).toBe("Text  more");
			expect(result.diff).toBe("[[BEGIN]]content[[FINISH]]");
		});

		it("should include markers with streaming", () => {
			const extractor = new TestExtractorWithMarkers();

			const r1 = extractor.process("Text [[BEG");
			expect(r1.content).toBe("Text ");

			const r2 = extractor.process("IN]]content[[FINISH]] more");
			expect(r2.content).toBe(" more");
			expect(r2.diff).toBe("[[BEGIN]]content[[FINISH]]");
		});
	});

	describe("reset functionality", () => {
		it("should reset state for reuse", () => {
			const extractor = new TestExtractor();

			// First use - leave in middle of block
			extractor.process("Hello [START]partial");

			// Reset
			extractor.reset();

			// Second use - should work from clean state
			const result = extractor.process("New [START]fresh[END] text");
			expect(result.content).toBe("New  text");
			expect(result.thought).toBe("fresh");
		});
	});

	describe("edge cases", () => {
		it("should handle tag at very start", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("[START]first[END]rest");

			expect(result.content).toBe("rest");
			expect(result.thought).toBe("first");
		});

		it("should handle tag at very end", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("start[START]last[END]");

			expect(result.content).toBe("start");
			expect(result.thought).toBe("last");
		});

		it("should handle only tag content", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("[START]only[END]");

			expect(result.content).toBeUndefined();
			expect(result.thought).toBe("only");
		});

		it("should handle newlines in content", () => {
			const extractor = new TestExtractor();
			const result = extractor.process("line1\n[START]thought\nwith\nnewlines[END]\nline2");

			expect(result.content).toBe("line1\n\nline2");
			expect(result.thought).toBe("thought\nwith\nnewlines");
		});
	});

	describe("buffer size limits", () => {
		it("should throw error when buffer exceeds max size", () => {
			const extractor = new TestExtractor();
			const longChunk = "a".repeat(1024 * 1024 + 1);

			expect(() => extractor.process(longChunk)).toThrow(/Buffer size exceeded/);
		});

		it("should respect custom maxBufferSize", () => {
			class SmallBufferExtractor extends BaseTagExtractor<"thought"> {
				protected readonly config: TagExtractorConfig<"thought"> = {
					openTag: "[START]",
					closeTag: "[END]",
					fieldName: "thought",
					maxBufferSize: 100,
				};
			}

			const extractor = new SmallBufferExtractor();
			const longChunk = "a".repeat(101);

			expect(() => extractor.process(longChunk)).toThrow(/Buffer size exceeded/);
			expect(() => extractor.process(longChunk)).toThrow(/100/);
		});
	});

	describe("flush functionality", () => {
		it("should return empty delta when buffer is empty", () => {
			const extractor = new TestExtractor();
			const result = extractor.flush();

			expect(result).toEqual({});
		});

		it("should flush buffered content outside a block", () => {
			const extractor = new TestExtractor();
			// Process partial tag that leaves content in buffer
			extractor.process("Some content [STA");

			const result = extractor.flush();

			// Should return buffered content as regular content
			expect(result.content).toBe("[STA");
			expect(result.thought).toBeUndefined();
		});

		it("should flush buffered content inside an unclosed block with partial close tag", () => {
			const extractor = new TestExtractor();
			// Start a block but leave partial close tag in buffer
			// Note: process() returns extracted content as it goes, but buffers partial tags
			extractor.process("Hello [START]content [EN");

			// At this point, "content " has been extracted, but "[EN" is buffered
			// because it might be the start of "[END]"
			const result = extractor.flush();

			// Should return the partial close tag as extracted content
			expect(result.thought).toBe("[EN");
		});

		it("should clear state after flush", () => {
			const extractor = new TestExtractor();
			extractor.process("Hello [STA");

			// First flush - buffer has partial open tag
			const r1 = extractor.flush();
			expect(r1.content).toBe("[STA");

			// Second flush should be empty
			const r2 = extractor.flush();
			expect(r2).toEqual({});
		});

		it("should handle flush after complete processing", () => {
			const extractor = new TestExtractor();
			extractor.process("Hello [START]complete[END] world");

			// All content processed, buffer should be empty
			const result = extractor.flush();
			expect(result).toEqual({});
		});

		it("should handle flush when only partial close tag remains", () => {
			const extractor = new TestExtractor();
			// Enter block, have some content, close tag is partial
			extractor.process("Before [START]content [EN");

			const result = extractor.flush();

			// Buffer contains only "[EN" (partial close tag)
			// Content "content " was already extracted during process()
			expect(result.thought).toBe("[EN");
		});

		it("should work with streaming chunks ending mid-block", () => {
			const extractor = new TestExtractor();

			// First chunk opens block
			const r1 = extractor.process("Prefix [START]first");
			expect(r1.content).toBe("Prefix ");
			expect(r1.thought).toBe("first");

			// Second chunk continues block
			const r2 = extractor.process(" second");
			expect(r2.thought).toBe(" second");

			// Flush remaining buffer (empty because no partial tag)
			const r3 = extractor.flush();
			expect(r3).toEqual({});
		});
	});
});
