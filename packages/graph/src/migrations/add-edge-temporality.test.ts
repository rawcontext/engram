import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { migrateEdgesToBitemporal, verifyEdgeTemporality } from "./add-edge-temporality";

describe("add-edge-temporality migration", () => {
	let mockClient: GraphClient;
	let queryCalls: Array<{ cypher: string; params?: Record<string, unknown> }>;

	beforeEach(() => {
		queryCalls = [];
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async (cypher: string, params?: Record<string, unknown>) => {
				queryCalls.push({ cypher, params });
				// Default: return 0 count for edges needing migration
				if (cypher.includes("count(e)")) {
					return [{ cnt: 0 }];
				}
				return [];
			}),
			isConnected: mock(() => true),
		} as unknown as GraphClient;
	});

	describe("migrateEdgesToBitemporal", () => {
		it("should skip edge types that don't need migration", async () => {
			const result = await migrateEdgesToBitemporal(mockClient);

			expect(result.totalMigrated).toBe(0);
			expect(result.totalSkipped).toBe(0);
			// Should only count queries, not SET queries
			expect(queryCalls.some((c) => c.cypher.includes("SET e.vt_start"))).toBe(false);
		});

		it("should migrate edges that are missing bitemporal fields", async () => {
			// Mock: HAS_TURN edges need migration
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (
						cypher.includes("HAS_TURN") &&
						cypher.includes("vt_start IS NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 5 }]; // 5 edges need migration
					}
					if (
						cypher.includes("HAS_TURN") &&
						cypher.includes("vt_start IS NOT NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 2 }]; // 2 already migrated
					}
					if (cypher.includes("count(e)")) {
						return [{ cnt: 0 }];
					}
					return [];
				},
			);

			const result = await migrateEdgesToBitemporal(mockClient);

			expect(result.totalMigrated).toBe(5);
			expect(result.totalSkipped).toBe(2);

			// Find the migration query for HAS_TURN
			const migrationQuery = queryCalls.find(
				(c) =>
					c.cypher.includes("HAS_TURN") &&
					c.cypher.includes("SET e.vt_start") &&
					c.cypher.includes("WHERE e.vt_start IS NULL"),
			);
			expect(migrationQuery).toBeDefined();
			expect(migrationQuery?.params?.now).toBeDefined();
			expect(migrationQuery?.params?.maxDate).toBe(MAX_DATE);
		});

		it("should set all bitemporal fields correctly", async () => {
			// Mock: NEXT edges need migration
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (
						cypher.includes("NEXT") &&
						cypher.includes("vt_start IS NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 3 }];
					}
					if (
						cypher.includes("NEXT") &&
						cypher.includes("vt_start IS NOT NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 0 }];
					}
					if (cypher.includes("count(e)")) {
						return [{ cnt: 0 }];
					}
					return [];
				},
			);

			await migrateEdgesToBitemporal(mockClient);

			const migrationQuery = queryCalls.find(
				(c) => c.cypher.includes("NEXT") && c.cypher.includes("SET"),
			);
			expect(migrationQuery).toBeDefined();
			expect(migrationQuery?.cypher).toContain("e.vt_start = $now");
			expect(migrationQuery?.cypher).toContain("e.vt_end = $maxDate");
			expect(migrationQuery?.cypher).toContain("e.tt_start = $now");
			expect(migrationQuery?.cypher).toContain("e.tt_end = $maxDate");
		});

		it("should return results per edge type", async () => {
			// Mock: Different edge types need different amounts of migration
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (
						cypher.includes("HAS_TURN") &&
						cypher.includes("vt_start IS NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 10 }];
					}
					if (
						cypher.includes("HAS_TURN") &&
						cypher.includes("vt_start IS NOT NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 5 }];
					}
					if (
						cypher.includes("NEXT") &&
						cypher.includes("vt_start IS NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 8 }];
					}
					if (
						cypher.includes("NEXT") &&
						cypher.includes("vt_start IS NOT NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 2 }];
					}
					if (cypher.includes("count(e)")) {
						return [{ cnt: 0 }];
					}
					return [];
				},
			);

			const result = await migrateEdgesToBitemporal(mockClient);

			expect(result.totalMigrated).toBe(18); // 10 + 8
			expect(result.totalSkipped).toBe(7); // 5 + 2

			const hasTurnResult = result.byEdgeType.find((r) => r.edgeType === "HAS_TURN");
			expect(hasTurnResult?.migratedCount).toBe(10);
			expect(hasTurnResult?.skippedCount).toBe(5);

			const nextResult = result.byEdgeType.find((r) => r.edgeType === "NEXT");
			expect(nextResult?.migratedCount).toBe(8);
			expect(nextResult?.skippedCount).toBe(2);
		});

		it("should be idempotent - uses WHERE vt_start IS NULL", async () => {
			// Mock: Some edges already have bitemporal fields
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (
						cypher.includes("TOUCHES") &&
						cypher.includes("vt_start IS NULL") &&
						cypher.includes("count")
					) {
						return [{ cnt: 3 }];
					}
					if (cypher.includes("count(e)")) {
						return [{ cnt: 0 }];
					}
					return [];
				},
			);

			await migrateEdgesToBitemporal(mockClient);

			// All SET queries should have WHERE e.vt_start IS NULL
			const setQueries = queryCalls.filter((c) => c.cypher.includes("SET"));
			for (const q of setQueries) {
				expect(q.cypher).toContain("WHERE e.vt_start IS NULL");
			}
		});

		it("should include all edge types from EdgeTypes", async () => {
			const result = await migrateEdgesToBitemporal(mockClient);

			// Should have results for all edge types
			const edgeTypes = result.byEdgeType.map((r) => r.edgeType);
			expect(edgeTypes).toContain("HAS_TURN");
			expect(edgeTypes).toContain("NEXT");
			expect(edgeTypes).toContain("CONTAINS");
			expect(edgeTypes).toContain("INVOKES");
			expect(edgeTypes).toContain("TRIGGERS");
			expect(edgeTypes).toContain("TOUCHES");
			expect(edgeTypes).toContain("YIELDS");
			expect(edgeTypes).toContain("MODIFIES");
			expect(edgeTypes).toContain("SNAPSHOT_OF");
			expect(edgeTypes).toContain("REPLACES");
			expect(edgeTypes).toContain("SAME_AS");
			expect(edgeTypes).toContain("SELF_INVOKES");
			expect(edgeTypes).toContain("MENTIONS");
			expect(edgeTypes).toContain("RELATED_TO");
			expect(edgeTypes).toContain("DEPENDS_ON");
			expect(edgeTypes).toContain("IMPLEMENTS");
			expect(edgeTypes).toContain("PART_OF");
		});

		it("should propagate query errors", async () => {
			(mockClient.query as any).mockRejectedValueOnce(new Error("Database connection failed"));

			await expect(migrateEdgesToBitemporal(mockClient)).rejects.toThrow(
				"Database connection failed",
			);
		});
	});

	describe("verifyEdgeTemporality", () => {
		it("should return 0 when all edges have bitemporal fields", async () => {
			// All queries return 0 (no edges missing bitemporal fields)
			const result = await verifyEdgeTemporality(mockClient);

			expect(result).toBe(0);
		});

		it("should return count of edges missing bitemporal fields", async () => {
			(mockClient.query as any).mockImplementation(async (cypher: string) => {
				queryCalls.push({ cypher });
				if (cypher.includes("HAS_TURN") && cypher.includes("vt_start IS NULL")) {
					return [{ cnt: 5 }];
				}
				if (cypher.includes("NEXT") && cypher.includes("vt_start IS NULL")) {
					return [{ cnt: 3 }];
				}
				return [{ cnt: 0 }];
			});

			const result = await verifyEdgeTemporality(mockClient);

			expect(result).toBe(8); // 5 + 3
		});

		it("should query all edge types", async () => {
			await verifyEdgeTemporality(mockClient);

			// Should have one verification query per edge type
			const verifyQueries = queryCalls.filter(
				(c) => c.cypher.includes("vt_start IS NULL") && c.cypher.includes("count(e)"),
			);
			expect(verifyQueries.length).toBeGreaterThanOrEqual(17); // All edge types
		});
	});
});
