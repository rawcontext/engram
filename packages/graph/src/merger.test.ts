import type { FalkorClient } from "@engram/storage";
import { beforeEach, describe, expect, it, mock } from "bun:test";

// Create mocks before mock.module
const mockLoggerWarn = mock();
const mockLoggerInfo = mock();

// Mock logger BEFORE importing merger.ts (which creates module-level logger singleton)
mock.module("@engram/logger", () => ({
	createNodeLogger: () => ({
		info: mockLoggerInfo,
		warn: mockLoggerWarn,
		error: mock(),
		debug: mock(),
	}),
}));

// Import after mocking
import { GraphMerger } from "./merger";

describe("GraphMerger", () => {
	beforeEach(() => {
		mockLoggerWarn.mockClear();
		mockLoggerInfo.mockClear();
	});

	it("should move edges and delete source", async () => {
		const mockQuery = mock((query: string, _params: any) => {
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

	it("should handle incoming edges", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return one incoming edge (isOutgoing = false)
				return Promise.resolve([["POINTS_TO", false, "neighbor-456", { label: "test" }]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		const createCall = mockQuery.mock.calls[1];
		expect(createCall[0]).toContain("MERGE (n)-[r:POINTS_TO]->(t)");
	});

	it("should handle non-array result from edges query", async () => {
		const mockQuery = mock(async (query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return non-array result (code returns early)
				return "not-an-array" as any;
			}
			return [];
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		// Only one call - edge query returns early on non-array
		expect(mockQuery).toHaveBeenCalledTimes(1);
	});

	it("should skip invalid rows with insufficient elements", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return row with insufficient elements
				return Promise.resolve([["INVALID", true]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockLoggerWarn).toHaveBeenCalledWith(
			"Skipping invalid row - expected array with 4 elements",
		);
	});

	it("should skip rows with invalid type", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return row with non-string type
				return Promise.resolve([[123, true, "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockLoggerWarn).toHaveBeenCalledWith("Skipping row - type is not a string");
	});

	it("should skip rows with invalid isOutgoing", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return row with non-boolean isOutgoing
				return Promise.resolve([["LINKS_TO", "not-boolean", "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockLoggerWarn).toHaveBeenCalledWith("Skipping row - isOutgoing is not a boolean");
	});

	it("should skip rows with invalid neighborId", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return row with non-string neighborId
				return Promise.resolve([["LINKS_TO", true, 999, {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockLoggerWarn).toHaveBeenCalledWith("Skipping row - neighborId is not a string");
	});

	it("should throw on invalid relationship type", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return edge with invalid relationship type
				return Promise.resolve([["123_INVALID", true, "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);

		await expect(merger.mergeNodes("target-1", "source-1")).rejects.toThrow(
			'Invalid relationship type: "123_INVALID"',
		);
	});

	it("should handle edge properties as array", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return edge with array as properties (should use empty object)
				return Promise.resolve([["LINKS_TO", true, "neighbor-123", [1, 2, 3]]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		const createCall = mockQuery.mock.calls[1];
		expect(createCall[1]).toMatchObject({ props: {} });
	});

	it("should log merge completion", async () => {
		const mockQuery = mock(async () => []);

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockLoggerInfo).toHaveBeenCalledWith(
			{ sourceId: "source-1", targetId: "target-1" },
			"Merged nodes",
		);
	});

	it("should handle non-object properties gracefully", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return edge with null properties
				return Promise.resolve([["LINKS_TO", true, "neighbor-123", null]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		const createCall = mockQuery.mock.calls[1];
		expect(createCall[1]).toMatchObject({ props: {} });
	});

	it("should handle undefined properties", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return edge with undefined properties
				return Promise.resolve([["LINKS_TO", true, "neighbor-123", undefined]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		const createCall = mockQuery.mock.calls[1];
		expect(createCall[1]).toMatchObject({ props: {} });
	});

	it("should handle string properties", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Return edge with string properties
				return Promise.resolve([["LINKS_TO", true, "neighbor-123", "not-an-object"]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		const createCall = mockQuery.mock.calls[1];
		expect(createCall[1]).toMatchObject({ props: {} });
	});

	it("should handle valid relationship types at the edge of regex", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Valid edge case: exactly 100 characters
				const validType = `A${"a".repeat(99)}`;
				return Promise.resolve([[validType, true, "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		expect(mockQuery).toHaveBeenCalledTimes(3); // edges, create, delete
	});

	it("should throw on relationship type that is too long", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				// Invalid: 101 characters (exceeds limit)
				const invalidType = `A${"a".repeat(100)}`;
				return Promise.resolve([[invalidType, true, "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);

		await expect(merger.mergeNodes("target-1", "source-1")).rejects.toThrow(
			/Invalid relationship type/,
		);
	});

	it("should throw on relationship type with invalid characters", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				return Promise.resolve([["INVALID-TYPE!", true, "neighbor-123", {}]]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);

		await expect(merger.mergeNodes("target-1", "source-1")).rejects.toThrow(
			/Invalid relationship type/,
		);
	});

	it("should handle multiple edges", async () => {
		const mockQuery = mock((query: string, _params: any) => {
			if (query.includes("MATCH (s {id: $sourceId})-[r]-(n)")) {
				return Promise.resolve([
					["LINKS_TO", true, "neighbor-1", { weight: 1 }],
					["POINTS_TO", false, "neighbor-2", { label: "test" }],
					["KNOWS", true, "neighbor-3", {}],
				]);
			}
			return Promise.resolve([]);
		});

		const mockFalkor = {
			query: mockQuery,
		} as unknown as FalkorClient;

		const merger = new GraphMerger(mockFalkor);
		await merger.mergeNodes("target-1", "source-1");

		// Should be called: 1 read + 3 creates + 1 delete = 5
		expect(mockQuery).toHaveBeenCalledTimes(5);
	});
});
