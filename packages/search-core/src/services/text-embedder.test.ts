import { describe, expect, it, mock } from "bun:test";
import { TextEmbedder } from "./text-embedder";

const mockExtractor = mock(async (_input: string) => {
	// Return mock tensor
	return {
		data: new Float32Array([0.1, 0.2, 0.3]),
		dims: [1, 3],
		size: 3,
	};
});

const mockPipeline = mock(async (task: string, _model: string) => {
	if (task === "feature-extraction") {
		return mockExtractor;
	}
	throw new Error("Unknown task");
});

// Simple vocabulary-like mock for tokenizer
// Returns token IDs based on simple hash for testing
const mockTokenizer = (_text: string, _options?: unknown) => {
	// Simple mock: generate token IDs based on word positions
	const words = _text.toLowerCase().split(/\s+/).filter(Boolean);
	const ids = words.map((w, i) => {
		// Create pseudo-stable IDs: hash-like value for each word
		let hash = 0;
		for (const c of w) hash = (hash * 31 + c.charCodeAt(0)) % 30000;
		return hash || i + 100;
	});
	return {
		input_ids: { data: ids },
	};
};

const mockAutoTokenizer = {
	from_pretrained: mock(async () => mockTokenizer),
};

mock.module("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
	AutoTokenizer: mockAutoTokenizer,
}));

describe("TextEmbedder", () => {
	it("should embed document (passage)", async () => {
		const embedder = new TextEmbedder();
		const vector = await embedder.embed("hello world");

		expect(mockPipeline).toHaveBeenCalledWith(
			"feature-extraction",
			expect.stringContaining("e5-small"),
		);
		expect(mockExtractor).toHaveBeenCalledWith("passage: hello world", expect.any(Object));
		expect(vector).toHaveLength(3);
		expect(vector[0]).toBeCloseTo(0.1);
	});

	it("should embed query", async () => {
		const embedder = new TextEmbedder();
		await embedder.embedQuery("search term");

		expect(mockExtractor).toHaveBeenCalledWith("query: search term", expect.any(Object));
	});

	describe("sparse embedding (BM25)", () => {
		it("should generate sparse vectors with indices and values", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("hello world test");

			expect(sparse.indices).toBeInstanceOf(Array);
			expect(sparse.values).toBeInstanceOf(Array);
			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.indices.length).toBe(sparse.values.length);
		});

		it("should return empty for empty/whitespace text", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("   ");
			expect(sparse).toEqual({ indices: [], values: [] });
		});

		it("should produce consistent hashes for same terms", async () => {
			const embedder = new TextEmbedder();
			const sparse1 = await embedder.embedSparse("hello world");
			const sparse2 = await embedder.embedSparse("hello world");

			expect(sparse1.indices).toEqual(sparse2.indices);
			expect(sparse1.values).toEqual(sparse2.values);
		});

		it("should have sorted indices", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("the quick brown fox jumps over the lazy dog");

			for (let i = 1; i < sparse.indices.length; i++) {
				expect(sparse.indices[i]).toBeGreaterThan(sparse.indices[i - 1]);
			}
		});

		it("should have positive weights", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("testing sparse vectors");

			for (const value of sparse.values) {
				expect(value).toBeGreaterThan(0);
			}
		});

		it("should handle repeated terms with higher weights", async () => {
			const embedder = new TextEmbedder();
			const singleWord = await embedder.embedSparse("test");
			const repeatedWord = await embedder.embedSparse("test test test test");

			// Find the weight for the "test" token in each
			// With BM25 saturation, repeated terms should have diminishing returns but still higher
			const singleWeight = singleWord.values[0];
			const repeatedWeight = repeatedWord.values[0];

			expect(repeatedWeight).toBeGreaterThan(singleWeight);
		});

		it("should generate sparse query vectors", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparseQuery("search query");

			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.values.length).toBe(sparse.indices.length);
		});
	});
});
