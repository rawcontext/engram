/**
 * Example usage of the Schema DSL for both field primitives and edge definitions.
 * This file demonstrates the API design and type inference.
 */

import { edge } from "./edge";
import { field } from "./field";

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
