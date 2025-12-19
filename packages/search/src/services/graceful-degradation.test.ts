import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQdrantClient = {
	search: vi.fn(async () => [
		{ id: "1", score: 0.9, payload: { content: "test doc 1" } },
		{ id: "2", score: 0.8, payload: { content: "test doc 2" } },
		{ id: "3", score: 0.7, payload: { content: "test doc 3" } },
	]),
	query: vi.fn(async () => ({
		points: [
			{ id: "1", score: 0.9, payload: { content: "test doc 1" } },
			{ id: "2", score: 0.8, payload: { content: "test doc 2" } },
			{ id: "3", score: 0.7, payload: { content: "test doc 3" } },
		],
	})),
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

// Mock reranker that can simulate failures
const mockReranker = {
	rerank: vi.fn(async () => {
		// Default: successful reranking
		return [
			{ id: "3", score: 0.95, originalIndex: 2 },
			{ id: "1", score: 0.92, originalIndex: 0 },
			{ id: "2", score: 0.88, originalIndex: 1 },
		];
	}),
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

vi.mock("./reranker", () => ({
	Reranker: vi.fn(() => mockReranker),
}));

// Import after mocking
const { SearchRetriever } = await import("./retriever");

describe("Graceful Degradation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset reranker to successful behavior
		mockReranker.rerank.mockImplementation(async () => [
			{ id: "3", score: 0.95, originalIndex: 2 },
			{ id: "1", score: 0.92, originalIndex: 0 },
			{ id: "2", score: 0.88, originalIndex: 1 },
		]);
	});

	it("should return results with degraded flag when reranker throws error", async () => {
		const retriever = new SearchRetriever();

		// Make reranker throw an error
		mockReranker.rerank.mockRejectedValueOnce(new Error("Model failed to load"));

		const query = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 3,
		};

		const results = await retriever.search(query);

		// Should still return results (fallback to original)
		expect(results).toHaveLength(3);

		// All results should have degraded flag
		for (const result of results) {
			expect(result.degraded).toBe(true);
			expect(result.degradedReason).toContain("Model failed to load");
		}

		// Should preserve original scores
		expect(results[0].score).toBe(0.9);
		expect(results[1].score).toBe(0.8);
		expect(results[2].score).toBe(0.7);
	});

	it("should return results with degraded flag when reranker times out", async () => {
		const retriever = new SearchRetriever();

		// Make reranker timeout (takes longer than 500ms timeout)
		mockReranker.rerank.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					setTimeout(() => {
						resolve([{ id: "1", score: 0.95, originalIndex: 0 }]);
					}, 1000); // 1 second delay
				}),
		);

		const query = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 3,
		};

		const results = await retriever.search(query);

		// Should still return results (fallback to original)
		expect(results).toHaveLength(3);

		// All results should have degraded flag
		for (const result of results) {
			expect(result.degraded).toBe(true);
			expect(result.degradedReason).toContain("Reranking timeout");
		}
	});

	it("should not set degraded flag when reranking succeeds", async () => {
		const retriever = new SearchRetriever();

		const query = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 3,
		};

		const results = await retriever.search(query);

		// Should return reranked results
		expect(results).toHaveLength(3);

		// No degraded flags
		for (const result of results) {
			expect(result.degraded).toBeUndefined();
			expect(result.degradedReason).toBeUndefined();
		}

		// Should use reranker scores
		expect(results[0].score).toBe(0.95);
		expect(results[1].score).toBe(0.92);
		expect(results[2].score).toBe(0.88);
	});

	it("should not set degraded flag when reranking is disabled", async () => {
		const retriever = new SearchRetriever();

		const query = {
			text: "test query",
			strategy: "dense" as const,
			rerank: false,
			limit: 3,
		};

		const results = await retriever.search(query);

		// Should return original results
		expect(results).toHaveLength(3);

		// No degraded flags
		for (const result of results) {
			expect(result.degraded).toBeUndefined();
			expect(result.degradedReason).toBeUndefined();
		}

		// Reranker should not be called
		expect(mockReranker.rerank).not.toHaveBeenCalled();
	});

	it("should handle different error types gracefully", async () => {
		const retriever = new SearchRetriever();

		// Test with string error
		mockReranker.rerank.mockRejectedValueOnce("String error");

		const query1 = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 3,
		};

		const results1 = await retriever.search(query1);
		expect(results1[0].degraded).toBe(true);
		expect(results1[0].degradedReason).toContain("String error");

		// Test with unknown error type
		mockReranker.rerank.mockRejectedValueOnce({ custom: "error" });

		const query2 = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 3,
		};

		const results2 = await retriever.search(query2);
		expect(results2[0].degraded).toBe(true);
		expect(results2[0].degradedReason).toBeDefined();
	});

	it("should limit degraded results to requested limit", async () => {
		const retriever = new SearchRetriever();

		// Make reranker fail
		mockReranker.rerank.mockRejectedValueOnce(new Error("Reranker failed"));

		const query = {
			text: "test query",
			strategy: "dense" as const,
			rerank: true,
			limit: 2, // Request only 2 results
		};

		const results = await retriever.search(query);

		// Should return exactly 2 results (respecting limit)
		expect(results).toHaveLength(2);

		// Both should be degraded
		expect(results[0].degraded).toBe(true);
		expect(results[1].degraded).toBe(true);
	});
});
