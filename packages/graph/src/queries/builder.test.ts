import { describe, expect, it } from "vitest";
import { MAX_DATE } from "../utils/time";
import { QueryBuilder } from "./builder";

describe("QueryBuilder", () => {
	it("should build simple match query", () => {
		const qb = new QueryBuilder();
		const { cypher, params } = qb.match("(n)").return("n").build();

		expect(cypher).toBe("MATCH (n) RETURN n");
		expect(params).toEqual({});
	});

	it("should build query with where clause", () => {
		const qb = new QueryBuilder();
		const { cypher } = qb.match("(n)").where("n.id = 1").return("n").build();

		expect(cypher).toBe("MATCH (n) WHERE n.id = 1 RETURN n");
	});

	it("should add bitemporal constraints (current)", () => {
		const qb = new QueryBuilder();
		const { cypher, params } = qb.match("(n)").at(["n"], { tt: "current" }).return("n").build();

		expect(cypher).toContain(`MATCH (n) WHERE n.tt_end = ${MAX_DATE} RETURN n`);
	});

	it("should add bitemporal constraints (valid time and transaction time)", () => {
		const qb = new QueryBuilder();
		const { cypher, params } = qb
			.match("(n)")
			.at(["n"], { vt: 1000, tt: 2000 })
			.return("n")
			.build();

		// Uses numbered params to avoid collisions when multiple aliases are used
		expect(cypher).toContain("(n.vt_start <= $vt_0 AND n.vt_end > $vt_0)");
		expect(cypher).toContain("(n.tt_start <= $tt_1 AND n.tt_end > $tt_1)");
		expect(params).toEqual({ vt_0: 1000, tt_1: 2000 });
	});

	it("should add only valid time constraint when vt is provided", () => {
		const qb = new QueryBuilder();
		const { cypher, params } = qb.match("(n)").at(["n"], { vt: 1500 }).return("n").build();

		expect(cypher).toContain("(n.vt_start <= $vt_0 AND n.vt_end > $vt_0)");
		expect(cypher).not.toContain("tt_start");
		expect(params).toEqual({ vt_0: 1500 });
	});

	it("should handle multiple aliases with different constraints", () => {
		const qb = new QueryBuilder();
		const { cypher, params } = qb
			.match("(a)-[:REL]->(b)")
			.at(["a", "b"], { tt: "current" })
			.return("a, b")
			.build();

		expect(cypher).toContain(`a.tt_end = ${MAX_DATE}`);
		expect(cypher).toContain(`b.tt_end = ${MAX_DATE}`);
		expect(params).toEqual({});
	});

	it("should build query without return clause", () => {
		const qb = new QueryBuilder();
		const { cypher } = qb.match("(n)").where("n.id = 1").build();

		expect(cypher).toBe("MATCH (n) WHERE n.id = 1");
	});

	it("should build query with multiple match clauses", () => {
		const qb = new QueryBuilder();
		const { cypher } = qb.match("(a)").match("(b)").return("a, b").build();

		expect(cypher).toBe("MATCH (a), (b) RETURN a, b");
	});

	it("should build query with multiple where clauses combined with AND", () => {
		const qb = new QueryBuilder();
		const { cypher } = qb
			.match("(n)")
			.where("n.id = 1")
			.where("n.type = 'test'")
			.return("n")
			.build();

		expect(cypher).toBe("MATCH (n) WHERE n.id = 1 AND n.type = 'test' RETURN n");
	});

	it("should build query with multiple return clauses", () => {
		const qb = new QueryBuilder();
		const { cypher } = qb.match("(n)").return("n.id").return("n.name").build();

		expect(cypher).toBe("MATCH (n) RETURN n.id, n.name");
	});
});
