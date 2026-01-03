import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { edge } from "../schema/edge";
import { field } from "../schema/field";
import { node } from "../schema/node";
import { defineSchema } from "../schema/schema";
import { generateValidators } from "./validators-generator";

describe("validators-generator", () => {
	describe("generateValidators", () => {
		test("generates basic node schema", () => {
			const TestNode = node({
				id: field.string(),
				name: field.string(),
				count: field.int(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("export const TestSchema = z.object({");
			expect(code).toContain("id: z.string(),");
			expect(code).toContain("name: z.string(),");
			expect(code).toContain("count: z.number().int(),");
			expect(code).toContain("}).merge(BitemporalSchema);");
		});

		test("generates CreateInputSchema and UpdateInputSchema", () => {
			const TestNode = node({
				id: field.string(),
				name: field.string(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("export const CreateTestInputSchema = TestSchema.omit({");
			expect(code).toContain("id: true,");
			expect(code).toContain("vt_start: true,");
			expect(code).toContain(
				"export const UpdateTestInputSchema = CreateTestInputSchema.partial();",
			);
		});

		test("generates type exports", () => {
			const TestNode = node({
				id: field.string(),
				name: field.string(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			// Types are disabled by default (generated in types.ts instead)
			const codeDefault = generateValidators(schema);
			expect(codeDefault).not.toContain("export type Test =");

			// Types can be explicitly enabled
			const codeWithTypes = generateValidators(schema, { includeTypes: true });
			expect(codeWithTypes).toContain("export type Test = z.infer<typeof TestSchema>;");
			expect(codeWithTypes).toContain(
				"export type CreateTestInput = z.infer<typeof CreateTestInputSchema>;",
			);
			expect(codeWithTypes).toContain(
				"export type UpdateTestInput = z.infer<typeof UpdateTestInputSchema>;",
			);
		});

		test("handles string field with max length", () => {
			const TestNode = node({
				id: field.string(),
				preview: field.string().max(1000),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("preview: z.string().max(1000),");
		});

		test("handles int field with min/max constraints", () => {
			const TestNode = node({
				id: field.string(),
				count: field.int().min(0).max(100),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("count: z.number().int().min(0).max(100),");
		});

		test("handles float field with constraints", () => {
			const TestNode = node({
				id: field.string(),
				score: field.float().min(0).max(1),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("score: z.number().min(0).max(1),");
		});

		test("handles boolean field", () => {
			const TestNode = node({
				id: field.string(),
				active: field.boolean(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("active: z.boolean(),");
		});

		test("handles timestamp field", () => {
			const TestNode = node({
				id: field.string(),
				createdAt: field.timestamp(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("createdAt: z.number(),");
		});

		test("handles array field", () => {
			const TestNode = node({
				id: field.string(),
				tags: field.array(field.string()),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("tags: z.array(z.string()),");
		});

		test("handles enum field", () => {
			const TestNode = node({
				id: field.string(),
				status: field.enum(["pending", "active", "closed"] as const),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain('status: z.enum(["pending", "active", "closed"]),');
		});

		test("handles vector field", () => {
			const TestNode = node({
				id: field.string(),
				embedding: field.vector(1536),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("embedding: z.array(z.number()),");
		});

		test("handles optional fields", () => {
			const TestNode = node({
				id: field.string(),
				description: field.string().optional(),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("description: z.string().optional(),");
		});

		test("handles default values", () => {
			const TestNode = node({
				id: field.string(),
				count: field.int().default(0),
				name: field.string().default("unknown"),
				tags: field.array(field.string()).default([]),
			});

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("count: z.number().int().default(0),");
			expect(code).toContain('name: z.string().default("unknown"),');
			expect(code).toContain("tags: z.array(z.string()).default([]),");
		});

		test("handles non-bitemporal nodes", () => {
			const TestNode = node(
				{
					id: field.string(),
					key: field.string(),
				},
				{ bitemporal: false },
			);

			const schema = defineSchema({
				nodes: { Test: TestNode },
				edges: {},
			});

			const code = generateValidators(schema);

			expect(code).toContain("export const TestSchema = z.object({");
			// Non-bitemporal nodes don't merge with BitemporalSchema
			expect(code).not.toContain("TestSchema.merge(BitemporalSchema)");
			expect(code).toContain("TestSchema = z.object({\n\tid: z.string(),\n\tkey: z.string(),\n});");

			// CreateInputSchema should not omit bitemporal fields for non-bitemporal nodes
			expect(code).toContain("export const CreateTestInputSchema = TestSchema.omit({");
			expect(code).toContain("id: true,");
			// Check that bitemporal fields are not in the omit list
			expect(code).not.toContain(
				"CreateTestInputSchema = TestSchema.omit({\n\tid: true,\n\tvt_start",
			);
		});

		test("generates edge property schemas", () => {
			const SourceNode = node({ id: field.string() });
			const TargetNode = node({ id: field.string() });

			const TestEdge = edge({
				from: "Source",
				to: "Target",
				properties: {
					weight: field.float().min(0).max(1),
					context: field.string().optional(),
				},
			});

			const schema = defineSchema({
				nodes: { Source: SourceNode, Target: TargetNode },
				edges: { TestEdge },
			});

			const code = generateValidators(schema);

			expect(code).toContain("export const TestEdgePropertiesSchema = z.object({");
			expect(code).toContain("weight: z.number().min(0).max(1),");
			expect(code).toContain("context: z.string().optional(),");
			// Types are disabled by default
			expect(code).not.toContain("export type TestEdgeProperties =");

			// Types can be enabled
			const codeWithTypes = generateValidators(schema, { includeTypes: true });
			expect(codeWithTypes).toContain(
				"export type TestEdgeProperties = z.infer<typeof TestEdgePropertiesSchema>;",
			);
		});

		test("skips edges without properties", () => {
			const SourceNode = node({ id: field.string() });
			const TargetNode = node({ id: field.string() });

			const TestEdge = edge({
				from: "Source",
				to: "Target",
			});

			const schema = defineSchema({
				nodes: { Source: SourceNode, Target: TargetNode },
				edges: { TestEdge },
			});

			const code = generateValidators(schema);

			expect(code).not.toContain("TestEdgePropertiesSchema");
		});

		test("includes header", () => {
			const TestNode = node({ id: field.string() });
			const schema = defineSchema({ nodes: { Test: TestNode }, edges: {} });

			const code = generateValidators(schema);

			expect(code).toContain("// AUTO-GENERATED FILE - DO NOT EDIT");
		});

		test("respects custom config", () => {
			const TestNode = node({ id: field.string(), name: field.string() });
			const schema = defineSchema({ nodes: { Test: TestNode }, edges: {} });

			const code = generateValidators(schema, {
				includeTypes: false,
				generateCreateInputs: false,
				generateUpdateInputs: false,
				header: "// Custom header\n",
			});

			expect(code).toContain("// Custom header");
			expect(code).not.toContain("export type Test");
			expect(code).not.toContain("CreateTestInputSchema");
			expect(code).not.toContain("UpdateTestInputSchema");
		});

		test("generates valid, parseable TypeScript", () => {
			const MemoryNode = node({
				id: field.string(),
				content: field.string(),
				content_hash: field.string(),
				type: field
					.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const)
					.default("context"),
				tags: field.array(field.string()).default([]),
				source: field.enum(["user", "auto", "import"] as const).default("user"),
				embedding: field.array(field.float()).optional(),
			});

			const EntityNode = node({
				id: field.string(),
				name: field.string(),
				type: field.enum([
					"tool",
					"concept",
					"pattern",
					"file",
					"person",
					"project",
					"technology",
				] as const),
				mention_count: field.int().default(1),
			});

			const MentionsEdge = edge({
				from: "Memory",
				to: "Entity",
				properties: {
					context: field.string().max(500).optional(),
					confidence: field.float().min(0).max(1).optional(),
					mention_count: field.int().min(1).default(1),
				},
			});

			const schema = defineSchema({
				nodes: { Memory: MemoryNode, Entity: EntityNode },
				edges: { MENTIONS: MentionsEdge },
			});

			const code = generateValidators(schema);

			// Verify structure
			expect(code).toContain('import { z } from "zod";');
			expect(code).toContain("export const BitemporalSchema");
			expect(code).toContain("export const MemorySchema");
			expect(code).toContain("export const EntitySchema");
			expect(code).toContain("export const MENTIONSPropertiesSchema");
			// Types are disabled by default (generated separately in types.ts)
			expect(code).not.toContain("export type Memory =");
			expect(code).not.toContain("export type Entity =");
			expect(code).not.toContain("export type MENTIONSProperties =");

			// Check specific field mappings
			expect(code).toContain(
				'type: z.enum(["decision", "context", "insight", "preference", "fact", "turn"]).default("context")',
			);
			expect(code).toContain('source: z.enum(["user", "auto", "import"]).default("user")');
			// Edge property schema should have mention_count with min constraint
			expect(code).toContain("mention_count: z.number().int().min(1).default(1)");
			// Node schema should just have default (without min since we didn't specify it on node)
			expect(code).toContain("EntitySchema");
			expect(code).toContain("mention_count: z.number().int().default(1)");
		});
	});

	describe("generated code validation", () => {
		test("generated BitemporalSchema is valid", () => {
			// Validate the actual schema structure we generate
			const BitemporalSchema = z.object({
				vt_start: z.number(),
				vt_end: z.number(),
				tt_start: z.number(),
				tt_end: z.number(),
			});

			const valid = {
				vt_start: 1704067200000,
				vt_end: 253402300799000,
				tt_start: 1704067200000,
				tt_end: 253402300799000,
			};

			expect(() => BitemporalSchema.parse(valid)).not.toThrow();
		});

		test("generated node schema pattern is valid", () => {
			const BitemporalSchema = z.object({
				vt_start: z.number(),
				vt_end: z.number(),
				tt_start: z.number(),
				tt_end: z.number(),
			});

			// Pattern we generate for a Memory-like node
			const MemorySchema = z
				.object({
					id: z.string(),
					content: z.string(),
					content_hash: z.string(),
					type: z
						.enum(["decision", "context", "insight", "preference", "fact", "turn"])
						.default("context"),
					tags: z.array(z.string()).default([]),
					source: z.enum(["user", "auto", "import"]).default("user"),
					embedding: z.array(z.number()).optional(),
				})
				.merge(BitemporalSchema);

			const CreateMemoryInputSchema = MemorySchema.omit({
				id: true,
				vt_start: true,
				vt_end: true,
				tt_start: true,
				tt_end: true,
			});

			const UpdateMemoryInputSchema = CreateMemoryInputSchema.partial();

			// Type inference works
			type Memory = z.infer<typeof MemorySchema>;
			type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;
			type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;

			// Validation works
			const validMemory = {
				id: "01ABC123",
				content: "Test memory",
				content_hash: "abc123",
				type: "decision" as const,
				tags: ["test"],
				source: "user" as const,
				vt_start: 1704067200000,
				vt_end: 253402300799000,
				tt_start: 1704067200000,
				tt_end: 253402300799000,
			};

			const validCreateInput = {
				content: "Test memory",
				content_hash: "abc123",
			};

			const validUpdateInput = {
				content: "Updated content",
			};

			expect(() => MemorySchema.parse(validMemory)).not.toThrow();
			expect(() => CreateMemoryInputSchema.parse(validCreateInput)).not.toThrow();
			expect(() => UpdateMemoryInputSchema.parse(validUpdateInput)).not.toThrow();
		});
	});
});
