/**
 * Example usage of the Schema DSL for nodes, edges, and complete schema composition.
 * This file demonstrates the API design and type inference.
 */

import { defineSchema, edge, field, node } from "./index";

// =============================================================================
// Example 1: User Schema
// =============================================================================

export const userSchema = {
	id: field.string(),
	name: field.string().max(100),
	age: field.int().min(0).max(150).optional(),
	email: field.string().default("user@example.com"),
	isActive: field.boolean().default(true),
	createdAt: field.timestamp(),
	tags: field.array(field.string()).default([]),
	role: field.enum(["admin", "user", "guest"] as const).default("user"),
	profileEmbedding: field.vector(1536).optional(),
};

// =============================================================================
// Example 2: Session Schema (matching existing graph nodes)
// =============================================================================

export const sessionSchema = {
	id: field.string(),
	title: field.string().optional(),
	userId: field.string(),
	startedAt: field.timestamp(),
	workingDir: field.string().optional(),
	gitRemote: field.string().optional(),
	agentType: field
		.enum(["claude-code", "codex", "gemini-cli", "opencode", "aider", "cursor", "unknown"] as const)
		.default("unknown"),
	summary: field.string().optional(),
	embedding: field.array(field.float()).optional(),
};

// =============================================================================
// Example 3: Memory Schema
// =============================================================================

export const memorySchema = {
	id: field.string(),
	content: field.string(),
	contentHash: field.string(),
	type: field
		.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const)
		.default("context"),
	tags: field.array(field.string()).default([]),
	sourceSessionId: field.string().optional(),
	sourceTurnId: field.string().optional(),
	source: field.enum(["user", "auto", "import"] as const).default("user"),
	project: field.string().optional(),
	workingDir: field.string().optional(),
	embedding: field.vector(1536).optional(),
};

// =============================================================================
// Example 4: Complex nested schema
// =============================================================================

export const complexSchema = {
	metadata: field.array(
		// This would be better with a nested object type, but demonstrates array nesting
		field.string(),
	),
	nestedVectors: field.array(field.vector(384)),
	config: field.enum(["development", "staging", "production"] as const).default("development"),
	scores: field.array(field.float()),
};

// =============================================================================
// Type Inference Examples
// =============================================================================

// The field types support full TypeScript type inference.
// When used in a schema, the types are automatically inferred:
//
// userSchema.role -> Field<"admin" | "user" | "guest">
// userSchema.tags -> Field<string[]>
// memorySchema.type -> Field<"decision" | "context" | "insight" | "preference" | "fact" | "turn">

// Demonstrate that the API works at runtime
const examples = {
	userRole: userSchema.role.config.defaultValue,
	userTags: userSchema.tags.config.defaultValue,
	memoryType: memorySchema.type.config.defaultValue,
};

console.log("Schema field examples:", examples);

// =============================================================================
// Example 5: Edge Definitions
// =============================================================================

// Simple edge without properties
export const HasTurn = edge({
	from: "Session",
	to: "Turn",
	cardinality: "one-to-many",
	temporal: true,
});

// Edge with properties
export const Mentions = edge({
	from: "Memory",
	to: "Entity",
	temporal: true,
	cardinality: "many-to-many",
	properties: {
		context: field.string().max(500).optional(),
		confidence: field.float().min(0).max(1),
		mentionCount: field.int().min(1).default(1),
	},
	description: "Links a memory to entities mentioned within it",
});

// Self-referential edge
export const Replaces = edge({
	from: "Memory",
	to: "Memory",
	temporal: true,
	cardinality: "one-to-one",
	description: "New version replaces old version",
});

// Causal relationship edge
export const Triggers = edge({
	from: "Reasoning",
	to: "ToolCall",
	temporal: true,
	cardinality: "one-to-many",
	properties: {
		causalStrength: field.float().min(0).max(1).optional(),
	},
	description: "Reasoning block that triggered a tool invocation",
});

// Demonstrate edge API at runtime
const edgeExamples = {
	hasTurnFrom: HasTurn.getFrom(),
	hasTurnTo: HasTurn.getTo(),
	hasTurnCardinality: HasTurn.getCardinality(),
	mentionsHasProps: Mentions.hasProperties(),
	mentionsConfidence: Mentions.getProperties().confidence.config.max,
	replacesIsTemporal: Replaces.isTemporal(),
};

console.log("Schema edge examples:", edgeExamples);

// =============================================================================
// Example 6: Complete Schema Composition
// =============================================================================

// Define nodes
export const MemoryNode = node({
	content: field.string(),
	content_hash: field.string(),
	type: field.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const),
	tags: field.array(field.string()),
	project: field.string().optional(),
	embedding: field.vector(1024).optional(),
});

export const SessionNode = node({
	id: field.string(),
	agent_type: field.string(),
	working_dir: field.string(),
	summary: field.string().optional(),
});

export const TurnNode = node({
	id: field.string(),
	user_content: field.string().optional(),
	assistant_preview: field.string().optional(),
});

export const EntityNode = node({
	name: field.string(),
	type: field.string(),
});

// Define edges
export const HasTurnEdge = edge({
	from: "Session",
	to: "Turn",
	cardinality: "one-to-many",
});

export const HasMemoryEdge = edge({
	from: "Session",
	to: "Memory",
	cardinality: "one-to-many",
});

export const MentionsEdge = edge({
	from: "Memory",
	to: "Entity",
	cardinality: "many-to-many",
	properties: {
		confidence: field.float().min(0).max(1),
	},
});

export const ReplacesEdge = edge({
	from: "Memory",
	to: "Memory",
	cardinality: "one-to-one",
});

// Compose complete schema
export const engramSchema = defineSchema({
	nodes: {
		Memory: MemoryNode,
		Session: SessionNode,
		Turn: TurnNode,
		Entity: EntityNode,
	},
	edges: {
		HAS_TURN: HasTurnEdge,
		HAS_MEMORY: HasMemoryEdge,
		MENTIONS: MentionsEdge,
		REPLACES: ReplacesEdge,
	},
});

// Type inference examples
export type Memory = typeof MemoryNode.$inferSelect;
export type Session = typeof SessionNode.$inferSelect;
export type NodeLabels = keyof typeof engramSchema.nodes;
export type EdgeTypes = keyof typeof engramSchema.edges;

// Runtime schema introspection
const schemaInfo = {
	isValid: engramSchema.isValid(),
	nodeLabels: engramSchema.getNodeLabels(),
	edgeTypes: engramSchema.getEdgeTypes(),
	sessionEdges: engramSchema.getEdgesFrom("Session").map((e) => e.type),
	memoryEdges: engramSchema.getEdgesFor("Memory").map((e) => e.type),
};

console.log("Complete schema info:", schemaInfo);
