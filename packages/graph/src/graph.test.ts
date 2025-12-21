import type { FalkorClient } from "@engram/storage";
import { describe, expect, it, vi } from "vitest";
import { GraphWriter } from "./graph";
import type { BaseNode } from "./models/base";

/**
 * Mock FalkorClient type for testing GraphWriter.
 */
interface MockFalkorClient {
	connect: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

function createMockFalkorClient(): MockFalkorClient {
	return {
		connect: vi.fn(async () => {}),
		query: vi.fn(async () => []),
		disconnect: vi.fn(async () => {}),
	};
}

/**
 * Test node type that extends BaseNode.
 */
interface TestNode extends BaseNode {
	content: string;
}

describe("GraphWriter", () => {
	it("should write a node with bitemporal properties", async () => {
		const mockFalkorClient = createMockFalkorClient();
		const writer = new GraphWriter(mockFalkorClient as unknown as FalkorClient);
		const data: Omit<TestNode, "vt_start" | "vt_end" | "tt_start" | "tt_end"> = {
			id: "node-1",
			labels: ["TestLabel"],
			content: "test",
		};

		await writer.writeNode<TestNode>("TestLabel", data);

		expect(mockFalkorClient.query).toHaveBeenCalled();
		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("CREATE (n:TestLabel");
		expect(call[1]).toHaveProperty("tt_start");
		expect(call[1]).toHaveProperty("vt_start");
	});

	it("should write an edge between nodes", async () => {
		const mockFalkorClient = createMockFalkorClient();
		const writer = new GraphWriter(mockFalkorClient as unknown as FalkorClient);

		await writer.writeEdge("node-1", "node-2", "LINKS_TO");

		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("MATCH (a {id: $fromId}), (b {id: $toId})");
		expect(call[0]).toContain("CREATE (a)-[:LINKS_TO");
		expect(call[1]).toMatchObject({ fromId: "node-1", toId: "node-2" });
	});

	it("should update node by writing new version and linking", async () => {
		const mockFalkorClient = createMockFalkorClient();
		const writer = new GraphWriter(mockFalkorClient as unknown as FalkorClient);
		const newData: Omit<TestNode, "vt_start" | "vt_end" | "tt_start" | "tt_end"> = {
			id: "node-1-v2",
			labels: ["TestLabel"],
			content: "updated",
		};

		await writer.updateNode<TestNode>("node-1-v1", "TestLabel", newData);

		// Should be 2 calls
		const calls = mockFalkorClient.query.mock.calls.slice(-2);
		expect(calls[0][0]).toContain("CREATE (n:TestLabel"); // writeNode
		expect(calls[1][0]).toContain("CREATE (a)-[:REPLACES"); // writeEdge
	});

	it("should delete node by closing transaction time", async () => {
		const mockFalkorClient = createMockFalkorClient();
		const writer = new GraphWriter(mockFalkorClient as unknown as FalkorClient);

		await writer.deleteNode("node-1");

		const call = mockFalkorClient.query.mock.calls[mockFalkorClient.query.mock.calls.length - 1];
		expect(call[0]).toContain("SET n.tt_end = $t");
		expect(call[1]).toHaveProperty("id", "node-1");
	});
});
