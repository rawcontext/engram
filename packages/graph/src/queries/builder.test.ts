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

		expect(cypher).toContain("(n.vt_start <= $vt AND n.vt_end > $vt)");
		expect(cypher).toContain("(n.tt_start <= $tt AND n.tt_end > $tt)");
		expect(params).toEqual({ vt: 1000, tt: 2000 });
	});
});
