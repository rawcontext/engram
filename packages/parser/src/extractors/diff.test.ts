import { describe, expect, it } from "bun:test";
import { DiffExtractor } from "./diff";

describe("DiffExtractor", () => {
	describe("basic extraction", () => {
		it("should extract diff block from text", () => {
			const extractor = new DiffExtractor();
			const result = extractor.process(
				"Some text <<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE more text",
			);

			expect(result.content).toBe("Some text  more text");
			expect(result.diff).toBe("<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE");
		});

		it("should handle content with no diff blocks", () => {
			const extractor = new DiffExtractor();
			const result = extractor.process("Hello world without any diffs");

			expect(result.content).toBe("Hello world without any diffs");
			expect(result.diff).toBeUndefined();
		});

		it("should handle multiple diff blocks", () => {
			const extractor = new DiffExtractor();
			const result = extractor.process(
				"First <<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE Second <<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE End",
			);

			expect(result.content).toBe("First  Second  End");
			expect(result.diff).toBe(
				"<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE<<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE",
			);
		});

		it("should include markers in extracted diff", () => {
			const extractor = new DiffExtractor();
			const result = extractor.process("<<<<<<< SEARCH\nold\n>>>>>>> REPLACE");

			// Markers should be included (includeMarkers: true)
			expect(result.diff).toContain("<<<<<<< SEARCH");
			expect(result.diff).toContain(">>>>>>> REPLACE");
		});
	});

	describe("streaming behavior", () => {
		it("should handle partial opening tag across chunks", () => {
			const extractor = new DiffExtractor();

			// First chunk with partial tag - keeps partial in buffer
			const result1 = extractor.process("Hello <<<<<<<");
			expect(result1.content).toBe("Hello ");
			expect(result1.diff).toBeUndefined();

			// Second chunk completing the tag
			const result2 = extractor.process(" SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE");
			// After completing the diff block, content outside is returned
			expect(result2.diff).toContain("SEARCH");
		});

		it("should handle partial closing tag across chunks", () => {
			const extractor = new DiffExtractor();

			// Open the block
			extractor.process("<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>>");

			// Complete with REPLACE
			const result = extractor.process(" REPLACE after");
			expect(result.content).toBe(" after");
		});

		it("should flush remaining buffered content with partial open tag", () => {
			const extractor = new DiffExtractor();

			// Process content that ends with partial open tag "<<<<<<< "
			const result1 = extractor.process("Some content <<<<<<<");
			// Content before the partial tag is returned
			expect(result1.content).toBe("Some content ");

			// Flush the buffered partial tag
			const result2 = extractor.flush();
			// Partial should be returned as content
			expect(result2.content).toBe("<<<<<<<");
		});
	});

	describe("reset", () => {
		it("should reset state between documents", () => {
			const extractor = new DiffExtractor();

			// Process first document
			extractor.process("<<<<<<< SEARCH\na\n>>>>>>> REPLACE");
			extractor.flush();

			// Reset and process second document
			extractor.reset();
			const result = extractor.process("<<<<<<< SEARCH\nb\n>>>>>>> REPLACE");

			expect(result.diff).toBe("<<<<<<< SEARCH\nb\n>>>>>>> REPLACE");
		});
	});
});
