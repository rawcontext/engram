import { describe, expect, it, mock } from "bun:test";
import { SearchIndexer } from "./indexer";

const mockQdrantClient = {
	upsert: mock(async () => {}),
};

const mockEmbedder = {
	embed: mock(async () => new Array(384).fill(0.1)),
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
		embed = mockEmbedder.embed;
	},
}));

mock.module("./code-embedder", () => ({
	CodeEmbedder: class {
		constructor() {
			return mockEmbedder;
		}
		embed = mockEmbedder.embed;
	},
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
		expect(call[0]).toBe("soul_memory");
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
