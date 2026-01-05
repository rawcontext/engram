import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { GraphClient } from "@engram/storage";
import { createEntityIndexes } from "./entity-indexes";

describe("entity-indexes migration", () => {
	let mockClient: GraphClient;
	let queryCalls: Array<{ cypher: string; params?: Record<string, unknown> }>;

	beforeEach(() => {
		queryCalls = [];
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async (cypher: string, params?: Record<string, unknown>) => {
				queryCalls.push({ cypher, params });
				return [];
			}),
			isConnected: mock(() => true),
		} as unknown as GraphClient;
	});

	describe("createEntityIndexes", () => {
		it("should create exact match index on Entity.name", async () => {
			await createEntityIndexes(mockClient);

			const query = queryCalls.find(
				(c) =>
					c.cypher.includes("Entity") &&
					c.cypher.includes("e.name") &&
					!c.cypher.includes("fulltext"),
			);
			expect(query).toBeDefined();
			expect(query?.cypher).toContain("CREATE INDEX IF NOT EXISTS");
		});

		it("should create exact match index on Entity.type", async () => {
			await createEntityIndexes(mockClient);

			const query = queryCalls.find(
				(c) => c.cypher.includes("Entity") && c.cypher.includes("e.type"),
			);
			expect(query).toBeDefined();
			expect(query?.cypher).toContain("CREATE INDEX IF NOT EXISTS");
		});

		it("should create full-text index on Entity.name", async () => {
			await createEntityIndexes(mockClient);

			const query = queryCalls.find(
				(c) => c.cypher.includes("fulltext") && c.cypher.includes("Entity"),
			);
			expect(query).toBeDefined();
			expect(query?.cypher).toContain("createNodeIndex");
		});

		it("should handle pre-existing full-text index gracefully", async () => {
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (cypher.includes("fulltext")) {
						throw new Error("Index already exists");
					}
					return [];
				},
			);

			// Should not throw
			await expect(createEntityIndexes(mockClient)).resolves.toBeUndefined();
		});

		it("should handle already defined full-text index gracefully", async () => {
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (cypher.includes("fulltext")) {
						throw new Error("Index already defined for this pattern");
					}
					return [];
				},
			);

			// Should not throw
			await expect(createEntityIndexes(mockClient)).resolves.toBeUndefined();
		});

		it("should propagate unexpected full-text index errors", async () => {
			(mockClient.query as any).mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params });
					if (cypher.includes("fulltext")) {
						throw new Error("Connection timeout");
					}
					return [];
				},
			);

			await expect(createEntityIndexes(mockClient)).rejects.toThrow("Connection timeout");
		});

		it("should create vector index on Entity.embedding", async () => {
			await createEntityIndexes(mockClient);

			const query = queryCalls.find(
				(c) => c.cypher.includes("VECTOR INDEX") && c.cypher.includes("e.embedding"),
			);
			expect(query).toBeDefined();
			expect(query?.cypher).toContain("dimension: 384");
			expect(query?.cypher).toContain("cosine");
		});

		it("should create temporal indexes on MENTIONS edges", async () => {
			await createEntityIndexes(mockClient);

			const mentionsIndexes = queryCalls.filter((c) => c.cypher.includes("MENTIONS"));
			expect(mentionsIndexes).toHaveLength(4); // vt_start, vt_end, tt_start, tt_end

			const fields = ["vt_start", "vt_end", "tt_start", "tt_end"];
			for (const field of fields) {
				expect(mentionsIndexes.some((q) => q.cypher.includes(`m.${field}`))).toBe(true);
			}
		});

		it("should create temporal indexes on RELATED_TO edges", async () => {
			await createEntityIndexes(mockClient);

			const relatedToIndexes = queryCalls.filter((c) => c.cypher.includes("RELATED_TO"));
			expect(relatedToIndexes).toHaveLength(4); // vt_start, vt_end, tt_start, tt_end

			const fields = ["vt_start", "vt_end", "tt_start", "tt_end"];
			for (const field of fields) {
				expect(relatedToIndexes.some((q) => q.cypher.includes(`r.${field}`))).toBe(true);
			}
		});

		it("should propagate query errors", async () => {
			(mockClient.query as any).mockRejectedValueOnce(new Error("Database connection failed"));

			await expect(createEntityIndexes(mockClient)).rejects.toThrow("Database connection failed");
		});

		it("should use idempotent CREATE INDEX IF NOT EXISTS", async () => {
			await createEntityIndexes(mockClient);

			// All regular index queries should use IF NOT EXISTS
			const regularIndexQueries = queryCalls.filter(
				(c) => c.cypher.includes("CREATE INDEX") || c.cypher.includes("CREATE VECTOR INDEX"),
			);
			for (const query of regularIndexQueries) {
				expect(query.cypher).toContain("IF NOT EXISTS");
			}
		});
	});
});
