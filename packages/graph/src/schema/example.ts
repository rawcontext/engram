/**
 * Example usage of the Schema DSL field primitives.
 * This file demonstrates the API design and type inference.
 */

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
