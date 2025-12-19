import { z } from "zod";
import { BaseNodeSchema } from "./base";

// =============================================================================
// ToolCallType Enum - Categorizes all tool call types
// =============================================================================
export const ToolCallType = {
	// File operations
	FILE_READ: "file_read",
	FILE_WRITE: "file_write",
	FILE_EDIT: "file_edit",
	FILE_MULTI_EDIT: "file_multi_edit",
	FILE_GLOB: "file_glob",
	FILE_GREP: "file_grep",
	FILE_LIST: "file_list",

	// Execution
	BASH_EXEC: "bash_exec",
	NOTEBOOK_READ: "notebook_read",
	NOTEBOOK_EDIT: "notebook_edit",

	// Web
	WEB_FETCH: "web_fetch",
	WEB_SEARCH: "web_search",

	// Agent
	AGENT_SPAWN: "agent_spawn",
	TODO_READ: "todo_read",
	TODO_WRITE: "todo_write",

	// MCP (Model Context Protocol)
	MCP: "mcp",

	// Fallback
	UNKNOWN: "unknown",
} as const;

export type ToolCallTypeValue = (typeof ToolCallType)[keyof typeof ToolCallType];

export const ToolCallTypeEnum = z.enum([
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
]);

export const SessionNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Session")]),
	title: z.string().optional(),
	user_id: z.string(),
	started_at: z.number(), // Epoch

	// Project context for per-repo memory filtering
	working_dir: z.string().optional(), // e.g., /Users/ccheney/Projects/the-system
	git_remote: z.string().optional(), // e.g., github.com/user/the-system
	agent_type: z
		.enum(["claude-code", "codex", "gemini-cli", "opencode", "aider", "cursor", "unknown"])
		.default("unknown"),

	// Session summary for semantic search
	summary: z.string().optional(), // LLM-generated session summary
	embedding: z.array(z.number()).optional(), // Vector for retrieval
});
export type SessionNode = z.infer<typeof SessionNodeSchema>;

// =============================================================================
// DEPRECATED: ThoughtNode - use TurnNode + ReasoningNode instead
// Kept for backward compatibility during migration
// =============================================================================
export const ThoughtNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Thought")]),
	content_hash: z.string(), // SHA256 of content for dedupe
	role: z.enum(["user", "assistant", "system"]),
	is_thinking: z.boolean().default(false), // True if <thinking> block

	// Note: Actual large text content is stored in BlobStore,
	// but short thoughts might be stored directly.
	// We include a 'summary' or 'preview' here.
	preview: z.string().max(1000).optional(),
	blob_ref: z.string().optional(), // URI to GCS if content > 1KB
});
export type ThoughtNode = z.infer<typeof ThoughtNodeSchema>;

// =============================================================================
// TurnNode: A single conversation turn (user prompt + assistant response)
// This is the atomic unit for agent memory retrieval
// =============================================================================
export const TurnNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Turn")]),

	// User prompt
	user_content: z.string(), // The user's prompt/message
	user_content_hash: z.string(), // SHA256 for deduplication

	// Assistant response
	assistant_preview: z.string().max(2000), // First 2000 chars of response
	assistant_blob_ref: z.string().optional(), // Full response if > 2KB

	// Semantic retrieval
	embedding: z.array(z.number()).optional(), // Vector embedding for similarity search

	// Metadata
	sequence_index: z.number().int(), // Order within session (0, 1, 2, ...)
	files_touched: z.array(z.string()).default([]), // Denormalized file paths for quick filtering
	tool_calls_count: z.number().int().default(0), // Number of tool calls in this turn

	// Token usage (aggregated for the turn)
	input_tokens: z.number().int().optional(),
	output_tokens: z.number().int().optional(),
	cache_read_tokens: z.number().int().optional(),
	cache_write_tokens: z.number().int().optional(),
	reasoning_tokens: z.number().int().optional(),

	// Cost and timing
	cost_usd: z.number().optional(), // Total cost for this turn in USD
	duration_ms: z.number().int().optional(), // Total duration in milliseconds

	// Git context (for OpenCode and others that track git state)
	git_commit: z.string().optional(), // Git commit hash at end of turn
});
export type TurnNode = z.infer<typeof TurnNodeSchema>;

// =============================================================================
// ReasoningNode: A thinking/reasoning block within a turn
// Captures the agent's internal reasoning process
// =============================================================================
export const ReasoningNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Reasoning")]),

	content_hash: z.string(), // SHA256 for deduplication
	preview: z.string().max(1000), // First 1000 chars
	blob_ref: z.string().optional(), // Full content if > 1KB

	// Classification of reasoning type
	reasoning_type: z
		.enum(["chain_of_thought", "reflection", "planning", "analysis", "unknown"])
		.default("unknown"),

	// Position within the turn
	sequence_index: z.number().int(), // Order within turn (0, 1, 2, ...)

	// Optional semantic embedding for deep reasoning search
	embedding: z.array(z.number()).optional(),
});
export type ReasoningNode = z.infer<typeof ReasoningNodeSchema>;

// =============================================================================
// FileTouchNode: A file operation within a turn
// Enables "what happened to this file?" queries
// Now linked through ToolCall for full lineage: Reasoning -> ToolCall -> FileTouch
// =============================================================================
export const FileTouchNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("FileTouch")]),

	file_path: z.string(), // Indexed path, e.g., "src/auth/login.ts"
	action: z.enum(["read", "edit", "create", "delete", "list", "search"]),

	// Link to parent ToolCall for lineage tracing
	tool_call_id: z.string().optional(), // UUID of the ToolCall that created this

	// Position tracking within turn
	sequence_index: z.number().int().optional(), // Order within turn's tool calls

	// Optional diff summary for edits
	diff_preview: z.string().max(500).optional(), // Brief description of changes
	lines_added: z.number().int().optional(),
	lines_removed: z.number().int().optional(),

	// Search results (for grep/glob operations)
	match_count: z.number().int().optional(),
	matched_files: z.array(z.string()).optional(), // For glob results
});
export type FileTouchNode = z.infer<typeof FileTouchNodeSchema>;

// =============================================================================
// ToolCallNode: Captures every tool invocation
// Creates causal lineage: Reasoning -[TRIGGERS]-> ToolCall -[TOUCHES]-> FileTouch
// =============================================================================
export const ToolCallNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("ToolCall")]),

	// Identity
	call_id: z.string(), // Provider ID (e.g. "toolu_01ABC...")

	// Tool info
	tool_name: z.string(), // Original tool name (e.g., "Read", "Bash", "mcp__chrome__click")
	tool_type: ToolCallTypeEnum.default("unknown"), // Categorized type

	// Arguments
	arguments_json: z.string(), // Full JSON arguments
	arguments_preview: z.string().max(500).optional(), // Truncated for display

	// Execution state
	status: z.enum(["pending", "success", "error", "cancelled"]),
	error_message: z.string().optional(),

	// Sequence tracking
	sequence_index: z.number().int(), // Position within Turn's content blocks
	reasoning_sequence: z.number().int().optional(), // Index of triggering Reasoning block
});
export type ToolCallNode = z.infer<typeof ToolCallNodeSchema>;

export const CodeArtifactNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("CodeArtifact")]),
	filename: z.string(),
	language: z.string(), // ts, py, etc.
	content_hash: z.string(),
	blob_ref: z.string(), // Content is almost always > 1KB
});
export type CodeArtifactNode = z.infer<typeof CodeArtifactNodeSchema>;

export const DiffHunkNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("DiffHunk")]),
	file_path: z.string(),
	original_line_start: z.number().int(),
	original_line_end: z.number().int(),
	patch_content: z.string(), // The unified diff or search/replace block
});
export type DiffHunkNode = z.infer<typeof DiffHunkNodeSchema>;

// =============================================================================
// ObservationNode: Tool execution results
// Links back to ToolCall via tool_call_id
// =============================================================================
export const ObservationNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Observation")]),

	// Identity
	tool_call_id: z.string(), // Reference to parent ToolCall

	// Result content
	content: z.string(), // Full result content
	content_preview: z.string().max(1000).optional(), // Truncated for display
	content_hash: z.string().optional(), // SHA256 for deduplication

	// Status
	is_error: z.boolean().default(false),
	error_type: z.string().optional(), // e.g., "FileNotFound", "PermissionDenied"

	// Metadata
	execution_time_ms: z.number().int().optional(),
});
export type ObservationNode = z.infer<typeof ObservationNodeSchema>;

export const SnapshotNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Snapshot")]),
	vfs_state_blob_ref: z.string().url(),
	state_hash: z.string(),
	snapshot_at: z.number(), // Epoch
});
export type SnapshotNode = z.infer<typeof SnapshotNodeSchema>;

// =============================================================================
// MemoryNode: Explicit user-defined memories for long-term storage
// Created via engram_remember tool or auto-extracted from sessions
// =============================================================================
export const MemoryTypeEnum = z.enum([
	"decision", // Architectural or design decisions
	"context", // Background context about the project
	"insight", // Learned patterns or observations
	"preference", // User preferences (coding style, tools, etc.)
	"fact", // Factual information to remember
	"turn", // Auto-generated from conversation turns
]);
export type MemoryType = z.infer<typeof MemoryTypeEnum>;

export const MemoryNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("Memory")]),

	// Content
	content: z.string(), // The memory content
	content_hash: z.string(), // SHA256 for deduplication

	// Classification
	type: MemoryTypeEnum.default("context"),
	tags: z.array(z.string()).default([]), // User-defined tags

	// Source tracking
	source_session_id: z.string().optional(), // Session where memory was created
	source_turn_id: z.string().optional(), // Turn where memory was created
	source: z.enum(["user", "auto", "import"]).default("user"), // How it was created

	// Project context (for scoping)
	project: z.string().optional(), // Project/repo identifier
	working_dir: z.string().optional(), // Working directory when created

	// Semantic retrieval
	embedding: z.array(z.number()).optional(), // Vector for similarity search
});
export type MemoryNode = z.infer<typeof MemoryNodeSchema>;
