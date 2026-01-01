/**
 * Example node definitions demonstrating the Schema DSL.
 *
 * These examples show how to use the node() function with various field types
 * and configuration options.
 */

import { field, node } from "./index";

// =============================================================================
// Memory Node - Core memory storage node
// =============================================================================

export const MemoryNode = node({
	content: field.string(),
	content_hash: field.string(),
	type: field.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const),
	tags: field.array(field.string()),
	project: field.string().optional(),
	embedding: field.vector(1024).optional(),
});

// Type inference examples
export type Memory = typeof MemoryNode.$inferSelect;
export type InsertMemory = typeof MemoryNode.$inferInsert;

// =============================================================================
// Session Node - User session tracking
// =============================================================================

export const SessionNode = node({
	id: field.string(),
	agent_type: field.string(),
	working_dir: field.string(),
	summary: field.string().optional(),
	start_time: field.timestamp(),
	end_time: field.timestamp().optional(),
});

export type Session = typeof SessionNode.$inferSelect;
export type InsertSession = typeof SessionNode.$inferInsert;

// =============================================================================
// Turn Node - Individual conversation turn
// =============================================================================

export const TurnNode = node({
	id: field.string(),
	user_content: field.string(),
	assistant_preview: field.string(),
	tool_calls_count: field.int().default(0),
	files_touched: field.array(field.string()).default([]),
	timestamp: field.timestamp(),
});

export type Turn = typeof TurnNode.$inferSelect;
export type InsertTurn = typeof TurnNode.$inferInsert;

// =============================================================================
// FileTouch Node - File access tracking
// =============================================================================

export const FileTouchNode = node({
	file_path: field.string(),
	action: field.enum(["read", "write", "create", "delete"] as const),
	timestamp: field.timestamp(),
	line_count: field.int().optional(),
});

export type FileTouch = typeof FileTouchNode.$inferSelect;
export type InsertFileTouch = typeof FileTouchNode.$inferInsert;

// =============================================================================
// Config Node - Non-bitemporal configuration node
// =============================================================================

export const ConfigNode = node(
	{
		key: field.string(),
		value: field.string(),
		description: field.string().optional(),
	},
	{ bitemporal: false, label: "Config" },
);

export type Config = typeof ConfigNode.$inferSelect;
export type InsertConfig = typeof ConfigNode.$inferInsert;

// =============================================================================
// Example Usage
// =============================================================================

// Example: Creating a typed memory object
const exampleMemory: Memory = {
	content: "Always use TypeScript for type safety in large codebases",
	content_hash: "sha256:abc123...",
	type: "decision",
	tags: ["typescript", "best-practice", "architecture"],
	project: "engram",
	embedding: new Array(1024).fill(0.1),
	vt_start: Date.now(),
	vt_end: Number.POSITIVE_INFINITY,
	tt_start: Date.now(),
	tt_end: Number.POSITIVE_INFINITY,
};

// Example: Creating a session object
const exampleSession: Session = {
	id: "session-12345",
	agent_type: "claude-code",
	working_dir: "/Users/user/projects/engram",
	summary: "Implemented node definition DSL with full type inference",
	start_time: Date.now() - 3600000,
	end_time: Date.now(),
	vt_start: Date.now(),
	vt_end: Number.POSITIVE_INFINITY,
	tt_start: Date.now(),
	tt_end: Number.POSITIVE_INFINITY,
};

// Example: Config node without bitemporal fields
const exampleConfig: Config = {
	key: "max_embedding_dimensions",
	value: "1024",
	description: "Maximum dimensionality for vector embeddings",
	// Note: No bitemporal fields required
};

// Prevent unused variable warnings
export const _examples = { exampleMemory, exampleSession, exampleConfig };
