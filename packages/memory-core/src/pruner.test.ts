import { describe, expect, it, mock } from "bun:test";
import { GraphPruner } from "./pruner";

const mockFalkorClient = {
	connect: mock(async () => {}),
	query: mock(async () => [[5]]), // Return deleted count 5
	disconnect: mock(async () => {}),
};

describe("GraphPruner", () => {
	it("should prune history based on retention", async () => {
		const pruner = new GraphPruner(mockFalkorClient as any);

		const deleted = await pruner.pruneHistory(1000);

		expect(mockFalkorClient.query).toHaveBeenCalled();
		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("DELETE n");
		expect(deleted).toBe(5);
	});
});
