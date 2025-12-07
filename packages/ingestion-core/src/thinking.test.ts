import { describe, it, expect } from "bun:test";
import { ThinkingExtractor } from "./thinking";

describe("ThinkingExtractor", () => {
    it("should extract thinking content", () => {
        const extractor = new ThinkingExtractor();
        const result = extractor.process("Hello <thinking>I am thinking</thinking> world");
        
        expect(result.content).toBe("Hello  world");
        expect(result.thought).toBe("I am thinking");
    });

    it("should handle split start tags", () => {
        const extractor = new ThinkingExtractor();
        
        const r1 = extractor.process("Hello <think");
        expect(r1.content).toBe("Hello ");
        expect(r1.thought).toBeUndefined();

        const r2 = extractor.process("ing>Thinking...</thinking>");
        expect(r2.thought).toBe("Thinking...");
    });

    it("should handle split end tags", () => {
        const extractor = new ThinkingExtractor();
        
        extractor.process("Hello <thinking>Thinking...");
        const r1 = extractor.process("</think");
        expect(r1.thought).toBeUndefined(); // Buffer held

        const r2 = extractor.process("ing> Done");
        expect(r2.content).toBe(" Done");
    });

    it("should handle multiple blocks", () => {
        const extractor = new ThinkingExtractor();
        const input = "A<thinking>1</thinking>B<thinking>2</thinking>C";
        const result = extractor.process(input);
        
        expect(result.content).toBe("ABC");
        expect(result.thought).toBe("12");
    });
});
