import { describe, it, expect } from "bun:test";
import { DiffExtractor } from "./diff";

describe("DiffExtractor", () => {
    it("should extract diff blocks", () => {
        const extractor = new DiffExtractor();
        const input = "Some text <<<<<<< SEARCH\ncode\n=======\nnew code\n>>>>>>> REPLACE\n more text";
        const result = extractor.process(input);
        
        expect(result.content).toBe("Some text \n more text");
        expect(result.diff).toContain("<<<<<<< SEARCH");
        expect(result.diff).toContain(">>>>>>> REPLACE");
    });

    it("should handle split start marker", () => {
        const extractor = new DiffExtractor();
        
        const r1 = extractor.process("Text <<<<<");
        expect(r1.content).toBe("Text ");
        expect(r1.diff).toBeUndefined();

        const r2 = extractor.process("<< SEARCH\ncode\n>>>>>>> REPLACE");
        expect(r2.diff).toContain("<<<<<<< SEARCH");
    });
});
