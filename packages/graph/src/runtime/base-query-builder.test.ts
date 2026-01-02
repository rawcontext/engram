import { describe, expect, it, mock } from "bun:test";
import type { BaseNode } from "../models/base";
import { MAX_DATE } from "../utils/time";
import { BaseQueryBuilder } from "./base-query-builder";
import type { QueryClient } from "./types";

// Test node type
interface TestNode extends BaseNode {
	name: string;
	age: number;
	type: string;
}

// Concrete implementation for testing
class TestQueryBuilder extends BaseQueryBuilder<TestNode> {
	protected readonly nodeLabel = "TestNode";

	byName(name: string): this {
		return this.addCondition("name", "=", name);
	}

	byType(type: string): this {
		return this.addCondition("type", "=", type);
	}

	olderThan(age: number): this {
		return this.addCondition("age", ">", age);
	}
}

// Mock client factory
function createMockClient(mockData: unknown[] = []): QueryClient {
	return {
		query: mock(async () => mockData),
	};
}

describe("BaseQueryBuilder", () => {
	describe("toCypher", () => {
		it("should generate simple MATCH query", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n");
		});

		it("should generate query with where conditions", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.where({ name: "Alice" }).toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) WHERE n.name = $p0 RETURN n");
		});

		it("should generate query with multiple where conditions", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.where({ name: "Alice", type: "admin" }).toCypher();

			expect(cypher).toContain("n.name = $p0");
			expect(cypher).toContain("n.type = $p1");
			expect(cypher).toContain("AND");
		});

		it("should skip undefined values in where", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.where({ name: "Alice", type: undefined }).toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) WHERE n.name = $p0 RETURN n");
			expect(cypher).not.toContain("type");
		});

		it("should generate query with limit", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.limit(10).toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n LIMIT 10");
		});

		it("should generate query with offset", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.offset(5).toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n SKIP 5");
		});

		it("should generate query with limit and offset", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.limit(10).offset(5).toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n SKIP 5 LIMIT 10");
		});

		it("should generate query with order by ascending", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.orderBy("name").toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n ORDER BY n.name ASC");
		});

		it("should generate query with order by descending", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.orderBy("age", "DESC").toCypher();

			expect(cypher).toBe("MATCH (n:TestNode) RETURN n ORDER BY n.age DESC");
		});

		it("should generate complete query with all clauses", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder
				.where({ type: "admin" })
				.orderBy("name", "ASC")
				.offset(10)
				.limit(5)
				.toCypher();

			expect(cypher).toBe(
				"MATCH (n:TestNode) WHERE n.type = $p0 RETURN n ORDER BY n.name ASC SKIP 10 LIMIT 5",
			);
		});
	});

	describe("whereCurrent", () => {
		it("should add tt_end = MAX_DATE condition", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.whereCurrent().toCypher();

			expect(cypher).toContain(`n.tt_end = ${MAX_DATE}`);
		});
	});

	describe("whereValid", () => {
		it("should add vt_end = MAX_DATE condition", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.whereValid().toCypher();

			expect(cypher).toContain(`n.vt_end = ${MAX_DATE}`);
		});
	});

	describe("asOf", () => {
		it("should add both valid time and transaction time conditions by default", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp).toCypher();

			expect(cypher).toContain("n.vt_start <= $p0 AND n.vt_end > $p0");
			expect(cypher).toContain("n.tt_start <= $p1 AND n.tt_end > $p1");
		});

		it("should add only valid time condition when transactionTime is false", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp, { transactionTime: false }).toCypher();

			expect(cypher).toContain("n.vt_start <= $p0 AND n.vt_end > $p0");
			expect(cypher).not.toContain("tt_start");
		});

		it("should add only transaction time condition when validTime is false", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);
			const timestamp = 1640000000000;

			const cypher = builder.asOf(timestamp, { validTime: false }).toCypher();

			expect(cypher).toContain("n.tt_start <= $p0 AND n.tt_end > $p0");
			expect(cypher).not.toContain("vt_start");
		});

		it("should set correct parameter values", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);
			const timestamp = 1640000000000;

			builder.asOf(timestamp);
			const params = builder.getParams();

			expect(params.p0).toBe(timestamp);
			expect(params.p1).toBe(timestamp);
		});
	});

	describe("custom methods via addCondition", () => {
		it("should support equality conditions", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.byName("Bob").toCypher();

			expect(cypher).toContain("n.name = $p0");
		});

		it("should support comparison operators", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.olderThan(30).toCypher();

			expect(cypher).toContain("n.age > $p0");
		});

		it("should chain multiple custom conditions", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const cypher = builder.byName("Bob").byType("admin").olderThan(25).toCypher();

			expect(cypher).toContain("n.name = $p0");
			expect(cypher).toContain("n.type = $p1");
			expect(cypher).toContain("n.age > $p2");
		});
	});

	describe("getParams", () => {
		it("should return a copy of params", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			builder.where({ name: "Alice", age: 30 });
			const params = builder.getParams();

			expect(params.p0).toBe("Alice");
			expect(params.p1).toBe(30);
		});

		it("should not expose internal params reference", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			builder.where({ name: "Alice" });
			const params1 = builder.getParams();
			const params2 = builder.getParams();

			expect(params1).not.toBe(params2);
		});
	});

	describe("reset", () => {
		it("should clear all state", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			builder.where({ name: "Alice" }).limit(10).offset(5).orderBy("name");

			const cypherBefore = builder.toCypher();
			expect(cypherBefore).toContain("name");
			expect(cypherBefore).toContain("LIMIT");

			builder.reset();
			const cypherAfter = builder.toCypher();

			expect(cypherAfter).toBe("MATCH (n:TestNode) RETURN n");
		});
	});

	describe("execute", () => {
		it("should call client.query with generated cypher and params", async () => {
			const mockData = [
				{ n: { properties: { id: "1", labels: [], name: "Alice", age: 30, type: "user" } } },
			];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			await builder.where({ name: "Alice" }).execute();

			expect(client.query).toHaveBeenCalledWith(
				"MATCH (n:TestNode) WHERE n.name = $p0 RETURN n",
				{ p0: "Alice" },
			);
		});

		it("should extract properties from result", async () => {
			const mockData = [
				{
					n: {
						properties: {
							id: "1",
							labels: ["TestNode"],
							name: "Alice",
							age: 30,
							type: "user",
							vt_start: 0,
							vt_end: MAX_DATE,
							tt_start: 0,
							tt_end: MAX_DATE,
						},
					},
				},
			];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			const results = await builder.execute();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Alice");
			expect(results[0].age).toBe(30);
		});
	});

	describe("first", () => {
		it("should return first result", async () => {
			const mockData = [
				{ n: { properties: { id: "1", labels: [], name: "Alice", age: 30, type: "user" } } },
				{ n: { properties: { id: "2", labels: [], name: "Bob", age: 25, type: "user" } } },
			];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			const result = await builder.first();

			expect(result?.name).toBe("Alice");
		});

		it("should return null when no results", async () => {
			const client = createMockClient([]);
			const builder = new TestQueryBuilder(client);

			const result = await builder.first();

			expect(result).toBeNull();
		});

		it("should add LIMIT 1 to query", async () => {
			const client = createMockClient([]);
			const builder = new TestQueryBuilder(client);

			await builder.first();

			expect(client.query).toHaveBeenCalledWith(
				expect.stringContaining("LIMIT 1"),
				expect.any(Object),
			);
		});
	});

	describe("count", () => {
		it("should call client.query with count cypher", async () => {
			const mockData = [{ cnt: 42 }];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			const count = await builder.where({ type: "admin" }).count();

			expect(client.query).toHaveBeenCalledWith(
				"MATCH (n:TestNode) WHERE n.type = $p0 RETURN count(n) as cnt",
				{ p0: "admin" },
			);
			expect(count).toBe(42);
		});

		it("should return 0 when no results", async () => {
			const client = createMockClient([]);
			const builder = new TestQueryBuilder(client);

			const count = await builder.count();

			expect(count).toBe(0);
		});
	});

	describe("exists", () => {
		it("should return true when count > 0", async () => {
			const mockData = [{ cnt: 5 }];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			const exists = await builder.exists();

			expect(exists).toBe(true);
		});

		it("should return false when count is 0", async () => {
			const mockData = [{ cnt: 0 }];
			const client = createMockClient(mockData);
			const builder = new TestQueryBuilder(client);

			const exists = await builder.exists();

			expect(exists).toBe(false);
		});
	});

	describe("fluent chaining", () => {
		it("should return this for all chainable methods", () => {
			const client = createMockClient();
			const builder = new TestQueryBuilder(client);

			const result = builder
				.where({ name: "test" })
				.whereCurrent()
				.whereValid()
				.asOf(1000)
				.limit(10)
				.offset(5)
				.orderBy("name")
				.reset();

			expect(result).toBe(builder);
		});
	});
});
