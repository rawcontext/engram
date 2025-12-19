import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQdrantClient = {
	search: vi.fn(async () => []),
	query: vi.fn(async () => ({ points: [] })),
};

const mockEmbedder = {
	embedQuery: vi.fn(async () => new Array(384).fill(0.1)),
	embedSparseQuery: vi.fn(async () => ({ indices: [100, 200, 300], values: [0.5, 0.3, 0.2] })),
};

const mockCodeEmbedder = {
	embedQuery: vi.fn(async () => new Array(768).fill(0.2)),
};

const mockClassifier = {
	classify: vi.fn(() => ({ strategy: "dense", alpha: 1.0 })),
};

vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn(() => mockQdrantClient),
}));

vi.mock("./text-embedder", () => ({
	TextEmbedder: vi.fn(() => mockEmbedder),
}));

vi.mock("./code-embedder", () => ({
	CodeEmbedder: vi.fn(() => mockCodeEmbedder),
}));

vi.mock("./classifier", () => ({
	QueryClassifier: vi.fn(() => mockClassifier),
}));

// Import after mocking
const { SearchRetriever } = await import("./retriever");

describe("SearchRetriever", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should perform dense search", async () => {
		const retriever = new SearchRetriever();
		const query = {
			text: "test query",
			strategy: "dense",
		};

		await retriever.search(query as any);

		expect(mockEmbedder.embedQuery).toHaveBeenCalledWith("test query");
		expect(mockQdrantClient.search).toHaveBeenCalled();
		const call = mockQdrantClient.search.mock.calls[0];
		expect(call[0]).toBe("engram_memory");
		expect(call[1].vector.name).toBe("text_dense");
	});

	it("should use classifier if strategy not provided", async () => {
		const retriever = new SearchRetriever();
		const query = { text: "test query" };

		await retriever.search(query as any);

		expect(mockClassifier.classify).toHaveBeenCalledWith("test query");
		expect(mockQdrantClient.search).toHaveBeenCalled();
	});

	it("should perform sparse-only search", async () => {
		const retriever = new SearchRetriever();
		const query = {
			text: "exact match query",
			strategy: "sparse",
		};

		await retriever.search(query as any);

		expect(mockEmbedder.embedSparseQuery).toHaveBeenCalledWith("exact match query");
		expect(mockQdrantClient.query).toHaveBeenCalled();
		const call = mockQdrantClient.query.mock.calls[0];
		expect(call[0]).toBe("engram_memory");
		expect(call[1].using).toBe("sparse");
		expect(call[1].query).toEqual({
			indices: [100, 200, 300],
			values: [0.5, 0.3, 0.2],
		});
	});

	it("should perform hybrid search with RRF fusion", async () => {
		const retriever = new SearchRetriever();
		const query = {
			text: "hybrid search query",
			strategy: "hybrid",
		};

		await retriever.search(query as any);

		// Both embedders should be called
		expect(mockEmbedder.embedQuery).toHaveBeenCalledWith("hybrid search query");
		expect(mockEmbedder.embedSparseQuery).toHaveBeenCalledWith("hybrid search query");

		// Should use query() with prefetch
		expect(mockQdrantClient.query).toHaveBeenCalled();
		const call = mockQdrantClient.query.mock.calls[0];
		expect(call[0]).toBe("engram_memory");

		// Verify prefetch array structure
		expect(call[1].prefetch).toHaveLength(2);
		expect(call[1].prefetch[0].using).toBe("text_dense");
		expect(call[1].prefetch[1].using).toBe("sparse");

		// Verify RRF fusion
		expect(call[1].query).toEqual({ fusion: "rrf" });
	});

	it("should use code_dense vector for code search in hybrid mode", async () => {
		const retriever = new SearchRetriever();
		const query = {
			text: "function definition",
			strategy: "hybrid",
			filters: { type: "code" },
		};

		await retriever.search(query as any);

		// Should use code embedder for dense vector
		expect(mockCodeEmbedder.embedQuery).toHaveBeenCalledWith("function definition");

		const call = mockQdrantClient.query.mock.calls[0];
		expect(call[1].prefetch[0].using).toBe("code_dense");
	});

	it("should oversample in prefetch for better fusion", async () => {
		const retriever = new SearchRetriever();
		const query = {
			text: "test query",
			strategy: "hybrid",
			limit: 5,
			rerankDepth: 10, // Explicit rerankDepth for predictable test
		};

		await retriever.search(query as any);

		const call = mockQdrantClient.query.mock.calls[0];
		// Prefetch uses Math.max(rerankDepth, limit) * 2 for oversampling
		// With rerankDepth=10, limit=5: fetchLimit=10, prefetch=20
		expect(call[1].prefetch[0].limit).toBe(20);
		expect(call[1].prefetch[1].limit).toBe(20);
		// Final limit is fetchLimit (rerankDepth when reranking)
		expect(call[1].limit).toBe(10);
	});
});
