import { describe, expect, it, mock } from "bun:test";
import { TextEmbedder } from "./text-embedder";

const mockExtractor = mock(async (input: string) => {
    // Return mock tensor
    return {
        data: new Float32Array([0.1, 0.2, 0.3]),
        dims: [1, 3],
        size: 3
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

describe("TextEmbedder", () => {
    it("should embed document (passage)", async () => {
        const embedder = new TextEmbedder();
        const vector = await embedder.embed("hello world");
        
        expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", expect.stringContaining("e5-small"));
        expect(mockExtractor).toHaveBeenCalledWith("passage: hello world", expect.any(Object));
        expect(vector).toHaveLength(3);
        expect(vector[0]).toBeCloseTo(0.1);
    });

    it("should embed query", async () => {
        const embedder = new TextEmbedder();
        await embedder.embedQuery("search term");
        
        expect(mockExtractor).toHaveBeenCalledWith("query: search term", expect.any(Object));
    });

    it("should return empty sparse vector (stub)", async () => {
        const embedder = new TextEmbedder();
        const sparse = await embedder.embedSparse("test");
        expect(sparse).toEqual({ indices: [], values: [] });
    });
});
