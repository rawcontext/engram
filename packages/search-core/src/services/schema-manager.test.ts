import { describe, expect, it, mock } from "bun:test";
import { SchemaManager } from "./schema-manager";

const mockCreateCollection = mock(async () => {});
const mockGetCollections = mock(async () => ({ collections: [] }));

mock.module("@qdrant/js-client-rest", () => {
	return {
		QdrantClient: class {
			constructor() {}
			createCollection = mockCreateCollection;
			getCollections = mockGetCollections;
		},
	};
});

describe("SchemaManager", () => {
	it("should create collection if not exists", async () => {
		mockGetCollections.mockResolvedValueOnce({ collections: [] });

		const manager = new SchemaManager();
		await manager.ensureCollection();

		expect(mockGetCollections).toHaveBeenCalled();
		expect(mockCreateCollection).toHaveBeenCalled();
		const call = mockCreateCollection.mock.calls[0];
		expect(call[0]).toBe("soul_memory");
		expect(call[1]).toHaveProperty("vectors.dense");
	});

	it("should skip creation if exists", async () => {
		mockGetCollections.mockResolvedValueOnce({
			collections: [{ name: "soul_memory" }],
		});
		mockCreateCollection.mockClear();

		const manager = new SchemaManager();
		await manager.ensureCollection();

		expect(mockGetCollections).toHaveBeenCalled();
		expect(mockCreateCollection).not.toHaveBeenCalled();
	});
});
