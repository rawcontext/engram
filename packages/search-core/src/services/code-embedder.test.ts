import { describe, expect, it, mock } from "bun:test";
import { CodeEmbedder } from "./code-embedder";

const mockExtractor = mock(async (_input: string) => {
	return {
		data: new Float32Array([0.9, 0.8, 0.7]),
	};
});

const mockPipeline = mock(async (task: string, _model: string) => {
	if (task === "feature-extraction") {
		return mockExtractor;
	}
	throw new Error("Unknown task");
});

mock.module("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
}));

describe("CodeEmbedder", () => {
	it("should embed code with nomic model", async () => {
		const embedder = new CodeEmbedder();
		const code = "function test() { return true; }";
		const vector = await embedder.embed(code);

		expect(mockPipeline).toHaveBeenCalledWith(
			"feature-extraction",
			expect.stringContaining("nomic-embed-text"),
		);
		expect(vector[0]).toBeCloseTo(0.9);
	});

	it("should use search_document prefix for embedding", async () => {
		mockExtractor.mockClear();
		const embedder = new CodeEmbedder();
		await embedder.embed("const x = 1;");

		expect(mockExtractor).toHaveBeenCalledWith(
			expect.stringContaining("search_document:"),
			expect.any(Object),
		);
	});

	it("should use search_query prefix for queries", async () => {
		mockExtractor.mockClear();
		const embedder = new CodeEmbedder();
		await embedder.embedQuery("find authentication function");

		expect(mockExtractor).toHaveBeenCalledWith(
			expect.stringContaining("search_query:"),
			expect.any(Object),
		);
	});

	it("should chunk large code files", async () => {
		mockExtractor.mockClear();
		const embedder = new CodeEmbedder();
		// Create code larger than CHUNK_SIZE (6000 chars)
		const largeCode = "function test() {\n".repeat(500); // ~9000 chars
		await embedder.embed(largeCode);

		// Should have made multiple calls (chunks)
		expect(mockExtractor.mock.calls.length).toBeGreaterThan(1);
	});

	it("should average embeddings for chunked code", async () => {
		const embedder = new CodeEmbedder();
		const largeCode = "x".repeat(10000);
		const vector = await embedder.embed(largeCode);

		// Result should be normalized (L2 norm close to 1)
		const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		expect(norm).toBeCloseTo(1, 1);
	});
});
