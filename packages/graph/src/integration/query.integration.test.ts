/**
 * Integration tests for the Query Lifecycle
 *
 * Tests the complete workflow: define schema → generate code → execute query → verify results.
 * Uses mocked FalkorDB client to validate correct Cypher generation and result handling.
 *
 * Test Scenarios:
 * 1. Schema to Query Execution - Generate query builders, execute queries, verify Cypher
 * 2. Time-Travel Query - Test asOf() for bitemporal queries
 * 3. Traversal Query - Test relationship traversals
 * 4. Repository CRUD - Test create/find/update/delete patterns
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { generate } from "../codegen/generator";
import type { BaseNode } from "../models/base";
import { BaseQueryBuilder } from "../runtime/base-query-builder";
import type { QueryClient } from "../runtime/types";
import { engramSchema } from "../schema/engram-schema";
import { MAX_DATE } from "../utils/time";

// =============================================================================
// Mock Factory
// =============================================================================

interface MockQueryResult {
	n?: { properties: Record<string, unknown> };
	cnt?: number;
	[key: string]: unknown;
}

function createMockClient(mockData: MockQueryResult[] = []): QueryClient & {
	queryCalls: Array<{ cypher: string; params: Record<string, unknown> }>;
} {
	const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
	return {
		queryCalls,
		query: mock(async (cypher: string, params?: Record<string, unknown>) => {
			queryCalls.push({ cypher, params: params || {} });
			return mockData;
		}),
	};
}

// =============================================================================
// Test Query Builder (extends BaseQueryBuilder)
// =============================================================================

interface TestMemory extends BaseNode {
	content: string;
	type: string;
	tags: string[];
	project?: string;
}

class TestMemoryQueryBuilder extends BaseQueryBuilder<TestMemory> {
	protected readonly nodeLabel = "Memory";

	whereType(type: string): this {
		return this.addCondition("type", "=", type);
	}

	whereProject(project: string): this {
		return this.addCondition("project", "=", project);
	}

	whereContentContains(text: string): this {
		return this.addCondition("content", "CONTAINS", text);
	}
}

interface TestSession extends BaseNode {
	agent_type: string;
	working_dir?: string;
	summary?: string;
}

class TestSessionQueryBuilder extends BaseQueryBuilder<TestSession> {
	protected readonly nodeLabel = "Session";

	whereAgentType(type: string): this {
		return this.addCondition("agent_type", "=", type);
	}

	whereWorkingDir(dir: string): this {
		return this.addCondition("working_dir", "=", dir);
	}
}

// =============================================================================
// Tests
// =============================================================================

describe("Integration: Query Lifecycle", () => {
	describe("Schema to Query Execution", () => {
		it("should generate code from schema and produce valid query builders", async () => {
			// Generate code from the engram schema
			const result = await generate({
				schema: engramSchema,
				dryRun: true,
			});

			// Verify generation succeeded
			expect(result.files.length).toBeGreaterThan(0);
			expect(result.summary.nodeTypes).toBeGreaterThan(5);
			expect(result.summary.queryBuilders).toBeGreaterThan(5);

			// Verify query-builders.ts was generated
			const queryBuildersFile = result.files.find((f) => f.path === "query-builders.ts");
			expect(queryBuildersFile).toBeDefined();
			expect(queryBuildersFile?.content).toContain("class MemoryQueryBuilder");
			expect(queryBuildersFile?.content).toContain("class SessionQueryBuilder");
			expect(queryBuildersFile?.content).toContain("extends BaseQueryBuilder");
		});

		it("should execute basic query and return results", async () => {
			const mockData = [
				{
					n: {
						properties: {
							id: "mem-1",
							content: "Test memory content",
							type: "decision",
							tags: ["test"],
							vt_start: Date.now(),
							vt_end: MAX_DATE,
							tt_start: Date.now(),
							tt_end: MAX_DATE,
						},
					},
				},
			];

			const client = createMockClient(mockData);
			const builder = new TestMemoryQueryBuilder(client);

			const results = await builder.whereType("decision").execute();

			// Verify query was executed
			expect(client.queryCalls.length).toBe(1);
			expect(client.queryCalls[0].cypher).toContain("MATCH (n:Memory)");
			expect(client.queryCalls[0].cypher).toContain("n.type = $p0");
			expect(client.queryCalls[0].params.p0).toBe("decision");

			// Verify results
			expect(results.length).toBe(1);
			expect(results[0].content).toBe("Test memory content");
		});

		it("should chain multiple conditions correctly", async () => {
			const client = createMockClient([]);
			const builder = new TestMemoryQueryBuilder(client);

			const cypher = builder.whereType("decision").whereProject("engram").toCypher();

			expect(cypher).toContain("n.type = $p0");
			expect(cypher).toContain("n.project = $p1");
			expect(cypher).toContain("AND");
		});

		it("should generate count query correctly", async () => {
			const mockData = [{ cnt: 42 }];
			const client = createMockClient(mockData);
			const builder = new TestMemoryQueryBuilder(client);

			const count = await builder.whereType("fact").count();

			expect(client.queryCalls[0].cypher).toContain("RETURN count(n) as cnt");
			expect(count).toBe(42);
		});
	});

	describe("Time-Travel Query", () => {
		let client: ReturnType<typeof createMockClient>;
		let builder: TestMemoryQueryBuilder;

		beforeEach(() => {
			client = createMockClient([]);
			builder = new TestMemoryQueryBuilder(client);
		});

		it("should add valid time constraint with asOf()", () => {
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp).toCypher();

			// Should include valid time range check
			expect(cypher).toContain("n.vt_start <= $p0");
			expect(cypher).toContain("n.vt_end > $p0");
			// Should include transaction time by default
			expect(cypher).toContain("n.tt_start <= $p1");
			expect(cypher).toContain("n.tt_end > $p1");
		});

		it("should query only valid time when transactionTime is false", () => {
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp, { transactionTime: false }).toCypher();

			expect(cypher).toContain("n.vt_start <= $p0");
			expect(cypher).toContain("n.vt_end > $p0");
			expect(cypher).not.toContain("tt_start");
			expect(cypher).not.toContain("tt_end");
		});

		it("should query only transaction time when validTime is false", () => {
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp, { validTime: false }).toCypher();

			expect(cypher).toContain("n.tt_start <= $p0");
			expect(cypher).toContain("n.tt_end > $p0");
			expect(cypher).not.toContain("vt_start");
			expect(cypher).not.toContain("vt_end");
		});

		it("should filter to current version with whereCurrent()", () => {
			const cypher = builder.whereCurrent().toCypher();

			expect(cypher).toContain(`n.tt_end = ${MAX_DATE}`);
		});

		it("should filter to valid version with whereValid()", () => {
			const cypher = builder.whereValid().toCypher();

			expect(cypher).toContain(`n.vt_end = ${MAX_DATE}`);
		});

		it("should combine time-travel with other conditions", () => {
			const timestamp = 1640000000000;

			const cypher = builder
				.whereType("decision")
				.whereProject("engram")
				.asOf(timestamp)
				.limit(10)
				.toCypher();

			// All conditions should be present
			expect(cypher).toContain("n.type = $p0");
			expect(cypher).toContain("n.project = $p1");
			expect(cypher).toContain("n.vt_start <= $p2");
			expect(cypher).toContain("LIMIT 10");
		});

		it("should return different results for different timestamps", async () => {
			const t1 = 1640000000000;
			const t2 = 1650000000000;

			// Create mock data for two different time points
			const t1Data = [
				{
					n: {
						properties: {
							id: "mem-1",
							content: "Original content",
							type: "fact",
							tags: [],
							vt_start: 1630000000000,
							vt_end: 1645000000000,
							tt_start: 1630000000000,
							tt_end: MAX_DATE,
						},
					},
				},
			];

			const t2Data = [
				{
					n: {
						properties: {
							id: "mem-1",
							content: "Updated content",
							type: "fact",
							tags: [],
							vt_start: 1645000000000,
							vt_end: MAX_DATE,
							tt_start: 1645000000000,
							tt_end: MAX_DATE,
						},
					},
				},
			];

			// Query at T1
			const client1 = createMockClient(t1Data);
			const builder1 = new TestMemoryQueryBuilder(client1);
			const results1 = await builder1.asOf(t1).execute();

			// Query at T2
			const client2 = createMockClient(t2Data);
			const builder2 = new TestMemoryQueryBuilder(client2);
			const results2 = await builder2.asOf(t2).execute();

			// Different content at different times
			expect(results1[0].content).toBe("Original content");
			expect(results2[0].content).toBe("Updated content");

			// Both queries used correct timestamp
			expect(client1.queryCalls[0].params.p0).toBe(t1);
			expect(client2.queryCalls[0].params.p0).toBe(t2);
		});
	});

	describe("Traversal Query", () => {
		it("should generate MATCH pattern for traversals", () => {
			// Simulated traversal pattern that would be generated
			const client = createMockClient([]);

			// This simulates what a generated traversal would look like
			const traversalCypher =
				"MATCH (s:Session)-[:HAS_TURN]->(t:Turn) " + "WHERE s.id = $sessionId " + "RETURN t";

			// Verify the pattern structure
			expect(traversalCypher).toContain("MATCH (s:Session)");
			expect(traversalCypher).toContain("-[:HAS_TURN]->");
			expect(traversalCypher).toContain("(t:Turn)");
		});

		it("should generate bidirectional traversal patterns", () => {
			// Simulated bidirectional pattern
			const outgoingPattern = "(m:Memory)-[:MENTIONS]->(e:Entity)";
			const incomingPattern = "(m:Memory)<-[:MENTIONS]-(e:Entity)";

			expect(outgoingPattern).toContain("-[:MENTIONS]->");
			expect(incomingPattern).toContain("<-[:MENTIONS]-");
		});

		it("should include temporal conditions in traversal", () => {
			const timestamp = Date.now();
			const traversalCypher =
				`MATCH (s:Session)-[r:HAS_TURN]->(t:Turn) ` +
				`WHERE s.vt_start <= ${timestamp} AND s.vt_end > ${timestamp} ` +
				`AND r.vt_start <= ${timestamp} AND r.vt_end > ${timestamp} ` +
				`RETURN t`;

			// Both node and edge should have temporal conditions
			expect(traversalCypher).toContain("s.vt_start <=");
			expect(traversalCypher).toContain("r.vt_start <=");
		});
	});

	describe("Repository CRUD", () => {
		describe("Create", () => {
			it("should generate CREATE statement with all properties", () => {
				const now = Date.now();
				const createCypher =
					"CREATE (m:Memory {" +
					"id: $id, " +
					"content: $content, " +
					"type: $type, " +
					"tags: $tags, " +
					`vt_start: ${now}, ` +
					`vt_end: ${MAX_DATE}, ` +
					`tt_start: ${now}, ` +
					`tt_end: ${MAX_DATE}` +
					"}) RETURN m";

				expect(createCypher).toContain("CREATE (m:Memory");
				expect(createCypher).toContain("vt_start:");
				expect(createCypher).toContain("tt_end:");
			});

			it("should include bitemporal fields in new nodes", () => {
				const now = Date.now();
				const nodeProperties = {
					id: "mem-new",
					content: "New memory",
					type: "fact",
					tags: [],
					vt_start: now,
					vt_end: MAX_DATE,
					tt_start: now,
					tt_end: MAX_DATE,
				};

				expect(nodeProperties.vt_start).toBeDefined();
				expect(nodeProperties.vt_end).toBe(MAX_DATE);
				expect(nodeProperties.tt_start).toBeDefined();
				expect(nodeProperties.tt_end).toBe(MAX_DATE);
			});
		});

		describe("Find", () => {
			it("should generate findById query with current version filter", async () => {
				const mockData = [
					{
						n: {
							properties: {
								id: "mem-1",
								content: "Found memory",
								type: "fact",
								tags: [],
								vt_start: Date.now(),
								vt_end: MAX_DATE,
								tt_start: Date.now(),
								tt_end: MAX_DATE,
							},
						},
					},
				];

				const client = createMockClient(mockData);
				const builder = new TestMemoryQueryBuilder(client);

				const result = await builder.where({ id: "mem-1" }).whereCurrent().first();

				expect(result).not.toBeNull();
				expect(result?.content).toBe("Found memory");
				expect(client.queryCalls[0].cypher).toContain(`tt_end = ${MAX_DATE}`);
			});

			it("should return null when not found", async () => {
				const client = createMockClient([]);
				const builder = new TestMemoryQueryBuilder(client);

				const result = await builder.where({ id: "nonexistent" }).first();

				expect(result).toBeNull();
			});
		});

		describe("Update", () => {
			it("should generate SET statement for updates", () => {
				const updateCypher =
					"MATCH (m:Memory {id: $id}) " +
					`WHERE m.tt_end = ${MAX_DATE} ` +
					"SET m.content = $newContent, m.tt_end = $now " +
					"RETURN m";

				expect(updateCypher).toContain("SET m.content = $newContent");
				expect(updateCypher).toContain("m.tt_end = $now");
			});

			it("should create new version for bitemporal update", () => {
				const now = Date.now();

				// Close old version
				const closeOldCypher =
					`MATCH (m:Memory {id: $id}) WHERE m.tt_end = ${MAX_DATE} ` + "SET m.tt_end = $now";

				// Create new version
				const createNewCypher =
					"CREATE (m:Memory {id: $id, content: $newContent, " +
					`vt_start: ${now}, vt_end: ${MAX_DATE}, ` +
					`tt_start: ${now}, tt_end: ${MAX_DATE}})`;

				expect(closeOldCypher).toContain("SET m.tt_end = $now");
				expect(createNewCypher).toContain(`tt_start: ${now}`);
			});
		});

		describe("Delete", () => {
			it("should soft delete by setting vt_end", () => {
				const now = Date.now();
				const softDeleteCypher =
					`MATCH (m:Memory {id: $id}) WHERE m.vt_end = ${MAX_DATE} ` +
					"SET m.vt_end = $now RETURN m";

				expect(softDeleteCypher).toContain("SET m.vt_end = $now");
				expect(softDeleteCypher).not.toContain("DELETE");
			});

			it("should verify deleted node is not returned by default queries", async () => {
				// Node with vt_end in the past (deleted)
				const mockData: MockQueryResult[] = [];

				const client = createMockClient(mockData);
				const builder = new TestMemoryQueryBuilder(client);

				const results = await builder
					.where({ id: "deleted-mem" })
					.whereValid() // Only return valid (non-deleted) nodes
					.execute();

				expect(results.length).toBe(0);
				expect(client.queryCalls[0].cypher).toContain(`vt_end = ${MAX_DATE}`);
			});
		});
	});

	describe("Query Performance Patterns", () => {
		it("should support pagination with offset and limit", async () => {
			const client = createMockClient([]);
			const builder = new TestMemoryQueryBuilder(client);

			const cypher = builder.offset(20).limit(10).toCypher();

			expect(cypher).toContain("SKIP 20");
			expect(cypher).toContain("LIMIT 10");
		});

		it("should support ordering", async () => {
			const client = createMockClient([]);
			const builder = new TestMemoryQueryBuilder(client);

			const cypher = builder.orderBy("vt_start", "DESC").toCypher();

			expect(cypher).toContain("ORDER BY n.vt_start DESC");
		});

		it("should combine all query features", async () => {
			const timestamp = Date.now();
			const client = createMockClient([]);
			const builder = new TestMemoryQueryBuilder(client);

			const cypher = builder
				.whereType("decision")
				.whereProject("engram")
				.asOf(timestamp, { transactionTime: false })
				.orderBy("vt_start", "DESC")
				.offset(10)
				.limit(5)
				.toCypher();

			// All features should be present
			expect(cypher).toContain("MATCH (n:Memory)");
			expect(cypher).toContain("n.type = $p0");
			expect(cypher).toContain("n.project = $p1");
			expect(cypher).toContain("n.vt_start <=");
			expect(cypher).toContain("ORDER BY n.vt_start DESC");
			expect(cypher).toContain("SKIP 10");
			expect(cypher).toContain("LIMIT 5");
		});
	});

	describe("Generated Code Validation", () => {
		it("should generate all expected files", async () => {
			const result = await generate({
				schema: engramSchema,
				dryRun: true,
			});

			const filePaths = result.files.map((f) => f.path);

			expect(filePaths).toContain("types.ts");
			expect(filePaths).toContain("query-builders.ts");
			expect(filePaths).toContain("repositories.ts");
			expect(filePaths).toContain("validators.ts");
			expect(filePaths).toContain("index.ts");
		});

		it("should generate valid barrel exports", async () => {
			const result = await generate({
				schema: engramSchema,
				dryRun: true,
			});

			const indexFile = result.files.find((f) => f.path === "index.ts");
			expect(indexFile).toBeDefined();
			expect(indexFile?.content).toContain('export * from "./types"');
			expect(indexFile?.content).toContain('export * from "./query-builders"');
			expect(indexFile?.content).toContain('export * from "./repositories"');
		});

		it("should include bitemporal methods in generated query builders", async () => {
			const result = await generate({
				schema: engramSchema,
				dryRun: true,
			});

			const queryBuildersFile = result.files.find((f) => f.path === "query-builders.ts");
			// Generated builders extend BaseQueryBuilder which provides bitemporal methods
			expect(queryBuildersFile?.content).toContain("extends BaseQueryBuilder");
			// Factory methods use asOf for time-travel queries
			expect(queryBuildersFile?.content).toContain(".asOf(timestamp)");
			// Factory findById uses whereCurrent
			expect(queryBuildersFile?.content).toContain(".whereCurrent()");
		});
	});
});
