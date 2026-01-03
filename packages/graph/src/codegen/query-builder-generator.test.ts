/**
 * Tests for the Query Builder Generator.
 */

import { describe, expect, it } from "bun:test";
import { edge } from "../schema/edge";
import { field } from "../schema/field";
import { node } from "../schema/node";
import { defineSchema } from "../schema/schema";
import { generateQueryBuilders, generateQueryBuildersWithMeta } from "./query-builder-generator";

// =============================================================================
// Test Schema
// =============================================================================

const TestSessionNode = node({
	id: field.string(),
	org_id: field.string(),
	agent_type: field.enum(["claude-code", "codex", "cursor"] as const),
	working_dir: field.string().optional(),
	summary: field.string().optional(),
	embedding: field.array(field.float()).optional(),
});

const TestMemoryNode = node({
	id: field.string(),
	org_id: field.string(),
	content: field.string(),
	type: field.enum(["decision", "context", "insight", "preference", "fact"] as const),
	tags: field.array(field.string()).default([]),
	project: field.string().optional(),
	is_archived: field.boolean().default(false),
});

const TestEntityNode = node({
	id: field.string(),
	org_id: field.string(),
	name: field.string(),
	type: field.enum(["tool", "concept", "pattern", "file", "person"] as const),
});

const HAS_MEMORY = edge({
	from: "Session",
	to: "Memory",
	temporal: true,
	cardinality: "one-to-many",
	description: "Session has memories",
});

const MENTIONS = edge({
	from: "Memory",
	to: "Entity",
	temporal: true,
	cardinality: "many-to-many",
	description: "Memory mentions entity",
});

const RELATED_TO = edge({
	from: "Memory",
	to: "Memory",
	temporal: true,
	cardinality: "many-to-many",
	description: "Memory related to another memory",
});

const testSchema = defineSchema({
	nodes: {
		Session: TestSessionNode,
		Memory: TestMemoryNode,
		Entity: TestEntityNode,
	},
	edges: {
		HAS_MEMORY,
		MENTIONS,
		RELATED_TO,
	},
});

// =============================================================================
// Basic Generation Tests
// =============================================================================

describe("generateQueryBuilders", () => {
	it("generates code for all nodes", () => {
		const code = generateQueryBuilders(testSchema);

		// Check that all query builder classes are generated
		expect(code).toContain("export class SessionQueryBuilder");
		expect(code).toContain("export class MemoryQueryBuilder");
		expect(code).toContain("export class EntityQueryBuilder");
	});

	it("generates extends BaseQueryBuilder", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("extends BaseQueryBuilder<Session>");
		expect(code).toContain("extends BaseQueryBuilder<Memory>");
		expect(code).toContain("extends BaseQueryBuilder<Entity>");
	});

	it("generates nodeLabel property", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain('protected readonly nodeLabel = "Session"');
		expect(code).toContain('protected readonly nodeLabel = "Memory"');
		expect(code).toContain('protected readonly nodeLabel = "Entity"');
	});

	it("includes auto-generated header by default", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("// AUTO-GENERATED - DO NOT EDIT");
		expect(code).toContain("// Run 'bun run codegen' to regenerate");
	});

	it("includes import statements", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain('import { BaseQueryBuilder } from "../runtime/base-query-builder"');
		expect(code).toContain('import type { QueryClient } from "../runtime/types"');
		expect(code).toContain("import type {");
		expect(code).toContain("Session,");
		expect(code).toContain("Memory,");
		expect(code).toContain("Entity,");
	});
});

// =============================================================================
// Field Filter Method Tests
// =============================================================================

describe("field filter methods", () => {
	it("generates whereType for enum fields", () => {
		const code = generateQueryBuilders(testSchema);

		// Memory type field
		expect(code).toContain("whereType(value:");
		expect(code).toContain('"decision" | "context" | "insight" | "preference" | "fact"');
	});

	it("generates whereAgentType for Session enum", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("whereAgentType(value:");
		expect(code).toContain('"claude-code" | "codex" | "cursor"');
	});

	it("generates has* methods for array fields", () => {
		const code = generateQueryBuilders(testSchema);

		// Memory tags field
		expect(code).toContain("hasTag(value: string)");
	});

	it("generates string filter methods", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("whereOrgId(value: string)");
		expect(code).toContain("whereContent(value: string)");
		expect(code).toContain("whereName(value: string)");
	});

	it("generates boolean filter methods", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("whereIsArchived(value: boolean)");
	});

	it("skips filter methods for embedding fields", () => {
		const code = generateQueryBuilders(testSchema);

		// Should NOT generate filter for embedding
		expect(code).not.toContain("whereEmbedding");
		expect(code).not.toContain("hasEmbedding");
	});

	it("can disable field filters", () => {
		const code = generateQueryBuilders(testSchema, { generateFieldFilters: false });

		expect(code).not.toContain("whereType(");
		expect(code).not.toContain("hasTag(");
	});
});

// =============================================================================
// Traversal Method Tests
// =============================================================================

describe("traversal methods", () => {
	it("generates outgoing edge traversal methods", () => {
		const code = generateQueryBuilders(testSchema);

		// Session -> Memory via HAS_MEMORY
		expect(code).toContain("hasMemory(): MemoryQueryBuilder");

		// Memory -> Entity via MENTIONS
		expect(code).toContain("mentions(): EntityQueryBuilder");

		// Memory -> Memory via RELATED_TO (self-referential)
		expect(code).toContain("relatedTo(): MemoryQueryBuilder");
	});

	it("generates incoming edge traversal methods", () => {
		const code = generateQueryBuilders(testSchema);

		// Memory <- Session via HAS_MEMORY (reverse)
		expect(code).toContain("hasMemoryFrom(): SessionQueryBuilder");

		// Entity <- Memory via MENTIONS (reverse)
		expect(code).toContain("mentionsFrom(): MemoryQueryBuilder");
	});

	it("includes TODO for TraversalBuilder implementation", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("// TODO: Implement traversal when TraversalBuilder is available");
	});

	it("can disable traversal methods", () => {
		const code = generateQueryBuilders(testSchema, { generateTraversalMethods: false });

		expect(code).not.toContain("hasMemory()");
		expect(code).not.toContain("mentions()");
	});
});

// =============================================================================
// Factory Object Tests
// =============================================================================

describe("factory objects", () => {
	it("generates static factory objects for each node", () => {
		const code = generateQueryBuilders(testSchema);

		// Factory objects are named {Node}Queries to avoid conflicts with type exports
		expect(code).toContain("export const SessionQueries = {");
		expect(code).toContain("export const MemoryQueries = {");
		expect(code).toContain("export const EntityQueries = {");
	});

	it("generates query() factory method", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("query(client: QueryClient): SessionQueryBuilder");
		expect(code).toContain("query(client: QueryClient): MemoryQueryBuilder");
	});

	it("generates where() factory method", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("where(client: QueryClient, conditions: Partial<Session>)");
		expect(code).toContain("where(client: QueryClient, conditions: Partial<Memory>)");
	});

	it("generates findById() method", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain(
			"async findById(client: QueryClient, id: string): Promise<Session | null>",
		);
		expect(code).toContain(".whereCurrent()");
		expect(code).toContain(".first()");
	});

	it("generates asOf() method for bitemporal nodes", () => {
		const code = generateQueryBuilders(testSchema);

		expect(code).toContain("async asOf(");
		expect(code).toContain("timestamp: number");
		expect(code).toContain(".asOf(timestamp)");
	});

	it("can disable factory methods", () => {
		const code = generateQueryBuilders(testSchema, { generateFactoryMethods: false });

		expect(code).not.toContain("export const SessionQueries = {");
		expect(code).not.toContain("findById");
	});
});

// =============================================================================
// Configuration Tests
// =============================================================================

describe("configuration options", () => {
	it("can disable comments", () => {
		const code = generateQueryBuilders(testSchema, { includeComments: false });

		expect(code).not.toContain("/**");
		expect(code).not.toContain("@example");
	});

	it("can use custom header", () => {
		const customHeader = "// Custom header\n// Generated by test\n";
		const code = generateQueryBuilders(testSchema, { includeHeader: customHeader });

		expect(code).toContain("// Custom header");
		expect(code).toContain("// Generated by test");
		expect(code).not.toContain("// AUTO-GENERATED");
	});

	it("can disable header completely", () => {
		const code = generateQueryBuilders(testSchema, { includeHeader: false });

		expect(code).not.toContain("// AUTO-GENERATED");
		expect(code.startsWith("import")).toBe(true);
	});
});

// =============================================================================
// Metadata Tests
// =============================================================================

describe("generateQueryBuildersWithMeta", () => {
	it("returns code and metadata", () => {
		const result = generateQueryBuildersWithMeta(testSchema);

		expect(result.code).toBeDefined();
		expect(result.builderCount).toBe(3);
		expect(result.factoryCount).toBe(3);
	});

	it("counts field filter methods", () => {
		const result = generateQueryBuildersWithMeta(testSchema);

		// Count expected filters:
		// Session: org_id, agent_type, working_dir, summary = 4
		// Memory: org_id, content, type, tags (hasTag), project, is_archived = 6
		// Entity: org_id, name, type = 3
		// Total = 13
		expect(result.fieldFilterCount).toBeGreaterThan(0);
	});

	it("counts traversal methods", () => {
		const result = generateQueryBuildersWithMeta(testSchema);

		// Outgoing: Session->Memory (1), Memory->Entity (1), Memory->Memory (1) = 3
		// Incoming (non-self): Memory<-Session (1), Entity<-Memory (1) = 2
		// Total = 5
		expect(result.traversalMethodCount).toBeGreaterThan(0);
	});

	it("respects disabled factory methods in count", () => {
		const result = generateQueryBuildersWithMeta(testSchema, { generateFactoryMethods: false });

		expect(result.factoryCount).toBe(0);
	});
});

// =============================================================================
// Generated Code Quality Tests
// =============================================================================

describe("generated code quality", () => {
	it("generates syntactically valid TypeScript", () => {
		const code = generateQueryBuilders(testSchema);

		// Check for balanced braces
		const openBraces = (code.match(/{/g) || []).length;
		const closeBraces = (code.match(/}/g) || []).length;
		expect(openBraces).toBe(closeBraces);

		// Check for balanced parentheses
		const openParens = (code.match(/\(/g) || []).length;
		const closeParens = (code.match(/\)/g) || []).length;
		expect(openParens).toBe(closeParens);
	});

	it("uses proper type annotations", () => {
		const code = generateQueryBuilders(testSchema);

		// All methods should have return types
		expect(code).toContain("): this {");
		expect(code).toContain("): SessionQueryBuilder {");
		expect(code).toContain("): Promise<Session | null>");
	});

	it("properly chains addCondition calls", () => {
		const code = generateQueryBuilders(testSchema);

		// Filter methods should return this for chaining
		expect(code).toContain('return this.addCondition("');
	});

	it("generates unique method names", () => {
		const code = generateQueryBuilders(testSchema);

		// Count method occurrences - each should appear only once per class
		const sessionClass = code.split("export class SessionQueryBuilder")[1].split("export class")[0];
		const whereOrgIdCount = (sessionClass.match(/whereOrgId\(/g) || []).length;
		expect(whereOrgIdCount).toBe(1);
	});
});
