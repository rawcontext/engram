import { describe, expect, it, mock } from "bun:test";
import { CodeEmbedder } from "./code-embedder";

const mockExtractor = mock(async (input: string) => {
    return {
        data: new Float32Array([0.9, 0.8, 0.7]),
    };
});

const mockPipeline = mock(async (task: string, model: string) => {
    if (task === "feature-extraction") {
        return mockExtractor;
    }
    throw new Error("Unknown task");
});

mock.module("@huggingface/transformers", () => ({
    pipeline: mockPipeline
}));

describe("CodeEmbedder", () => {
    it("should embed code", async () => {
        const embedder = new CodeEmbedder();
        const code = "function test() { return true; }";
        const vector = await embedder.embed(code);
        
        expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", expect.stringContaining("e5-small"));
        expect(mockExtractor).toHaveBeenCalledWith(expect.stringContaining("function test"), expect.any(Object));
        expect(vector[0]).toBeCloseTo(0.9);
    });
});
