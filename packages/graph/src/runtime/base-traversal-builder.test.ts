import { describe, expect, it, mock } from "bun:test";
import { MAX_DATE } from "../utils/time";
import { BaseTraversalBuilder, traverse } from "./base-traversal-builder";
import type { QueryClient } from "./types";

// Mock client factory
function createMockClient(mockData: unknown[] = []): QueryClient {
	return {
		query: mock(async () => mockData),
	};
}

describe("BaseTraversalBuilder", () => {
	describe("from", () => {
		it("should set the starting node", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session", { id: "abc123" }).toCypher();

			expect(cypher).toContain("MATCH (n0:Session {id: $p0})");
		});

		it("should support custom alias", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session", {}, "s").toCypher();

			expect(cypher).toContain("MATCH (s:Session)");
			expect(cypher).toContain("RETURN s");
		});
	});

	describe("via and to", () => {
		it("should generate single-hop traversal", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").toCypher();

			expect(cypher).toBe("MATCH (n0:Session)-[:HAS_TURN]->(n1:Turn) RETURN n1");
		});

		it("should generate multi-hop traversal", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session")
				.via("HAS_TURN")
				.to("Turn")
				.via("INVOKES")
				.to("ToolCall")
				.toCypher();

			expect(cypher).toBe(
				"MATCH (n0:Session)-[:HAS_TURN]->(n1:Turn)-[:INVOKES]->(n2:ToolCall) RETURN n2",
			);
		});

		it("should support multiple edge types", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Turn").via(["INVOKES", "CONTAINS"]).to("Node").toCypher();

			expect(cypher).toContain("-[:INVOKES|CONTAINS]->");
		});

		it("should support target conditions", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session", { id: "s1" })
				.via("HAS_TURN")
				.to("Turn", { sequence_index: 0 })
				.toCypher();

			expect(cypher).toContain("(n1:Turn {sequence_index: $p1})");
		});
	});

	describe("direction", () => {
		it("should support incoming direction", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("HAS_TURN", { direction: "incoming" })
				.to("Session")
				.toCypher();

			expect(cypher).toContain("<-[:HAS_TURN]-");
		});

		it("should support viaIncoming helper", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Turn").viaIncoming("HAS_TURN").to("Session").toCypher();

			expect(cypher).toContain("<-[:HAS_TURN]-");
		});

		it("should support any direction", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Entity").viaAny("RELATED_TO").to("Entity").toCypher();

			expect(cypher).toContain("-[:RELATED_TO]-");
			expect(cypher).not.toContain("->");
			expect(cypher).not.toContain("<-");
		});
	});

	describe("variable-length paths", () => {
		it("should support min and max hops", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("NEXT", { pathLength: { min: 1, max: 5 } })
				.to("Turn")
				.toCypher();

			expect(cypher).toContain("-[:NEXT*1..5]->");
		});

		it("should support hops() method", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Turn").via("NEXT").hops(1, 5).to("Turn").toCypher();

			expect(cypher).toContain("-[:NEXT*1..5]->");
		});

		it("should support exact hop count", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("NEXT", { pathLength: { min: 3, max: 3 } })
				.to("Turn")
				.toCypher();

			expect(cypher).toContain("-[:NEXT*3]->");
		});

		it("should support unbounded max", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("NEXT", { pathLength: { min: 1 } })
				.to("Turn")
				.toCypher();

			expect(cypher).toContain("-[:NEXT*1..]->");
		});

		it("should support unbounded min", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("NEXT", { pathLength: { max: 10 } })
				.to("Turn")
				.toCypher();

			expect(cypher).toContain("-[:NEXT*..10]->");
		});
	});

	describe("edge conditions", () => {
		it("should add edge property conditions", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Memory")
				.via("RELATED_TO", { edgeAlias: "rel" })
				.whereEdge("strength", ">=", 0.8)
				.to("Entity")
				.toCypher();

			expect(cypher).toContain("-[rel:RELATED_TO]->");
			expect(cypher).toContain("WHERE rel.strength >= $p0");
		});

		it("should add raw edge conditions", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Memory")
				.via("MENTIONS", { edgeAlias: "m" })
				.whereEdgeRaw("m.context IS NOT NULL")
				.to("Entity")
				.toCypher();

			expect(cypher).toContain("WHERE m.context IS NOT NULL");
		});
	});

	describe("bitemporal constraints", () => {
		it("should add whereCurrent constraint", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").whereCurrent().toCypher();

			expect(cypher).toContain(`n0.tt_end = ${MAX_DATE}`);
			expect(cypher).toContain(`n1.tt_end = ${MAX_DATE}`);
		});

		it("should add asOf constraint for both time dimensions", () => {
			const client = createMockClient();
			const builder = traverse(client);
			const timestamp = 1640000000000;

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").asOf(timestamp).toCypher();

			expect(cypher).toContain("n0.tt_start <= $p0 AND n0.tt_end > $p0");
			expect(cypher).toContain("n0.vt_start <= $p1 AND n0.vt_end > $p1");
		});

		it("should add asOf constraint with edge alias", () => {
			const client = createMockClient();
			const builder = traverse(client);
			const timestamp = 1640000000000;

			const cypher = builder
				.from("Session")
				.via("HAS_TURN", { edgeAlias: "e" })
				.to("Turn")
				.asOf(timestamp)
				.toCypher();

			expect(cypher).toContain("e.tt_start");
			expect(cypher).toContain("e.vt_start");
		});
	});

	describe("pagination and ordering", () => {
		it("should add limit", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").limit(10).toCypher();

			expect(cypher).toContain("LIMIT 10");
		});

		it("should add offset", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").offset(5).toCypher();

			expect(cypher).toContain("SKIP 5");
		});

		it("should add order by", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session")
				.via("HAS_TURN")
				.to("Turn")
				.orderBy("n1", "sequence_index", "ASC")
				.toCypher();

			expect(cypher).toContain("ORDER BY n1.sequence_index ASC");
		});

		it("should combine pagination and ordering", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session")
				.via("HAS_TURN")
				.to("Turn")
				.orderBy("n1", "sequence_index", "DESC")
				.offset(5)
				.limit(10)
				.toCypher();

			expect(cypher).toContain("ORDER BY n1.sequence_index DESC");
			expect(cypher).toContain("SKIP 5");
			expect(cypher).toContain("LIMIT 10");
		});
	});

	describe("return specification", () => {
		it("should return last node by default", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").toCypher();

			expect(cypher).toContain("RETURN n1");
		});

		it("should support custom return aliases", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session", {}, "s")
				.via("HAS_TURN")
				.to("Turn", {}, "t")
				.returning("s", "t")
				.toCypher();

			expect(cypher).toContain("RETURN s, t");
		});

		it("should support distinct", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder.from("Session").via("HAS_TURN").to("Turn").distinct().toCypher();

			expect(cypher).toContain("RETURN DISTINCT n1");
		});
	});

	describe("execute", () => {
		it("should call client.query with generated cypher and params", async () => {
			const mockData = [{ n1: { properties: { id: "t1", sequence_index: 0 } } }];
			const client = createMockClient(mockData);
			const builder = traverse(client);

			await builder.from("Session", { id: "s1" }).via("HAS_TURN").to("Turn").execute();

			expect(client.query).toHaveBeenCalledWith(
				"MATCH (n0:Session {id: $p0})-[:HAS_TURN]->(n1:Turn) RETURN n1",
				{ p0: "s1" },
			);
		});

		it("should extract properties from result", async () => {
			const mockData = [
				{ n1: { properties: { id: "t1", sequence_index: 0 } } },
				{ n1: { properties: { id: "t2", sequence_index: 1 } } },
			];
			const client = createMockClient(mockData);
			const builder = traverse<{ id: string; sequence_index: number }>(client);

			const results = await builder
				.from("Session", { id: "s1" })
				.via("HAS_TURN")
				.to("Turn")
				.execute();

			expect(results).toHaveLength(2);
			expect(results[0].id).toBe("t1");
			expect(results[1].sequence_index).toBe(1);
		});

		it("should extract multiple aliases when returning multiple", async () => {
			const mockData = [
				{
					s: { properties: { id: "s1" } },
					t: { properties: { id: "t1" } },
				},
			];
			const client = createMockClient(mockData);
			const builder = traverse<{ s: { id: string }; t: { id: string } }>(client);

			const results = await builder
				.from("Session", {}, "s")
				.via("HAS_TURN")
				.to("Turn", {}, "t")
				.returning("s", "t")
				.execute();

			expect(results).toHaveLength(1);
			expect(results[0].s.id).toBe("s1");
			expect(results[0].t.id).toBe("t1");
		});
	});

	describe("first", () => {
		it("should return first result", async () => {
			const mockData = [{ n1: { properties: { id: "t1" } } }, { n1: { properties: { id: "t2" } } }];
			const client = createMockClient(mockData);
			const builder = traverse<{ id: string }>(client);

			const result = await builder.from("Session").via("HAS_TURN").to("Turn").first();

			expect(result?.id).toBe("t1");
		});

		it("should return null when no results", async () => {
			const client = createMockClient([]);
			const builder = traverse(client);

			const result = await builder.from("Session").via("HAS_TURN").to("Turn").first();

			expect(result).toBeNull();
		});

		it("should add LIMIT 1 to query", async () => {
			const client = createMockClient([]);
			const builder = traverse(client);

			await builder.from("Session").via("HAS_TURN").to("Turn").first();

			expect(client.query).toHaveBeenCalledWith(
				expect.stringContaining("LIMIT 1"),
				expect.any(Object),
			);
		});
	});

	describe("count", () => {
		it("should generate count query", async () => {
			const mockData = [{ cnt: 42 }];
			const client = createMockClient(mockData);
			const builder = traverse(client);

			const count = await builder.from("Session", { id: "s1" }).via("HAS_TURN").to("Turn").count();

			expect(client.query).toHaveBeenCalledWith(
				"MATCH (n0:Session {id: $p0})-[:HAS_TURN]->(n1:Turn) RETURN count(n1) as cnt",
				{ p0: "s1" },
			);
			expect(count).toBe(42);
		});

		it("should return 0 when no results", async () => {
			const client = createMockClient([]);
			const builder = traverse(client);

			const count = await builder.from("Session").via("HAS_TURN").to("Turn").count();

			expect(count).toBe(0);
		});

		it("should support distinct count", async () => {
			const mockData = [{ cnt: 10 }];
			const client = createMockClient(mockData);
			const builder = traverse(client);

			await builder.from("Session").via("HAS_TURN").to("Turn").distinct().count();

			expect(client.query).toHaveBeenCalledWith(
				expect.stringContaining("count(DISTINCT n1)"),
				expect.any(Object),
			);
		});
	});

	describe("exists", () => {
		it("should return true when count > 0", async () => {
			const mockData = [{ cnt: 5 }];
			const client = createMockClient(mockData);
			const builder = traverse(client);

			const exists = await builder.from("Session").via("HAS_TURN").to("Turn").exists();

			expect(exists).toBe(true);
		});

		it("should return false when count is 0", async () => {
			const mockData = [{ cnt: 0 }];
			const client = createMockClient(mockData);
			const builder = traverse(client);

			const exists = await builder.from("Session").via("HAS_TURN").to("Turn").exists();

			expect(exists).toBe(false);
		});
	});

	describe("reset", () => {
		it("should clear all state", () => {
			const client = createMockClient();
			const builder = traverse(client);

			builder
				.from("Session", { id: "s1" })
				.via("HAS_TURN")
				.to("Turn")
				.whereCurrent()
				.limit(10)
				.offset(5);

			const cypherBefore = builder.toCypher();
			expect(cypherBefore).toContain("Session");

			builder.reset();
			const cypherAfter = builder.from("Memory").toCypher();

			expect(cypherAfter).toBe("MATCH (n0:Memory) RETURN n0");
			expect(cypherAfter).not.toContain("Session");
			expect(cypherAfter).not.toContain("LIMIT");
		});
	});

	describe("getParams", () => {
		it("should return a copy of params", () => {
			const client = createMockClient();
			const builder = traverse(client);

			builder.from("Session", { id: "s1" });
			builder.toCypher(); // Force param generation
			const params = builder.getParams();

			expect(params.p0).toBe("s1");
		});
	});

	describe("fluent chaining", () => {
		it("should return this for all chainable methods", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const result = builder
				.from("Session")
				.via("HAS_TURN")
				.hops(1, 5)
				.whereEdge("type", "=", "test")
				.to("Turn")
				.whereCurrent()
				.asOf(1000)
				.limit(10)
				.offset(5)
				.orderBy("n1", "id", "ASC")
				.returning("n1")
				.distinct()
				.reset()
				.from("Memory");

			expect(result).toBe(builder);
		});
	});

	describe("traverse factory", () => {
		it("should create a new builder", () => {
			const client = createMockClient();
			const builder = traverse(client);

			expect(builder).toBeInstanceOf(BaseTraversalBuilder);
		});
	});

	describe("complex traversal patterns", () => {
		it("should handle Session -> Turn -> ToolCall -> FileTouch pattern", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Session", { id: "s1" })
				.via("HAS_TURN")
				.to("Turn")
				.via("INVOKES")
				.to("ToolCall")
				.via("TOUCHES")
				.to("FileTouch", { action: "edit" })
				.whereCurrent()
				.toCypher();

			expect(cypher).toContain(
				"(n0:Session {id: $p0})-[:HAS_TURN]->(n1:Turn)-[:INVOKES]->(n2:ToolCall)-[:TOUCHES]->(n3:FileTouch {action: $p1})",
			);
			expect(cypher).toContain("RETURN n3");
		});

		it("should handle Turn -> Reasoning <- ToolCall pattern (with Triggers)", () => {
			const client = createMockClient();
			const builder = traverse(client);

			const cypher = builder
				.from("Turn")
				.via("CONTAINS")
				.to("Reasoning")
				.via("TRIGGERS", { direction: "incoming" })
				.to("ToolCall")
				.toCypher();

			expect(cypher).toContain("-[:CONTAINS]->");
			expect(cypher).toContain("<-[:TRIGGERS]-");
		});
	});
});
