import { z } from "zod";
import { BaseNodeSchema } from "./base";

export const SessionNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["Session"]),
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
	labels: z.literal(["Thought"]),
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
	labels: z.literal(["Turn"]),

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
});
export type TurnNode = z.infer<typeof TurnNodeSchema>;

// =============================================================================
// ReasoningNode: A thinking/reasoning block within a turn
// Captures the agent's internal reasoning process
// =============================================================================
export const ReasoningNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["Reasoning"]),

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
// =============================================================================
export const FileTouchNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["FileTouch"]),

	file_path: z.string(), // Indexed path, e.g., "src/auth/login.ts"
	action: z.enum(["read", "edit", "create", "delete"]),

	// Optional diff summary for edits
	diff_preview: z.string().max(500).optional(), // Brief description of changes
	lines_added: z.number().int().optional(),
	lines_removed: z.number().int().optional(),
});
export type FileTouchNode = z.infer<typeof FileTouchNodeSchema>;

export const ToolCallNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["ToolCall"]),
	tool_name: z.string(),
	call_id: z.string(), // Provider ID (e.g. call_abc123)
	arguments_json: z.string(), // The full JSON args
	status: z.enum(["pending", "success", "error"]),
});
export type ToolCallNode = z.infer<typeof ToolCallNodeSchema>;

export const CodeArtifactNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["CodeArtifact"]),
	filename: z.string(),
	language: z.string(), // ts, py, etc.
	content_hash: z.string(),
	blob_ref: z.string(), // Content is almost always > 1KB
});
export type CodeArtifactNode = z.infer<typeof CodeArtifactNodeSchema>;

export const DiffHunkNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["DiffHunk"]),
	file_path: z.string(),
	original_line_start: z.number().int(),
	original_line_end: z.number().int(),
	patch_content: z.string(), // The unified diff or search/replace block
});
export type DiffHunkNode = z.infer<typeof DiffHunkNodeSchema>;

export const ObservationNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["Observation"]),
	tool_call_id: z.string(), // Links back to ToolCall
	content: z.string(), // Output
	is_error: z.boolean().default(false),
});
export type ObservationNode = z.infer<typeof ObservationNodeSchema>;

export const SnapshotNodeSchema = BaseNodeSchema.extend({
	labels: z.literal(["Snapshot"]),
	vfs_state_blob_ref: z.string().url(),
	state_hash: z.string(),
	snapshot_at: z.number(), // Epoch
});
export type SnapshotNode = z.infer<typeof SnapshotNodeSchema>;
