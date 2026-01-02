import { describe, expect, it } from "bun:test";
import { edge } from "../schema/edge";
import { field } from "../schema/field";
import { node } from "../schema/node";
import { defineSchema } from "../schema/schema";
import { generateTypes, generateTypesWithMeta } from "./types-generator";

describe("types-generator", () => {
	describe("generateTypes", () => {
		it("generates basic node interface", () => {
			const TestNode = node({
				id: field.string(),
				name: field.string(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("export interface Test extends BitemporalFields {");
			expect(code).toContain("id: string;");
			expect(code).toContain("name: string;");
			expect(code).toContain("}");
		});

		it("handles optional fields", () => {
			const TestNode = node({
				id: field.string(),
				nickname: field.string().optional(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("id: string;");
			expect(code).toContain("nickname?: string;");
		});

		it("handles all field types", () => {
			const TestNode = node({
				strField: field.string(),
				intField: field.int(),
				floatField: field.float(),
				boolField: field.boolean(),
				timestampField: field.timestamp(),
				vectorField: field.vector(1536),
				arrayField: field.array(field.string()),
				enumField: field.enum(["a", "b", "c"] as const),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("strField: string;");
			expect(code).toContain("intField: number;");
			expect(code).toContain("floatField: number;");
			expect(code).toContain("boolField: boolean;");
			expect(code).toContain("timestampField: number;");
			expect(code).toContain("vectorField: number[];");
			expect(code).toContain("arrayField: string[];");
			expect(code).toContain('enumField: "a" | "b" | "c";');
		});

		it("handles nested array types", () => {
			const TestNode = node({
				nestedArray: field.array(field.int()),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("nestedArray: number[];");
		});

		it("generates Create and Update input types", () => {
			const TestNode = node({
				id: field.string(),
				name: field.string(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema, { generateInputTypes: true });

			expect(code).toContain("export type CreateTestInput = Omit<Test, keyof BitemporalFields>;");
			expect(code).toContain(
				"export type UpdateTestInput = Partial<Omit<Test, keyof BitemporalFields>>;",
			);
		});

		it("handles non-bitemporal nodes", () => {
			const TestNode = node(
				{
					key: field.string(),
					value: field.string(),
				},
				{ bitemporal: false },
			);

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("export interface Test {");
			expect(code).not.toContain("export interface Test extends BitemporalFields");
			expect(code).toContain("export type CreateTestInput = Test;");
			expect(code).toContain("export type UpdateTestInput = Partial<Test>;");
		});

		it("generates edge types without properties", () => {
			const FromNode = node({ id: field.string() });
			const ToNode = node({ id: field.string() });
			const HasTo = edge({ from: "From", to: "To" });

			const schema = defineSchema({
				nodes: { From: FromNode, To: ToNode },
				edges: { HAS_TO: HasTo },
			});

			const code = generateTypes(schema);

			expect(code).toContain("export type HAS_TOEdge = BitemporalFields;");
		});

		it("generates edge types with properties", () => {
			const FromNode = node({ id: field.string() });
			const ToNode = node({ id: field.string() });
			const HasTo = edge({
				from: "From",
				to: "To",
				properties: {
					weight: field.float(),
					label: field.string().optional(),
				},
			});

			const schema = defineSchema({
				nodes: { From: FromNode, To: ToNode },
				edges: { HAS_TO: HasTo },
			});

			const code = generateTypes(schema);

			expect(code).toContain("export interface HAS_TOProperties extends BitemporalFields {");
			expect(code).toContain("weight: number;");
			expect(code).toContain("label?: string;");
			expect(code).toContain("export type HAS_TOEdge = HAS_TOProperties;");
		});

		it("generates non-temporal edge types", () => {
			const FromNode = node({ id: field.string() });
			const ToNode = node({ id: field.string() });
			const HasTo = edge({
				from: "From",
				to: "To",
				temporal: false,
			});

			const schema = defineSchema({
				nodes: { From: FromNode, To: ToNode },
				edges: { HAS_TO: HasTo },
			});

			const code = generateTypes(schema);

			expect(code).toContain("export type HAS_TOEdge = Record<string, never>;");
		});

		it("generates union types", () => {
			const NodeA = node({ id: field.string() });
			const NodeB = node({ id: field.string() });
			const EdgeAB = edge({ from: "A", to: "B" });

			const schema = defineSchema({
				nodes: { A: NodeA, B: NodeB },
				edges: { A_TO_B: EdgeAB },
			});

			const code = generateTypes(schema);

			expect(code).toContain('export type NodeLabel = "A" | "B";');
			expect(code).toContain('export type EdgeType = "A_TO_B";');
			expect(code).toContain("export type AnyNode = A | B;");
		});

		it("generates enum type aliases", () => {
			const TestNode = node({
				status: field.enum(["active", "inactive", "pending"] as const),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain('export type TestStatus = "active" | "inactive" | "pending";');
		});

		it("includes auto-generated header by default", () => {
			const TestNode = node({ id: field.string() });

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema);

			expect(code).toContain("// AUTO-GENERATED - DO NOT EDIT");
			expect(code).toContain("// Generated from schema at");
		});

		it("allows custom header", () => {
			const TestNode = node({ id: field.string() });

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema, {
				includeHeader: "// Custom header\n// Generated by test",
			});

			expect(code).toContain("// Custom header");
			expect(code).not.toContain("// AUTO-GENERATED");
		});

		it("can disable header", () => {
			const TestNode = node({ id: field.string() });

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema, { includeHeader: false });

			expect(code).not.toContain("// AUTO-GENERATED");
			expect(code).not.toContain("// Generated from schema");
		});

		it("can disable comments", () => {
			const TestNode = node({ id: field.string() });

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema, {
				includeComments: false,
				includeHeader: false,
			});

			expect(code).not.toContain("/**");
			expect(code).not.toContain("*/");
			expect(code).not.toContain("// Node Types");
		});

		it("can disable input type generation", () => {
			const TestNode = node({ id: field.string() });

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateTypes(schema, { generateInputTypes: false });

			expect(code).not.toContain("CreateTestInput");
			expect(code).not.toContain("UpdateTestInput");
		});
	});

	describe("generateTypesWithMeta", () => {
		it("returns code and metadata", () => {
			const NodeA = node({
				id: field.string(),
				type: field.enum(["x", "y"] as const),
			});
			const NodeB = node({ id: field.string() });
			const EdgeAB = edge({ from: "A", to: "B" });

			const schema = defineSchema({
				nodes: { A: NodeA, B: NodeB },
				edges: { A_TO_B: EdgeAB },
			});

			const result = generateTypesWithMeta(schema);

			expect(result.code).toContain("export interface A");
			expect(result.code).toContain("export interface B");
			expect(result.nodeCount).toBe(2);
			expect(result.edgeCount).toBe(1);
			expect(result.enumCount).toBe(1);
		});
	});

	describe("complex schema", () => {
		it("generates types for a realistic schema", () => {
			const MemoryNode = node({
				id: field.string(),
				content: field.string(),
				type: field.enum(["decision", "context", "insight"] as const),
				tags: field.array(field.string()),
				embedding: field.vector(1024).optional(),
			});

			const SessionNode = node({
				id: field.string(),
				started_at: field.timestamp(),
				agent_type: field.enum(["claude-code", "codex"] as const).default("claude-code"),
			});

			const HasMemory = edge({
				from: "Session",
				to: "Memory",
				cardinality: "one-to-many",
				properties: {
					relevance_score: field.float().min(0).max(1).optional(),
				},
			});

			const schema = defineSchema({
				nodes: { Memory: MemoryNode, Session: SessionNode },
				edges: { HAS_MEMORY: HasMemory },
			});

			const result = generateTypesWithMeta(schema);

			// Verify node types
			expect(result.code).toContain("export interface Memory extends BitemporalFields");
			expect(result.code).toContain("content: string;");
			expect(result.code).toContain('type: "decision" | "context" | "insight";');
			expect(result.code).toContain("tags: string[];");
			expect(result.code).toContain("embedding?: number[];");

			expect(result.code).toContain("export interface Session extends BitemporalFields");
			expect(result.code).toContain("started_at: number;");

			// Verify edge types
			expect(result.code).toContain("export interface HAS_MEMORYProperties");
			expect(result.code).toContain("relevance_score?: number;");

			// Verify input types
			expect(result.code).toContain("export type CreateMemoryInput");
			expect(result.code).toContain("export type UpdateMemoryInput");

			// Verify union types
			expect(result.code).toContain('export type NodeLabel = "Memory" | "Session";');
			expect(result.code).toContain('export type EdgeType = "HAS_MEMORY";');

			// Verify counts
			expect(result.nodeCount).toBe(2);
			expect(result.edgeCount).toBe(1);
			expect(result.enumCount).toBe(2); // Memory.type and Session.agent_type
		});
	});
});
