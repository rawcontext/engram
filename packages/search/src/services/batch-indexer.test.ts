import { describe, expect, it, vi } from "vitest";
import { BatchIndexer } from "./batch-indexer";
import type { SearchIndexer } from "./indexer";

describe("BatchIndexer", () => {
	it("should buffer items and flush on limit", async () => {
		const mockIndexNode = vi.fn(async () => {});
		const mockIndexer = {
			indexNode: mockIndexNode,
		} as unknown as SearchIndexer;

		const batcher = new BatchIndexer(mockIndexer, { batchSize: 2 });

		// Add 1 - buffer
		batcher.add({ id: "1" } as any);
		expect(mockIndexNode).not.toHaveBeenCalled();

		// Add 2 - flush
		batcher.add({ id: "2" } as any);

		// Wait for p-queue (async processing)
		// Since we didn't mock p-queue, it runs immediately or on microtask
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockIndexNode).toHaveBeenCalledTimes(2);
	});

	it("should flush on timeout", async () => {
		const mockIndexNode = vi.fn(async () => {});
		const mockIndexer = {
			indexNode: mockIndexNode,
		} as unknown as SearchIndexer;

		// Short interval
		const batcher = new BatchIndexer(mockIndexer, { batchSize: 10, flushInterval: 50 });

		batcher.add({ id: "1" } as any);
		expect(mockIndexNode).not.toHaveBeenCalled();

		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(mockIndexNode).toHaveBeenCalledTimes(1);
	});

	it("should flush on shutdown", async () => {
		const mockIndexNode = vi.fn(async () => {});
		const mockIndexer = {
			indexNode: mockIndexNode,
		} as unknown as SearchIndexer;

		const batcher = new BatchIndexer(mockIndexer, { batchSize: 10 });

		batcher.add({ id: "1" } as any);

		await batcher.shutdown();

		expect(mockIndexNode).toHaveBeenCalledTimes(1);
	});
});
