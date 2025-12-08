import { describe, expect, it, mock } from "bun:test";
import { SearchRetriever } from "./retriever";

const mockQdrantClient = {
	search: mock(async () => []),
};

const mockEmbedder = {
	embedQuery: mock(async () => new Array(384).fill(0.1)),
	embedSparseQuery: mock(async () => ({ indices: [100, 200, 300], values: [0.5, 0.3, 0.2] })),
};

const mockClassifier = {
	classify: mock(() => ({ strategy: "dense", alpha: 1.0 })),
};

mock.module("@qdrant/js-client-rest", () => ({
	QdrantClient: class {
		constructor() {
			return mockQdrantClient;
		}
	},
}));

mock.module("./text-embedder", () => ({
	TextEmbedder: class {
		constructor() {
			return mockEmbedder;
		}
		embedQuery = mockEmbedder.embedQuery;
		embedSparseQuery = mockEmbedder.embedSparseQuery;
	},
}));

mock.module("./classifier", () => ({
	QueryClassifier: class {
		classify = mockClassifier.classify;
	},
}));

describe("SearchRetriever", () => {
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
});
