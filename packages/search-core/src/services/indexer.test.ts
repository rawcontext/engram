import { describe, expect, it, vi } from "vitest";
import { SearchIndexer } from "./indexer";

const mockQdrantClient = {
	upsert: vi.fn(async () => {}),
};

const mockEmbedder = {
	embed: vi.fn(async () => new Array(384).fill(0.1)),
	embedSparse: vi.fn(async () => ({ indices: [100, 200, 300], values: [0.5, 0.3, 0.2] })),
};

vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn().mockImplementation(() => mockQdrantClient),
}));

vi.mock("./text-embedder", () => ({
	TextEmbedder: vi.fn().mockImplementation(() => ({
		embed: mockEmbedder.embed,
		embedSparse: mockEmbedder.embedSparse,
	})),
}));

vi.mock("./code-embedder", () => ({
	CodeEmbedder: vi.fn().mockImplementation(() => ({
		embed: mockEmbedder.embed,
	})),
}));

describe("SearchIndexer", () => {
	it("should index a thought node using text embedder", async () => {
		const indexer = new SearchIndexer();
		const node = {
			id: "node-1",
			labels: ["Thought"],
			content: "This is a thought",
			session_id: "session-1",
		};

		await indexer.indexNode(node);

		expect(mockEmbedder.embed).toHaveBeenCalledWith("This is a thought");
		expect(mockQdrantClient.upsert).toHaveBeenCalled();
		const call = mockQdrantClient.upsert.mock.calls[0];
		expect(call[0]).toBe("engram_memory");
		expect(call[1].points[0].id).toBe("node-1");
		expect(call[1].points[0].payload.type).toBe("thought");
	});

	it("should index a code node using code embedder", async () => {
		const indexer = new SearchIndexer();
		const node = {
			id: "node-2",
			labels: ["DiffHunk"],
			patch_content: "const x = 1;",
			session_id: "session-1",
		};

		await indexer.indexNode(node);

		expect(mockEmbedder.embed).toHaveBeenCalledWith("const x = 1;");
		expect(mockQdrantClient.upsert).toHaveBeenCalled();
		const call = mockQdrantClient.upsert.mock.calls[mockQdrantClient.upsert.mock.calls.length - 1];
		expect(call[1].points[0].payload.type).toBe("code");
	});
});
