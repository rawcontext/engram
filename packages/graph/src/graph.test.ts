import { describe, expect, it, vi } from "vitest";
import { GraphWriter } from "./graph";

const mockFalkorClient = {
	connect: vi.fn(async () => {}),
	query: vi.fn(async () => []),
	disconnect: vi.fn(async () => {}),
};

describe("GraphWriter", () => {
	it("should write a node with bitemporal properties", async () => {
		const writer = new GraphWriter(mockFalkorClient as any);
		const data = { id: "node-1", content: "test" };

		await writer.writeNode("TestLabel", data as any);

		expect(mockFalkorClient.query).toHaveBeenCalled();
		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("CREATE (n:TestLabel");
		expect(call[1]).toHaveProperty("tt_start");
		expect(call[1]).toHaveProperty("vt_start");
	});

	it("should write an edge between nodes", async () => {
		const writer = new GraphWriter(mockFalkorClient as any);

		await writer.writeEdge("node-1", "node-2", "LINKS_TO");

		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("MATCH (a {id: $fromId}), (b {id: $toId})");
		expect(call[0]).toContain("CREATE (a)-[:LINKS_TO");
		expect(call[1]).toMatchObject({ fromId: "node-1", toId: "node-2" });
	});

	it("should update node by writing new version and linking", async () => {
		const writer = new GraphWriter(mockFalkorClient as any);
		const newData = { id: "node-1-v2", content: "updated" };

		// Mock writeNode and writeEdge calls internal to updateNode?
		// Or just check the query calls.
		// writeNode calls query, writeEdge calls query.

		await writer.updateNode("node-1-v1", "TestLabel", newData as any);

		// Should be 2 calls
		const calls = mockFalkorClient.query.mock.calls.slice(-2);
		expect(calls[0][0]).toContain("CREATE (n:TestLabel"); // writeNode
		expect(calls[1][0]).toContain("CREATE (a)-[:REPLACES"); // writeEdge
	});

	it("should delete node by closing transaction time", async () => {
		const writer = new GraphWriter(mockFalkorClient as any);

		await writer.deleteNode("node-1");

		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("SET n.tt_end = $t");
		expect(call[1]).toHaveProperty("id", "node-1");
	});
});
