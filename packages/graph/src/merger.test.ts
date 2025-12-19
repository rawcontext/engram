import type { FalkorClient } from "@engram/storage";
import { describe, expect, it, vi } from "vitest";
import { GraphMerger } from "./merger";

describe("GraphMerger", () => {
	it("should move edges and delete source", async () => {
		const mockQuery = vi.fn((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return one outgoing edge
				return Promise.resolve([["LINKS_TO", true, "neighbor-123", { weight: 1 }]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		// Expect 3 queries: 1 read edges, 1 create new edge, 1 delete source
		expect(mockQuery).toHaveBeenCalledTimes(3);

		// Check creation of new edge
		const createCall = mockQuery.mock.calls[1];
		expect(createCall[0]).toContain("MERGE (t)-[r:LINKS_TO]->(n)");

		// Check deletion
		const deleteCall = mockQuery.mock.calls[2];
		expect(deleteCall[0]).toContain("DETACH DELETE s");
	});
});
