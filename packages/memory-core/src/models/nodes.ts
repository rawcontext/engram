import { z } from "zod";
import { BaseNodeSchema } from "./base";

export const SessionNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(["Session"]),
  title: z.string().optional(),
  user_id: z.string(),
  started_at: z.number(), // Epoch
});
export type SessionNode = z.infer<typeof SessionNodeSchema>;

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
