import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpladeEmbedder } from "./splade-embedder";

// Simple hash function for deterministic "random" values based on input
function simpleHash(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

// Mock model that returns MLM logits
const mockModel = vi.fn(async (inputs: { input_ids: unknown; attention_mask: unknown }) => {
	// Get input IDs to create deterministic output based on input
	const inputIds = (inputs.input_ids as { data: number[] }).data;
	const maskData = (inputs.attention_mask as { data: number[] }).data;
	const seqLen = maskData.length;
	const vocabSize = 30522;

	// Create a deterministic seed from input IDs
	const inputKey = inputIds.join(",");
	const seed = simpleHash(inputKey);

	// Generate mock logits: most are negative (will be zeroed by ReLU)
	// A few positive values to simulate learned sparse representation
	const logitsData = new Float32Array(seqLen * vocabSize);

	// Set some positive logits for specific token positions
	// This simulates the model "activating" certain vocabulary terms
	// Use different active tokens based on input to simulate different outputs
	// Spread tokens across vocabulary using seed to create diverse patterns
	const numTokens = 15;
	const activeTokens: number[] = [];
	for (let i = 0; i < numTokens; i++) {
		// Use a multiplicative hash to spread tokens across vocabulary
		activeTokens.push(((seed * (i + 1) * 2654435761) >>> 0) % vocabSize);
	}

	for (let pos = 0; pos < seqLen; pos++) {
		if (maskData[pos] === 0) continue;
		for (let i = 0; i < activeTokens.length; i++) {
			const tokenId = activeTokens[i];
			// Deterministic value based on position and token index
			logitsData[pos * vocabSize + tokenId] = 1.5 + ((seed + pos + i) % 100) / 200;
		}
	}

	return {
		logits: {
			data: logitsData,
			dims: [1, seqLen, vocabSize],
		},
	};
});

// Mock tokenizer - produces different IDs based on input text
const mockTokenizer = vi.fn((text: string, _options?: unknown) => {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	const seqLen = Math.min(words.length + 2, 512); // +2 for [CLS] and [SEP]

	// Generate input IDs based on actual text content for deterministic but varied output
	const textHash = simpleHash(text);
	const inputIds = new Array(seqLen).fill(0).map((_, i) => {
		if (i === 0) return 101; // [CLS]
		if (i === seqLen - 1) return 102; // [SEP]
		// Use hash + position to create unique but deterministic IDs
		return 1000 + ((textHash + i * 7) % 28000);
	});
	const attentionMask = new Array(seqLen).fill(1);

	return {
		input_ids: { data: inputIds, dims: [1, seqLen] },
		attention_mask: { data: attentionMask, dims: [1, seqLen] },
	};
});

// Mock transformers module
vi.mock("@huggingface/transformers", () => ({
	AutoModel: {
		from_pretrained: vi.fn(async () => mockModel),
	},
	AutoTokenizer: {
		from_pretrained: vi.fn(async () => mockTokenizer),
	},
}));

describe("SpladeEmbedder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("embed", () => {
		it("should generate sparse vectors with indices and values", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("machine learning is great");

			expect(sparse.indices).toBeInstanceOf(Array);
			expect(sparse.values).toBeInstanceOf(Array);
			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.indices.length).toBe(sparse.values.length);
		});

		it("should produce sparse output (< 1000 non-zero dimensions)", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("TypeScript is a typed superset of JavaScript");

			// SPLADE should be highly sparse
			expect(sparse.indices.length).toBeLessThan(1000);
			// But should have some activations
			expect(sparse.indices.length).toBeGreaterThan(0);
		});

		it("should have sorted indices for Qdrant compatibility", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("the quick brown fox jumps over the lazy dog");

			for (let i = 1; i < sparse.indices.length; i++) {
				expect(sparse.indices[i]).toBeGreaterThan(sparse.indices[i - 1]);
			}
		});

		it("should have positive weights (ReLU + log1p output)", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("testing sparse vectors");

			for (const value of sparse.values) {
				expect(value).toBeGreaterThan(0);
			}
		});

		it("should have indices within BERT vocabulary range", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("hello world");

			for (const idx of sparse.indices) {
				expect(idx).toBeGreaterThanOrEqual(0);
				expect(idx).toBeLessThan(30522);
			}
		});
	});

	describe("embedQuery", () => {
		it("should generate sparse vectors for queries", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embedQuery("search query");

			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.values.length).toBe(sparse.indices.length);
		});

		it("should use same format as document embedding", async () => {
			const embedder = new SpladeEmbedder();
			const docSparse = await embedder.embed("test document");
			const querySparse = await embedder.embedQuery("test document");

			// Both should have same structure
			expect(docSparse.indices).toBeInstanceOf(Array);
			expect(querySparse.indices).toBeInstanceOf(Array);
			expect(docSparse.values).toBeInstanceOf(Array);
			expect(querySparse.values).toBeInstanceOf(Array);
		});
	});

	describe("preload", () => {
		it("should load model and tokenizer", async () => {
			const embedder = new SpladeEmbedder();

			// Preload should complete without error
			await embedder.preload();

			// After preload, model should be ready
			expect(embedder.isReady()).toBe(true);
		});

		it("should allow embedding after preload", async () => {
			const embedder = new SpladeEmbedder();
			await embedder.preload();

			// Should be able to embed after preload
			const sparse = await embedder.embed("test after preload");
			expect(sparse.indices.length).toBeGreaterThan(0);
		});
	});

	describe("consistency", () => {
		it("should produce consistent results for same input", async () => {
			const embedder = new SpladeEmbedder();
			const sparse1 = await embedder.embed("hello world");
			const sparse2 = await embedder.embed("hello world");

			expect(sparse1.indices).toEqual(sparse2.indices);
			expect(sparse1.values).toEqual(sparse2.values);
		});

		it("should produce deterministic results for same input", async () => {
			// Note: Real differentiation between inputs is tested in integration tests
			// with the actual SPLADE model. Here we verify the mock produces consistent
			// structure for deterministic testing.
			const embedder = new SpladeEmbedder();
			const sparse1 = await embedder.embed("hello world");
			const sparse2 = await embedder.embed("hello world");

			// Same input should always produce same output
			expect(sparse1.indices).toEqual(sparse2.indices);
			expect(sparse1.values).toEqual(sparse2.values);
			expect(sparse1.indices.length).toBeGreaterThan(0);
		});
	});

	describe("edge cases", () => {
		it("should handle short input", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("hi");

			expect(sparse.indices.length).toBeGreaterThan(0);
			expect(sparse.values.length).toBe(sparse.indices.length);
		});

		it("should handle single word", async () => {
			const embedder = new SpladeEmbedder();
			const sparse = await embedder.embed("test");

			expect(sparse.indices.length).toBeGreaterThan(0);
		});
	});
});
