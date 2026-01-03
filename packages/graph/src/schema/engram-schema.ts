/**
 * Complete Engram graph schema definition using the Schema DSL.
 *
 * This schema defines all node types and edge relationships for the Engram
 * bitemporal knowledge graph. It replaces the legacy Zod schemas with a
 * type-safe, validated graph structure.
 *
 * @example Basic usage
 * ```typescript
 * import { engramSchema } from '@engram/graph/schema';
 *
 * // Get all node labels
 * const nodes = engramSchema.getNodeLabels();
 * // => ['Session', 'Turn', 'Reasoning', ...]
 *
 * // Get all edge types
 * const edges = engramSchema.getEdgeTypes();
 * // => ['HAS_TURN', 'NEXT', 'CONTAINS', ...]
 *
 * // Validate schema
 * console.log(engramSchema.isValid()); // => true
 * ```
 *
 * @example Type inference
 * ```typescript
 * import type { Session, Turn, Memory } from '@engram/graph/schema';
 *
 * // All types include bitemporal fields automatically
 * const session: Session = {
 *   id: 'session-123',
 *   org_id: 'org-456',
 *   user_id: 'user-789',
 *   started_at: Date.now(),
 *   agent_type: 'claude-code',
 *   vt_start: Date.now(),
 *   vt_end: Number.POSITIVE_INFINITY,
 *   tt_start: Date.now(),
 *   tt_end: Number.POSITIVE_INFINITY,
 * };
 * ```
 *
 * @example Runtime introspection
 * ```typescript
 * import { engramSchema } from '@engram/graph/schema';
 *
 * // Get edges from a specific node
 * const turnEdges = engramSchema.getEdgesFrom('Turn');
 * // => [{ type: 'NEXT', ... }, { type: 'CONTAINS', ... }, { type: 'INVOKES', ... }]
 *
 * // Get edges to a specific node
 * const toolCallEdges = engramSchema.getEdgesTo('ToolCall');
 * // => [{ type: 'INVOKES', ... }, { type: 'TRIGGERS', ... }]
 * ```
 *
 * @see packages/graph/src/models/nodes.ts - Original Zod node schemas
 * @see packages/graph/src/models/edges.ts - Original edge type definitions
 */

import { defineSchema, edge, field, node } from "./index";

// =============================================================================
// Node Definitions
// =============================================================================

/**
 * Session: A complete conversation session between user and agent.
 * Root node for the conversation hierarchy.
 */
export const SessionNode = node({
	id: field.string(),
	org_id: field.string(),
	title: field.string().optional(),
	user_id: field.string(),
	started_at: field.timestamp(),

	// Project context for per-repo memory filtering
	working_dir: field.string().optional(),
	git_remote: field.string().optional(),
	agent_type: field
		.enum(["claude-code", "codex", "gemini-cli", "opencode", "aider", "cursor", "unknown"] as const)
		.default("unknown"),

	// Session summary for semantic search
	summary: field.string().optional(),
	embedding: field.array(field.float()).optional(),
});

/**
 * Turn: A single conversation turn (user prompt + assistant response).
 * The atomic unit for agent memory retrieval.
 */
export const TurnNode = node({
	id: field.string(),
	org_id: field.string(),

	// User prompt
	user_content: field.string(),
	user_content_hash: field.string(),

	// Assistant response
	assistant_preview: field.string().max(2000),
	assistant_blob_ref: field.string().optional(),

	// Semantic retrieval
	embedding: field.array(field.float()).optional(),

	// Metadata
	sequence_index: field.int(),
	files_touched: field.array(field.string()).default([]),
	tool_calls_count: field.int().default(0),

	// Token usage (aggregated for the turn)
	input_tokens: field.int().optional(),
	output_tokens: field.int().optional(),
	cache_read_tokens: field.int().optional(),
	cache_write_tokens: field.int().optional(),
	reasoning_tokens: field.int().optional(),

	// Cost and timing
	cost_usd: field.float().optional(),
	duration_ms: field.int().optional(),

	// Git context
	git_commit: field.string().optional(),
});

/**
 * Reasoning: A thinking/reasoning block within a turn.
 * Captures the agent's internal reasoning process.
 */
export const ReasoningNode = node({
	id: field.string(),
	org_id: field.string(),

	content_hash: field.string(),
	preview: field.string().max(1000),
	blob_ref: field.string().optional(),

	// Classification of reasoning type
	reasoning_type: field
		.enum(["chain_of_thought", "reflection", "planning", "analysis", "unknown"] as const)
		.default("unknown"),

	// Position within the turn
	sequence_index: field.int(),

	// Optional semantic embedding for deep reasoning search
	embedding: field.array(field.float()).optional(),
});

/**
 * ToolCall: Captures every tool invocation.
 * Creates causal lineage: Reasoning -[TRIGGERS]-> ToolCall -[TOUCHES]-> FileTouch
 */
export const ToolCallNode = node({
	id: field.string(),
	org_id: field.string(),

	// Identity
	call_id: field.string(),

	// Tool info
	tool_name: field.string(),
	tool_type: field
		.enum([
			"file_read",
			"file_write",
			"file_edit",
			"file_multi_edit",
			"file_glob",
			"file_grep",
			"file_list",
			"bash_exec",
			"notebook_read",
			"notebook_edit",
			"web_fetch",
			"web_search",
			"agent_spawn",
			"todo_read",
			"todo_write",
			"mcp",
			"unknown",
		] as const)
		.default("unknown"),

	// Arguments
	arguments_json: field.string(),
	arguments_preview: field.string().max(500).optional(),

	// Execution state
	status: field.enum(["pending", "success", "error", "cancelled"] as const),
	error_message: field.string().optional(),

	// Sequence tracking
	sequence_index: field.int(),
	reasoning_sequence: field.int().optional(),
});

/**
 * Observation: Tool execution results.
 * Links back to ToolCall via tool_call_id.
 */
export const ObservationNode = node({
	id: field.string(),
	org_id: field.string(),

	// Identity
	tool_call_id: field.string(),

	// Result content
	content: field.string(),
	content_preview: field.string().max(1000).optional(),
	content_hash: field.string().optional(),

	// Status
	is_error: field.boolean().default(false),
	error_type: field.string().optional(),

	// Metadata
	execution_time_ms: field.int().optional(),
});

/**
 * FileTouch: A file operation within a turn.
 * Enables "what happened to this file?" queries.
 */
export const FileTouchNode = node({
	id: field.string(),
	org_id: field.string(),

	file_path: field.string(),
	action: field.enum(["read", "edit", "create", "delete", "list", "search"] as const),

	// Link to parent ToolCall for lineage tracing
	tool_call_id: field.string().optional(),

	// Position tracking within turn
	sequence_index: field.int().optional(),

	// Optional diff summary for edits
	diff_preview: field.string().max(500).optional(),
	lines_added: field.int().optional(),
	lines_removed: field.int().optional(),

	// Search results (for grep/glob operations)
	match_count: field.int().optional(),
	matched_files: field.array(field.string()).optional(),
});

/**
 * CodeArtifact: A code file or snippet tracked in the graph.
 */
export const CodeArtifactNode = node({
	id: field.string(),
	org_id: field.string(),

	filename: field.string(),
	language: field.string(),
	content_hash: field.string(),
	blob_ref: field.string(),
});

/**
 * DiffHunk: A code change/patch.
 */
export const DiffHunkNode = node({
	id: field.string(),
	org_id: field.string(),

	file_path: field.string(),
	original_line_start: field.int(),
	original_line_end: field.int(),
	patch_content: field.string(),
});

/**
 * Snapshot: A point-in-time VFS state.
 */
export const SnapshotNode = node({
	id: field.string(),
	org_id: field.string(),

	vfs_state_blob_ref: field.string(),
	state_hash: field.string(),
	snapshot_at: field.timestamp(),
});

/**
 * Memory: Explicit user-defined memories for long-term storage.
 * Created via engram_remember tool or auto-extracted from sessions.
 */
export const MemoryNode = node({
	id: field.string(),
	org_id: field.string(),

	// Content
	content: field.string(),
	content_hash: field.string(),

	// Classification
	type: field
		.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const)
		.default("context"),
	tags: field.array(field.string()).default([]),

	// Source tracking
	source_session_id: field.string().optional(),
	source_turn_id: field.string().optional(),
	source: field.enum(["user", "auto", "import"] as const).default("user"),

	// Project context (for scoping)
	project: field.string().optional(),
	working_dir: field.string().optional(),

	// Semantic retrieval
	embedding: field.array(field.float()).optional(),

	// Decay metadata (for memory prioritization)
	last_accessed: field.timestamp().optional(),
	access_count: field.int().default(0),
	decay_score: field.float().default(1.0),
	decay_updated_at: field.timestamp().optional(),
	pinned: field.boolean().default(false),
});

/**
 * Entity: Named entities extracted from conversations.
 * Enables entity-based retrieval and knowledge graph construction.
 */
export const EntityNode = node({
	id: field.string(),
	org_id: field.string(),

	// Identity
	name: field.string(),
	aliases: field.array(field.string()).default([]),

	// Classification
	type: field.enum([
		"tool",
		"concept",
		"pattern",
		"file",
		"person",
		"project",
		"technology",
	] as const),

	// Content
	description: field.string().optional(),

	// Statistics
	mention_count: field.int().default(1),

	// Project context (for scoping)
	project: field.string().optional(),

	// Semantic retrieval
	embedding: field.array(field.float()).optional(),
});

/**
 * DEPRECATED: Thought node - use TurnNode + ReasoningNode instead.
 * Kept for backward compatibility during migration.
 */
export const ThoughtNode = node({
	id: field.string(),
	org_id: field.string(),

	content_hash: field.string(),
	role: field.enum(["user", "assistant", "system"] as const),
	is_thinking: field.boolean().default(false),

	preview: field.string().max(1000).optional(),
	blob_ref: field.string().optional(),
});

// =============================================================================
// Edge Definitions
// =============================================================================

/**
 * Session -[HAS_TURN]-> Turn
 * One session contains many turns.
 */
export const HAS_TURN = edge({
	from: "Session",
	to: "Turn",
	temporal: true,
	cardinality: "one-to-many",
	description: "Session contains turns",
});

/**
 * Turn -[NEXT]-> Turn
 * Sequential ordering within session.
 */
export const NEXT = edge({
	from: "Turn",
	to: "Turn",
	temporal: true,
	cardinality: "one-to-one",
	description: "Next turn in sequence",
});

/**
 * Turn -[CONTAINS]-> Reasoning
 * Turn contains thinking/reasoning blocks.
 */
export const CONTAINS = edge({
	from: "Turn",
	to: "Reasoning",
	temporal: true,
	cardinality: "one-to-many",
	description: "Turn contains reasoning blocks",
});

/**
 * Turn -[INVOKES]-> ToolCall
 * Turn invokes tool calls.
 */
export const INVOKES = edge({
	from: "Turn",
	to: "ToolCall",
	temporal: true,
	cardinality: "one-to-many",
	description: "Turn invokes tool calls",
});

/**
 * Reasoning -[TRIGGERS]-> ToolCall
 * Reasoning block that triggered a tool invocation (causal link).
 */
export const TRIGGERS = edge({
	from: "Reasoning",
	to: "ToolCall",
	temporal: true,
	cardinality: "one-to-many",
	description: "Reasoning triggers tool call",
});

/**
 * ToolCall -[TOUCHES]-> FileTouch
 * Tool call touches files (captures file operations).
 */
export const TOUCHES = edge({
	from: "ToolCall",
	to: "FileTouch",
	temporal: true,
	cardinality: "one-to-many",
	description: "Tool call touches files",
});

/**
 * ToolCall -[YIELDS]-> Observation
 * Tool call yields an observation result.
 */
export const YIELDS = edge({
	from: "ToolCall",
	to: "Observation",
	temporal: true,
	cardinality: "one-to-one",
	description: "Tool call yields observation",
});

/**
 * DiffHunk -[MODIFIES]-> CodeArtifact
 * Diff modifies code artifact.
 */
export const MODIFIES = edge({
	from: "DiffHunk",
	to: "CodeArtifact",
	temporal: true,
	cardinality: "many-to-one",
	description: "Diff modifies code artifact",
});

/**
 * Snapshot -[SNAPSHOT_OF]-> (VFS state)
 * Snapshot captures VFS state.
 */
export const SNAPSHOT_OF = edge({
	from: "Snapshot",
	to: "Session",
	temporal: true,
	cardinality: "many-to-one",
	description: "Snapshot of session VFS state",
});

/**
 * Node -[REPLACES]-> Node
 * New version replaces old (bitemporal versioning).
 */
export const REPLACES = edge({
	from: "Memory",
	to: "Memory",
	temporal: true,
	cardinality: "one-to-one",
	description: "New version replaces old",
});

/**
 * Node -[SAME_AS]-> Node
 * Deduplication link.
 */
export const SAME_AS = edge({
	from: "Memory",
	to: "Memory",
	temporal: true,
	cardinality: "many-to-many",
	description: "Content deduplication",
});

/**
 * Session -[SELF_INVOKES]-> ToolCall
 * MCP server self-instrumentation (tool calls without intermediate Turn).
 */
export const SELF_INVOKES = edge({
	from: "Session",
	to: "ToolCall",
	temporal: true,
	cardinality: "one-to-many",
	description: "MCP self-instrumentation",
});

/**
 * Memory -[MENTIONS]-> Entity
 * Memory mentions entity.
 */
export const MENTIONS = edge({
	from: "Memory",
	to: "Entity",
	temporal: true,
	cardinality: "many-to-many",
	properties: {
		context: field.string().max(500).optional(),
		confidence: field.float().min(0).max(1).optional(),
		mention_count: field.int().min(1).default(1),
	},
	description: "Memory mentions entity",
});

/**
 * Memory -[RELATED_TO]-> Memory
 * Semantic relationship between memories.
 */
export const RELATED_TO = edge({
	from: "Memory",
	to: "Memory",
	temporal: true,
	cardinality: "many-to-many",
	properties: {
		similarity_score: field.float().min(0).max(1).optional(),
		relationship_type: field.string().optional(),
	},
	description: "Semantic relationship between memories",
});

// =============================================================================
// Complete Schema Composition
// =============================================================================

/**
 * Complete Engram graph schema.
 * Combines all node and edge definitions with validation.
 */
export const engramSchema = defineSchema({
	nodes: {
		Session: SessionNode,
		Turn: TurnNode,
		Reasoning: ReasoningNode,
		ToolCall: ToolCallNode,
		Observation: ObservationNode,
		FileTouch: FileTouchNode,
		CodeArtifact: CodeArtifactNode,
		DiffHunk: DiffHunkNode,
		Snapshot: SnapshotNode,
		Memory: MemoryNode,
		Entity: EntityNode,
		Thought: ThoughtNode, // DEPRECATED
	},
	edges: {
		HAS_TURN,
		NEXT,
		CONTAINS,
		INVOKES,
		TRIGGERS,
		TOUCHES,
		YIELDS,
		MODIFIES,
		SNAPSHOT_OF,
		REPLACES,
		SAME_AS,
		SELF_INVOKES,
		MENTIONS,
		RELATED_TO,
	},
});

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Type inference from node definitions.
 * These types include bitemporal fields (vt_start, vt_end, tt_start, tt_end).
 */
export type Session = typeof SessionNode.$inferSelect;
export type Turn = typeof TurnNode.$inferSelect;
export type Reasoning = typeof ReasoningNode.$inferSelect;
export type ToolCall = typeof ToolCallNode.$inferSelect;
export type Observation = typeof ObservationNode.$inferSelect;
export type FileTouch = typeof FileTouchNode.$inferSelect;
export type CodeArtifact = typeof CodeArtifactNode.$inferSelect;
export type DiffHunk = typeof DiffHunkNode.$inferSelect;
export type Snapshot = typeof SnapshotNode.$inferSelect;
export type Memory = typeof MemoryNode.$inferSelect;
export type Entity = typeof EntityNode.$inferSelect;
export type Thought = typeof ThoughtNode.$inferSelect;

/**
 * Union of all node types.
 */
export type NodeLabels = keyof typeof engramSchema.nodes;

/**
 * Union of all edge types.
 */
export type EdgeTypes = keyof typeof engramSchema.edges;

/**
 * Runtime schema validation.
 * Logs validation errors if schema is invalid.
 */
if (!engramSchema.isValid()) {
	console.error("⚠️  Engram schema validation failed:");
	for (const error of engramSchema.validationErrors) {
		console.error(`  - ${error}`);
	}
}
