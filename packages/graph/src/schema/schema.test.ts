/**
 * Tests for schema composition and validation.
 */

import { describe, expect, test } from "bun:test";
import { edge } from "./edge";
import { field } from "./field";
import { node } from "./node";
import {
	defineSchema,
	type InferEdgeTypes,
	type InferNodeTypes,
	SchemaValidationError,
} from "./schema";

describe("defineSchema()", () => {
	test("creates valid schema with nodes and edges", () => {
		const MemoryNode = node({
			content: field.string(),
			type: field.enum(["decision", "context"] as const),
		});

		const SessionNode = node({
			id: field.string(),
			agent_type: field.string(),
		});

		const HasMemory = edge({
			from: "Session",
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
				Session: SessionNode,
			},
			edges: {
				HAS_MEMORY: HasMemory,
			},
		});

		expect(schema.isValid()).toBe(true);
		expect(schema.validationErrors).toHaveLength(0);
		expect(schema.getNodeLabels()).toEqual(["Memory", "Session"]);
		expect(schema.getEdgeTypes()).toEqual(["HAS_MEMORY"]);
	});

	test("validates edge references exist in nodes", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const InvalidEdge = edge({
			from: "Session", // Does not exist
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
			},
			edges: {
				INVALID: InvalidEdge,
			},
		});

		expect(schema.isValid()).toBe(false);
		expect(schema.validationErrors.length).toBeGreaterThan(0);
		expect(schema.validationErrors[0]).toContain("unknown source node 'Session'");
	});

	test("validates both from and to references", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const InvalidEdge = edge({
			from: "Session", // Does not exist
			to: "Entity", // Does not exist
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
			},
			edges: {
				INVALID: InvalidEdge,
			},
		});

		expect(schema.isValid()).toBe(false);
		expect(schema.validationErrors.length).toBe(2);
		expect(schema.validationErrors.some((err) => err.includes("Session"))).toBe(true);
		expect(schema.validationErrors.some((err) => err.includes("Entity"))).toBe(true);
	});

	test("accepts self-referential edges", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const Replaces = edge({
			from: "Memory",
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
			},
			edges: {
				REPLACES: Replaces,
			},
		});

		expect(schema.isValid()).toBe(true);
		expect(schema.validationErrors).toHaveLength(0);
	});

	test("validates node names are valid identifiers", () => {
		const TestNode = node({
			value: field.string(),
		});

		const schema = defineSchema({
			nodes: {
				"Invalid-Name": TestNode, // Hyphen not allowed
			},
			edges: {},
		});

		expect(schema.isValid()).toBe(false);
		expect(schema.validationErrors.some((err) => err.includes("Invalid-Name"))).toBe(true);
		expect(schema.validationErrors.some((err) => err.includes("valid identifier"))).toBe(true);
	});

	test("validates edge names are valid identifiers", () => {
		const TestNode = node({
			value: field.string(),
		});

		const TestEdge = edge({
			from: "Test",
			to: "Test",
		});

		const schema = defineSchema({
			nodes: {
				Test: TestNode,
			},
			edges: {
				"INVALID-EDGE": TestEdge, // Hyphen not allowed
			},
		});

		expect(schema.isValid()).toBe(false);
		expect(schema.validationErrors.some((err) => err.includes("INVALID-EDGE"))).toBe(true);
		expect(schema.validationErrors.some((err) => err.includes("valid identifier"))).toBe(true);
	});

	test("accepts underscores and numbers in names", () => {
		const TestNode = node({
			value: field.string(),
		});

		const TestEdge = edge({
			from: "Test_Node_2",
			to: "Test_Node_2",
		});

		const schema = defineSchema({
			nodes: {
				Test_Node_2: TestNode,
			},
			edges: {
				HAS_EDGE_123: TestEdge,
			},
		});

		expect(schema.isValid()).toBe(true);
	});

	test("warns about duplicate names (case-insensitive)", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const TestEdge = edge({
			from: "Memory",
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
			},
			edges: {
				memory: TestEdge, // Same name, different case
			},
		});

		expect(schema.validationErrors.some((err) => err.includes("same name as a node"))).toBe(true);
	});

	test("throws in strict mode when validation fails", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const InvalidEdge = edge({
			from: "Session", // Does not exist
			to: "Memory",
		});

		expect(() => {
			defineSchema(
				{
					nodes: {
						Memory: MemoryNode,
					},
					edges: {
						INVALID: InvalidEdge,
					},
				},
				{ strict: true },
			);
		}).toThrow(SchemaValidationError);
	});

	test("does not throw in non-strict mode when validation fails", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const InvalidEdge = edge({
			from: "Session", // Does not exist
			to: "Memory",
		});

		expect(() => {
			defineSchema({
				nodes: {
					Memory: MemoryNode,
				},
				edges: {
					INVALID: InvalidEdge,
				},
			});
		}).not.toThrow();
	});
});

describe("Schema runtime access", () => {
	const MemoryNode = node({
		content: field.string(),
		type: field.enum(["decision", "context"] as const),
	});

	const SessionNode = node({
		id: field.string(),
	});

	const TurnNode = node({
		content: field.string(),
	});

	const HasTurn = edge({
		from: "Session",
		to: "Turn",
		cardinality: "one-to-many",
	});

	const HasMemory = edge({
		from: "Session",
		to: "Memory",
	});

	const Replaces = edge({
		from: "Memory",
		to: "Memory",
		cardinality: "one-to-one",
	});

	const schema = defineSchema({
		nodes: {
			Memory: MemoryNode,
			Session: SessionNode,
			Turn: TurnNode,
		},
		edges: {
			HAS_TURN: HasTurn,
			HAS_MEMORY: HasMemory,
			REPLACES: Replaces,
		},
	});

	test("getNode() returns correct node definition", () => {
		const memory = schema.getNode("Memory");
		expect(memory).toBeDefined();
		expect(memory?.fields.content).toBeDefined();
		expect(memory?.fields.type).toBeDefined();
	});

	test("getNode() returns undefined for non-existent node", () => {
		const unknown = schema.getNode("Unknown" as any);
		expect(unknown).toBeUndefined();
	});

	test("getEdge() returns correct edge definition", () => {
		const hasTurn = schema.getEdge("HAS_TURN");
		expect(hasTurn).toBeDefined();
		expect(hasTurn?.getFrom()).toBe("Session");
		expect(hasTurn?.getTo()).toBe("Turn");
		expect(hasTurn?.getCardinality()).toBe("one-to-many");
	});

	test("getEdge() returns undefined for non-existent edge", () => {
		const unknown = schema.getEdge("UNKNOWN" as any);
		expect(unknown).toBeUndefined();
	});

	test("getEdgesFrom() returns edges originating from node", () => {
		const fromSession = schema.getEdgesFrom("Session");
		expect(fromSession).toHaveLength(2);
		expect(fromSession.map((e) => e.type)).toContain("HAS_TURN");
		expect(fromSession.map((e) => e.type)).toContain("HAS_MEMORY");
	});

	test("getEdgesFrom() returns empty array for node with no outgoing edges", () => {
		const fromTurn = schema.getEdgesFrom("Turn");
		expect(fromTurn).toHaveLength(0);
	});

	test("getEdgesTo() returns edges targeting node", () => {
		const toMemory = schema.getEdgesTo("Memory");
		expect(toMemory).toHaveLength(2);
		expect(toMemory.map((e) => e.type)).toContain("HAS_MEMORY");
		expect(toMemory.map((e) => e.type)).toContain("REPLACES");
	});

	test("getEdgesTo() returns empty array for node with no incoming edges", () => {
		const toSession = schema.getEdgesTo("Session");
		expect(toSession).toHaveLength(0);
	});

	test("getEdgesFor() returns all edges connected to node", () => {
		const forSession = schema.getEdgesFor("Session");
		expect(forSession).toHaveLength(2);
		expect(forSession.map((e) => e.type)).toContain("HAS_TURN");
		expect(forSession.map((e) => e.type)).toContain("HAS_MEMORY");
	});

	test("getEdgesFor() includes self-referential edges", () => {
		const forMemory = schema.getEdgesFor("Memory");
		expect(forMemory).toHaveLength(2);
		expect(forMemory.map((e) => e.type)).toContain("HAS_MEMORY");
		expect(forMemory.map((e) => e.type)).toContain("REPLACES");
	});

	test("getNodeLabels() returns all node labels", () => {
		const labels = schema.getNodeLabels();
		expect(labels).toHaveLength(3);
		expect(labels).toContain("Memory");
		expect(labels).toContain("Session");
		expect(labels).toContain("Turn");
	});

	test("getEdgeTypes() returns all edge types", () => {
		const types = schema.getEdgeTypes();
		expect(types).toHaveLength(3);
		expect(types).toContain("HAS_TURN");
		expect(types).toContain("HAS_MEMORY");
		expect(types).toContain("REPLACES");
	});
});

describe("Type inference", () => {
	test("InferNodeTypes extracts node type names", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const SessionNode = node({
			id: field.string(),
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
				Session: SessionNode,
			},
			edges: {},
		});

		type NodeTypes = InferNodeTypes<typeof schema>;

		// Type-level test (compile-time check)
		const assertNodeType: NodeTypes = "Memory";
		const assertNodeType2: NodeTypes = "Session";

		expect(assertNodeType).toBe("Memory");
		expect(assertNodeType2).toBe("Session");
	});

	test("InferEdgeTypes extracts edge type names", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const SessionNode = node({
			id: field.string(),
		});

		const HasMemory = edge({
			from: "Session",
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
				Session: SessionNode,
			},
			edges: {
				HAS_MEMORY: HasMemory,
			},
		});

		type EdgeTypes = InferEdgeTypes<typeof schema>;

		// Type-level test (compile-time check)
		const assertEdgeType: EdgeTypes = "HAS_MEMORY";

		expect(assertEdgeType).toBe("HAS_MEMORY");
	});

	test("Schema type is fully inferred", () => {
		const MemoryNode = node({
			content: field.string(),
		});

		const SessionNode = node({
			id: field.string(),
		});

		const HasMemory = edge({
			from: "Session",
			to: "Memory",
		});

		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
				Session: SessionNode,
			},
			edges: {
				HAS_MEMORY: HasMemory,
			},
		});

		// Type-level assertions
		type Schema = typeof schema;
		type Nodes = Schema["nodes"];
		type Edges = Schema["edges"];

		expect(schema.nodes.Memory).toBeDefined();
		expect(schema.nodes.Session).toBeDefined();
		expect(schema.edges.HAS_MEMORY).toBeDefined();
	});
});

describe("Complex schema example", () => {
	test("Engram schema structure", () => {
		// Define nodes
		const MemoryNode = node({
			content: field.string(),
			content_hash: field.string(),
			type: field.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const),
			tags: field.array(field.string()),
			project: field.string().optional(),
			embedding: field.vector(1024).optional(),
		});

		const SessionNode = node({
			id: field.string(),
			agent_type: field.string(),
			working_dir: field.string(),
			summary: field.string().optional(),
		});

		const TurnNode = node({
			id: field.string(),
			user_content: field.string().optional(),
			assistant_preview: field.string().optional(),
			files_touched: field.array(field.string()),
		});

		const EntityNode = node({
			name: field.string(),
			type: field.string(),
		});

		// Define edges
		const HasTurn = edge({
			from: "Session",
			to: "Turn",
			cardinality: "one-to-many",
		});

		const HasMemory = edge({
			from: "Session",
			to: "Memory",
			cardinality: "one-to-many",
		});

		const Mentions = edge({
			from: "Memory",
			to: "Entity",
			cardinality: "many-to-many",
			properties: {
				context: field.string().optional(),
				confidence: field.float().min(0).max(1),
			},
		});

		const Replaces = edge({
			from: "Memory",
			to: "Memory",
			cardinality: "one-to-one",
			description: "New version replaces old version",
		});

		// Create schema
		const schema = defineSchema({
			nodes: {
				Memory: MemoryNode,
				Session: SessionNode,
				Turn: TurnNode,
				Entity: EntityNode,
			},
			edges: {
				HAS_TURN: HasTurn,
				HAS_MEMORY: HasMemory,
				MENTIONS: Mentions,
				REPLACES: Replaces,
			},
		});

		// Validate schema
		expect(schema.isValid()).toBe(true);
		expect(schema.validationErrors).toHaveLength(0);

		// Check structure
		expect(schema.getNodeLabels()).toHaveLength(4);
		expect(schema.getEdgeTypes()).toHaveLength(4);

		// Check relationships
		const sessionEdges = schema.getEdgesFrom("Session");
		expect(sessionEdges).toHaveLength(2);
		expect(sessionEdges.map((e) => e.type)).toContain("HAS_TURN");
		expect(sessionEdges.map((e) => e.type)).toContain("HAS_MEMORY");

		const memoryEdges = schema.getEdgesFor("Memory");
		expect(memoryEdges).toHaveLength(3);
		expect(memoryEdges.map((e) => e.type)).toContain("HAS_MEMORY");
		expect(memoryEdges.map((e) => e.type)).toContain("MENTIONS");
		expect(memoryEdges.map((e) => e.type)).toContain("REPLACES");

		// Check edge properties
		const mentions = schema.getEdge("MENTIONS");
		expect(mentions?.hasProperties()).toBe(true);
		expect(mentions?.getDescription()).toBeUndefined();

		const replaces = schema.getEdge("REPLACES");
		expect(replaces?.getDescription()).toBe("New version replaces old version");
	});
});
