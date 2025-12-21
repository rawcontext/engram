import type { BlobStore, FalkorClient } from "@engram/storage";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphPruner } from "./pruner";

/**
 * Mock FalkorClient type for testing GraphPruner.
 */
interface MockFalkorClient {
	query: Mock;
}

/**
 * Mock BlobStore type for testing archival.
 */
interface MockBlobStore {
	save: Mock;
	read: Mock;
}

describe("GraphPruner", () => {
	let mockFalkorQuery: Mock;
	let mockFalkorClient: MockFalkorClient;

	beforeEach(() => {
		mockFalkorQuery = vi.fn(async () => []);
		mockFalkorClient = { query: mockFalkorQuery };
	});

	it("should prune history in batches without archive", async () => {
		// First call: fetch node IDs returns 2 nodes
		// Second call: delete returns 2
		// Third call: fetch returns empty (no more)
		mockFalkorQuery
			.mockResolvedValueOnce([{ nodeId: 1 }, { nodeId: 2 }])
			.mockResolvedValueOnce([[2]])
			.mockResolvedValueOnce([]);

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.deleted).toBe(2);
		expect(result.archived).toBe(0);
		expect(result.batches).toBe(1);
		expect(result.archiveUri).toBeUndefined();
	});

	it("should process multiple batches", async () => {
		// First batch: 2 nodes (full batch size)
		// Second batch: 1 node (partial, signals end)
		mockFalkorQuery
			.mockResolvedValueOnce([{ nodeId: 1 }, { nodeId: 2 }]) // fetch batch 1
			.mockResolvedValueOnce([[2]]) // delete batch 1
			.mockResolvedValueOnce([{ nodeId: 3 }]) // fetch batch 2 (partial)
			.mockResolvedValueOnce([[1]]); // delete batch 2

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({ retentionMs: 1000, batchSize: 2 });

		expect(result.deleted).toBe(3);
		expect(result.batches).toBe(2);
	});

	it("should respect maxBatches limit", async () => {
		// Setup infinite supply of nodes
		mockFalkorQuery
			.mockResolvedValueOnce([{ nodeId: 1 }, { nodeId: 2 }])
			.mockResolvedValueOnce([[2]])
			.mockResolvedValueOnce([{ nodeId: 3 }, { nodeId: 4 }])
			.mockResolvedValueOnce([[2]]);

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({
			retentionMs: 1000,
			batchSize: 2,
			maxBatches: 1,
		});

		expect(result.batches).toBe(1);
		expect(result.deleted).toBe(2);
	});

	it("should archive nodes before pruning when archiveStore is provided", async () => {
		const mockBlobStore = {
			save: vi.fn(async () => "file:///data/blobs/abc123"),
			read: vi.fn(async () => ""),
		};

		// Archive query returns nodes, then fetch/delete batches
		mockFalkorQuery
			.mockResolvedValueOnce([
				{ labels: ["Thought"], props: { id: "t1", content: "old thought" }, nodeId: 1 },
				{ labels: ["Thought"], props: { id: "t2", content: "another old thought" }, nodeId: 2 },
			])
			.mockResolvedValueOnce([{ nodeId: 1 }, { nodeId: 2 }]) // fetch batch
			.mockResolvedValueOnce([[2]]) // delete batch
			.mockResolvedValueOnce([]); // no more

		const pruner = new GraphPruner(
			mockFalkorClient as unknown as FalkorClient,
			mockBlobStore as unknown as BlobStore,
		);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.archived).toBe(2);
		expect(result.deleted).toBe(2);
		expect(result.batches).toBe(1);
		expect(result.archiveUri).toBe("file:///data/blobs/abc123");

		// Verify blob store was called with JSONL content
		expect(mockBlobStore.save).toHaveBeenCalledTimes(1);
		const savedContent = mockBlobStore.save.mock.calls[0][0] as string;
		const lines = savedContent.split("\n");
		expect(lines.length).toBe(2);

		// Verify JSONL format
		const firstRecord = JSON.parse(lines[0]);
		expect(firstRecord.labels).toEqual(["Thought"]);
		expect(firstRecord.id).toBe("t1");
		expect(firstRecord._node_id).toBe(1);
		expect(firstRecord._archived_at).toBeDefined();
	});

	it("should skip archive when no nodes to prune", async () => {
		const mockBlobStore = {
			save: vi.fn(async () => "file:///data/blobs/abc123"),
			read: vi.fn(async () => ""),
		};

		// Archive query returns empty, fetch returns empty
		mockFalkorQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		const pruner = new GraphPruner(
			mockFalkorClient as unknown as FalkorClient,
			mockBlobStore as unknown as BlobStore,
		);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.archived).toBe(0);
		expect(result.deleted).toBe(0);
		expect(result.batches).toBe(0);
		expect(result.archiveUri).toBeUndefined();

		// Blob store should not be called if no nodes to archive
		expect(mockBlobStore.save).not.toHaveBeenCalled();
	});

	it("should handle deleted_count as first row element when not an object property", async () => {
		// This tests the fallback path: firstRow?.[0] when deleted_count property doesn't exist
		mockFalkorQuery
			.mockResolvedValueOnce([{ nodeId: 1 }])
			.mockResolvedValueOnce([[3]]) // Returns count as array element
			.mockResolvedValueOnce([]);

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.deleted).toBe(3);
		expect(result.batches).toBe(1);
	});

	it("should handle when delete query returns null or undefined deleted_count", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([{ nodeId: 1 }])
			.mockResolvedValueOnce([{ deleted_count: null }])
			.mockResolvedValueOnce([]);

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.deleted).toBe(0);
		expect(result.batches).toBe(1);
	});

	it("should handle null rows in archive query", async () => {
		const mockBlobStore = {
			save: vi.fn(async () => "file:///data/blobs/abc123"),
			read: vi.fn(async () => ""),
		};

		// Archive query returns null
		mockFalkorQuery.mockResolvedValueOnce(null as any).mockResolvedValueOnce([]);

		const pruner = new GraphPruner(
			mockFalkorClient as unknown as FalkorClient,
			mockBlobStore as unknown as BlobStore,
		);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.archived).toBe(0);
		expect(result.deleted).toBe(0);
		expect(result.archiveUri).toBeUndefined();
		expect(mockBlobStore.save).not.toHaveBeenCalled();
	});

	it("should stop when no nodes returned in fetch batch", async () => {
		mockFalkorQuery.mockResolvedValueOnce(null as any);

		const pruner = new GraphPruner(mockFalkorClient as unknown as FalkorClient);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.deleted).toBe(0);
		expect(result.batches).toBe(0);
	});
});
