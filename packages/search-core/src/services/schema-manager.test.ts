import { describe, expect, it, mock, beforeEach } from "bun:test";
import { SchemaManager, VECTOR_DIMENSIONS } from "./schema-manager";

const mockCreateCollection = mock(async () => {});
const mockDeleteCollection = mock(async () => {});
const mockGetCollections = mock(async () => ({ collections: [] }));

mock.module("@qdrant/js-client-rest", () => {
	return {
		QdrantClient: class {
			createCollection = mockCreateCollection;
			deleteCollection = mockDeleteCollection;
			getCollections = mockGetCollections;
		},
	};
});

describe("SchemaManager", () => {
	beforeEach(() => {
		mockCreateCollection.mockClear();
		mockDeleteCollection.mockClear();
		mockGetCollections.mockClear();
	});

	it("should create collection with separate text and code vectors", async () => {
		mockGetCollections.mockResolvedValueOnce({ collections: [] });

		const manager = new SchemaManager();
		await manager.ensureCollection();

		expect(mockGetCollections).toHaveBeenCalled();
		expect(mockCreateCollection).toHaveBeenCalled();
		const call = mockCreateCollection.mock.calls[0];
		expect(call[0]).toBe("engram_memory");

		// Verify separate vector fields
		const config = call[1];
		expect(config.vectors.text_dense.size).toBe(VECTOR_DIMENSIONS.text);
		expect(config.vectors.code_dense.size).toBe(VECTOR_DIMENSIONS.code);
		expect(config.vectors.text_dense.distance).toBe("Cosine");
		expect(config.vectors.code_dense.distance).toBe("Cosine");
	});

	it("should skip creation if exists", async () => {
		mockGetCollections.mockResolvedValueOnce({
			collections: [{ name: "engram_memory" }],
		});

		const manager = new SchemaManager();
		await manager.ensureCollection();

		expect(mockGetCollections).toHaveBeenCalled();
		expect(mockCreateCollection).not.toHaveBeenCalled();
	});

	it("should migrate collection by deleting and recreating", async () => {
		mockGetCollections
			.mockResolvedValueOnce({ collections: [{ name: "engram_memory" }] }) // For migration check
			.mockResolvedValueOnce({ collections: [] }); // For ensureCollection

		const manager = new SchemaManager();
		await manager.migrateToMultiVectorSchema();

		expect(mockDeleteCollection).toHaveBeenCalledWith("engram_memory");
		expect(mockCreateCollection).toHaveBeenCalled();
	});
});
