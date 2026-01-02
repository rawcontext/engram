import { describe, expect, test } from "bun:test";
import { edge } from "../schema/edge";
import { field } from "../schema/field";
import { node } from "../schema/node";
import { defineSchema } from "../schema/schema";
import {
	engramSchemaPlugin,
	findSimilar,
	levenshteinDistance,
	validateCypherQuery,
	validateFileQueries,
} from "./bun-plugin";

// Test schema
const testSchema = defineSchema({
	nodes: {
		Memory: node({
			content: field.string(),
			type: field.enum(["decision", "insight", "fact"] as const),
			importance: field.float().optional(),
		}),
		Session: node({
			summary: field.string().optional(),
			started: field.int(),
		}),
	},
	edges: {
		CONTAINS: edge({
			position: field.int(),
		}),
		RELATES_TO: edge({}),
	},
});

describe("levenshteinDistance", () => {
	test("returns 0 for identical strings", () => {
		expect(levenshteinDistance("hello", "hello")).toBe(0);
	});

	test("returns correct distance for single character difference", () => {
		expect(levenshteinDistance("cat", "bat")).toBe(1);
		expect(levenshteinDistance("cat", "cats")).toBe(1);
		expect(levenshteinDistance("cats", "cat")).toBe(1);
	});

	test("returns correct distance for multiple differences", () => {
		expect(levenshteinDistance("kitten", "sitting")).toBe(3);
		expect(levenshteinDistance("Memory", "Memry")).toBe(1);
	});

	test("handles empty strings", () => {
		expect(levenshteinDistance("", "")).toBe(0);
		expect(levenshteinDistance("abc", "")).toBe(3);
		expect(levenshteinDistance("", "abc")).toBe(3);
	});
});

describe("findSimilar", () => {
	test("finds similar strings within max distance", () => {
		const candidates = new Set(["Memory", "Session", "Decision"]);
		const similar = findSimilar("Memry", candidates, 2);
		expect(similar).toContain("Memory");
	});

	test("returns empty array when no matches", () => {
		const candidates = new Set(["Memory", "Session"]);
		const similar = findSimilar("XYZ", candidates, 2);
		expect(similar).toEqual([]);
	});

	test("limits results to 3 suggestions", () => {
		const candidates = new Set(["aa", "ab", "ac", "ad", "ae"]);
		const similar = findSimilar("a", candidates, 3);
		expect(similar.length).toBeLessThanOrEqual(3);
	});

	test("is case insensitive", () => {
		const candidates = new Set(["MEMORY", "Session"]);
		// "memry" (typo) should match "MEMORY" when lowercased
		const similar = findSimilar("MEMRY", candidates, 2);
		expect(similar).toContain("MEMORY");
	});
});

describe("validateCypherQuery", () => {
	test("returns empty array for valid query", () => {
		const query = "MATCH (m:Memory) RETURN m";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors).toEqual([]);
	});

	test("returns empty array for valid query with multiple labels", () => {
		const query = "MATCH (m:Memory)-[:CONTAINS]->(s:Session) RETURN m, s";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors).toEqual([]);
	});

	test("detects unknown node label", () => {
		const query = "MATCH (m:Memry) RETURN m";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors.length).toBe(1);
		expect(errors[0]).toContain("Unknown node label 'Memry'");
		expect(errors[0]).toContain("Memory");
	});

	test("detects unknown relationship type", () => {
		const query = "MATCH (m:Memory)-[:CONTANS]->(s:Session) RETURN m";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors.length).toBe(1);
		expect(errors[0]).toContain("Unknown relationship type 'CONTANS'");
		expect(errors[0]).toContain("CONTAINS");
	});

	test("detects multiple errors", () => {
		const query = "MATCH (m:Memry)-[:CONTANS]->(s:Sesion) RETURN m";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors.length).toBe(3);
	});

	test("handles variable-length paths", () => {
		const query = "MATCH (m:Memory)-[:CONTAINS*1..3]->(s:Session) RETURN m";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors).toEqual([]);
	});

	test("handles anonymous nodes", () => {
		const query = "MATCH (:Memory)-[:CONTAINS]->(:Session) RETURN count(*)";
		const errors = validateCypherQuery(query, testSchema);
		expect(errors).toEqual([]);
	});
});

describe("validateFileQueries", () => {
	test("returns empty array for file without queries", () => {
		const contents = `
const x = 1;
const y = 2;
`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors).toEqual([]);
	});

	test("returns empty array for valid query", () => {
		const contents = `
const result = await falkor.query(\`MATCH (m:Memory) RETURN m\`);
`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors).toEqual([]);
	});

	test("detects invalid query and includes line number", () => {
		const contents = `const x = 1;
const y = 2;
const result = await falkor.query(\`MATCH (m:Memry) RETURN m\`);
`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors.length).toBe(1);
		expect(errors[0].line).toBe(3);
		expect(errors[0].message).toContain("Unknown node label 'Memry'");
	});

	test("detects multiple invalid queries", () => {
		const contents = `
const result1 = await falkor.query(\`MATCH (m:Memry) RETURN m\`);
const result2 = await falkor.query(\`MATCH (s:Sesion) RETURN s\`);
`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors.length).toBe(2);
	});

	test("handles client.query variant", () => {
		const contents = `const result = await client.query(\`MATCH (m:Memry) RETURN m\`);`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors.length).toBe(1);
	});

	test("handles graph.query variant", () => {
		const contents = `const result = await graph.query(\`MATCH (m:Memry) RETURN m\`);`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors.length).toBe(1);
	});

	test("truncates long queries in error", () => {
		const longQuery =
			"MATCH (m:Memry) WHERE m.content CONTAINS 'this is a very long query that should be truncated' RETURN m";
		const contents = `const result = await falkor.query(\`${longQuery}\`);`;
		const errors = validateFileQueries(contents, "test.ts", testSchema);
		expect(errors[0].query.length).toBeLessThanOrEqual(53); // 50 + "..."
	});
});

describe("engramSchemaPlugin", () => {
	test("creates plugin with required options", () => {
		const plugin = engramSchemaPlugin({ schema: testSchema });
		expect(plugin.name).toBe("engram-schema");
		expect(typeof plugin.setup).toBe("function");
	});

	test("creates plugin with all options", () => {
		const plugin = engramSchemaPlugin({
			schema: testSchema,
			outputDir: "custom/output",
			validateQueries: false,
			queryFilePattern: /\.ts$/,
			verbose: false,
		});
		expect(plugin.name).toBe("engram-schema");
	});
});
