import { describe, expect, it, vi } from "vitest";
import { TextEmbedder } from "./text-embedder";

const { mockPipeline, mockExtractor, mockAutoTokenizer, mockAutoModel, mockSpladeModel } =
	vi.hoisted(() => {
		const mockExtractor = vi.fn(async (_input: string) => {
			return {
				data: new Float32Array([0.1, 0.2, 0.3]),
				dims: [1, 3],
				size: 3,
			};
		});

		const mockPipeline = vi.fn(async (task: string, _model: string) => {
			if (task === "feature-extraction") {
				return mockExtractor;
			}
			throw new Error("Unknown task");
		});

		// Mock tokenizer for SPLADE
		const mockTokenizer = (_text: string, _options?: { add_special_tokens?: boolean }) => {
			const words = _text.toLowerCase().split(/\s+/).filter(Boolean);
			const ids = words.map((w, i) => {
				let hash = 0;
				for (const c of w) hash = (hash * 31 + c.charCodeAt(0)) % 30000;
				return hash || i + 100;
			});
			const fullIds = [101, ...ids, 102];
			const attentionMask = new Array(fullIds.length).fill(1);
			return {
				input_ids: { data: fullIds, dims: [1, fullIds.length] },
				attention_mask: { data: attentionMask, dims: [1, fullIds.length] },
			};
		};

		const mockAutoTokenizer = {
			from_pretrained: vi.fn(async () => mockTokenizer),
		};

		// Mock SPLADE model
		const mockSpladeModel = vi.fn(
			async (inputs: { input_ids: unknown; attention_mask: unknown }) => {
				const maskData = (inputs.attention_mask as { data: number[] }).data;
				const seqLen = maskData.length;
				const vocabSize = 30522;
				const logitsData = new Float32Array(seqLen * vocabSize);
				const activeTokens = [100, 200, 1000];
				for (let pos = 0; pos < seqLen; pos++) {
					if (maskData[pos] === 0) continue;
					for (const tokenId of activeTokens) {
						logitsData[pos * vocabSize + tokenId] = 1.5;
					}
				}
				return { logits: { data: logitsData, dims: [1, seqLen, vocabSize] } };
			},
		);

		const mockAutoModel = {
			from_pretrained: vi.fn(async () => mockSpladeModel),
		};

		return { mockPipeline, mockExtractor, mockAutoTokenizer, mockAutoModel, mockSpladeModel };
	});

vi.mock("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
	AutoTokenizer: mockAutoTokenizer,
	AutoModel: mockAutoModel,
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

	describe("sparse embedding (SPLADE)", () => {
		it("should generate sparse vectors with indices and values", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("hello world test");

			expect(sparse.indices).toBeInstanceOf(Array);
			expect(sparse.values).toBeInstanceOf(Array);
			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.indices.length).toBe(sparse.values.length);
		});

		it("should have sorted indices", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparse("the quick brown fox");

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

		it("should generate sparse query vectors", async () => {
			const embedder = new TextEmbedder();
			const sparse = await embedder.embedSparseQuery("search query");

			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.values.length).toBe(sparse.indices.length);
		});
	});
});
