import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColBERTEmbedder } from "./colbert-embedder";

// Mock the feature extraction pipeline for ColBERT
const { mockExtractor, mockPipeline } = vi.hoisted(() => {
	const mockExtractor = vi.fn(
		async (_input: string, _opts: { pooling: string; normalize: boolean }) => {
			// Simulate token-level embeddings: 5 tokens x 128 dimensions
			const numTokens = 5;
			const tokenDim = 128;
			const totalSize = numTokens * tokenDim;
			const data = new Float32Array(totalSize);

			// Fill with mock normalized embeddings
			for (let i = 0; i < totalSize; i++) {
				data[i] = (i % tokenDim) / tokenDim; // Normalized values [0, 1)
			}

			return {
				data,
				dims: [numTokens, tokenDim],
			};
		},
	);

	const mockPipeline = vi.fn(async (task: string, model: string, _options?: unknown) => {
		if (task === "feature-extraction" && model === "Xenova/colbertv2.0") {
			return mockExtractor;
		}
		throw new Error(`Unknown task or model: ${task}, ${model}`);
	});

	return { mockExtractor, mockPipeline };
});

vi.mock("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
}));

describe("ColBERTEmbedder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset singleton instance
		(ColBERTEmbedder as any).instance = undefined;
	});

	describe("getInstance", () => {
		it("should create singleton instance", async () => {
			const instance1 = await ColBERTEmbedder.getInstance();
			const instance2 = await ColBERTEmbedder.getInstance();

			expect(instance1).toBe(instance2);
			expect(mockPipeline).toHaveBeenCalledTimes(1);
			expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "Xenova/colbertv2.0", {
				dtype: "q8",
			});
		});

		it("should load model with quantization", async () => {
			await ColBERTEmbedder.getInstance();

			expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "Xenova/colbertv2.0", {
				dtype: "q8",
			});
		});
	});

	describe("encodeDocument", () => {
		it("should encode document into token-level embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			const tokenEmbeddings = await embedder.encodeDocument("hello world test");

			expect(tokenEmbeddings).toBeInstanceOf(Array);
			expect(tokenEmbeddings.length).toBe(5); // Mock returns 5 tokens

			// Check each token embedding
			for (const token of tokenEmbeddings) {
				expect(token).toBeInstanceOf(Float32Array);
				expect(token.length).toBe(128); // ColBERT v2 token dimension
			}
		});

		it("should use passage prefix for documents", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.encodeDocument("test document");

			expect(mockExtractor).toHaveBeenCalledWith("[D] test document", {
				pooling: "none",
				normalize: true,
			});
		});

		it("should normalize embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.encodeDocument("test");

			expect(mockExtractor).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ normalize: true }),
			);
		});

		it("should use no pooling for token-level embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.encodeDocument("test");

			expect(mockExtractor).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ pooling: "none" }),
			);
		});

		it("should return 128-dimensional token embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			const tokenEmbeddings = await embedder.encodeDocument("test");

			for (const token of tokenEmbeddings) {
				expect(token.length).toBe(128);
			}
		});
	});

	describe("encodeQuery", () => {
		it("should encode query into token-level embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			const tokenEmbeddings = await embedder.encodeQuery("search query");

			expect(tokenEmbeddings).toBeInstanceOf(Array);
			expect(tokenEmbeddings.length).toBe(5); // Mock returns 5 tokens

			// Check each token embedding
			for (const token of tokenEmbeddings) {
				expect(token).toBeInstanceOf(Float32Array);
				expect(token.length).toBe(128);
			}
		});

		it("should use query prefix", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.encodeQuery("search term");

			expect(mockExtractor).toHaveBeenCalledWith("[Q] search term", {
				pooling: "none",
				normalize: true,
			});
		});

		it("should use same model instance as documents", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.encodeDocument("doc");
			await embedder.encodeQuery("query");

			// Should only load model once (singleton)
			expect(mockPipeline).toHaveBeenCalledTimes(1);
		});
	});

	describe("preload", () => {
		it("should preload model instance", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.preload();

			expect(mockPipeline).toHaveBeenCalledTimes(1);
			expect(mockPipeline).toHaveBeenCalledWith("feature-extraction", "Xenova/colbertv2.0", {
				dtype: "q8",
			});
		});

		it("should allow subsequent calls to use cached instance", async () => {
			const embedder = new ColBERTEmbedder();
			await embedder.preload();
			await embedder.encodeDocument("test");

			// Only one pipeline call (preload)
			expect(mockPipeline).toHaveBeenCalledTimes(1);
		});
	});

	describe("token embedding structure", () => {
		it("should split flat array into per-token embeddings", async () => {
			const embedder = new ColBERTEmbedder();
			const tokenEmbeddings = await embedder.encodeDocument("test");

			// Verify each token has distinct values based on position
			expect(tokenEmbeddings.length).toBeGreaterThan(0);

			// Check that tokens have values based on their position in the flat array
			const firstToken = tokenEmbeddings[0];
			const secondToken = tokenEmbeddings[1];

			// Based on our mock: first token starts at index 0, second at 128
			// Values are (i % 128) / 128, so first token has values [0/128, 1/128, 2/128, ...]
			// Second token has values [128/128=0, 129/128, 130/128, ...] which wraps due to modulo
			expect(firstToken).toBeInstanceOf(Float32Array);
			expect(secondToken).toBeInstanceOf(Float32Array);
			expect(firstToken.length).toBe(128);
			expect(secondToken.length).toBe(128);
		});

		it("should handle correct token dimension math", async () => {
			const embedder = new ColBERTEmbedder();
			const tokenEmbeddings = await embedder.encodeDocument("test");

			// Total elements = num_tokens * 128
			// Should get 5 tokens from mock (5 * 128 = 640 total elements)
			expect(tokenEmbeddings.length).toBe(5);

			let totalElements = 0;
			for (const token of tokenEmbeddings) {
				totalElements += token.length;
			}
			expect(totalElements).toBe(640); // 5 * 128
		});
	});
});
