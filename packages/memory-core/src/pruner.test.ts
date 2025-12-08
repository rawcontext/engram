import { beforeEach, describe, expect, it, mock } from "bun:test";
import { GraphPruner } from "./pruner";

describe("GraphPruner", () => {
	let mockFalkorQuery: ReturnType<typeof mock>;
	let mockFalkorClient: { query: ReturnType<typeof mock> };

	beforeEach(() => {
		mockFalkorQuery = mock(async () => []);
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

		const pruner = new GraphPruner(mockFalkorClient as any);

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

		const pruner = new GraphPruner(mockFalkorClient as any);

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

		const pruner = new GraphPruner(mockFalkorClient as any);

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
			save: mock(async () => "file:///data/blobs/abc123"),
			read: mock(async () => ""),
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

		const pruner = new GraphPruner(mockFalkorClient as any, mockBlobStore as any);

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
			save: mock(async () => "file:///data/blobs/abc123"),
			read: mock(async () => ""),
		};

		// Archive query returns empty, fetch returns empty
		mockFalkorQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		const pruner = new GraphPruner(mockFalkorClient as any, mockBlobStore as any);

		const result = await pruner.pruneHistory({ retentionMs: 1000 });

		expect(result.archived).toBe(0);
		expect(result.deleted).toBe(0);
		expect(result.batches).toBe(0);
		expect(result.archiveUri).toBeUndefined();

		// Blob store should not be called if no nodes to archive
		expect(mockBlobStore.save).not.toHaveBeenCalled();
	});
});
