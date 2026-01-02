import { z } from "zod";

// =============================================================================
// Session Repository Types
// =============================================================================

export const CreateSessionInputSchema = z.object({
	externalId: z.string().optional(),
	title: z.string().optional(),
	userId: z.string(),
	provider: z.string().optional(),
	workingDir: z.string().optional(),
	gitRemote: z.string().optional(),
	agentType: z
		.enum(["claude-code", "codex", "gemini-cli", "opencode", "aider", "cursor", "unknown"])
		.default("unknown"),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

export const UpdateSessionInputSchema = z.object({
	title: z.string().optional(),
	summary: z.string().optional(),
	embedding: z.array(z.number()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateSessionInput = z.infer<typeof UpdateSessionInputSchema>;

/**
 * Session entity returned from repository.
 * Maps FalkorDB node properties to a clean domain object.
 */
export interface Session {
	id: string;
	externalId?: string;
	title?: string;
	userId: string;
	provider?: string;
	startedAt: Date;
	workingDir?: string;
	gitRemote?: string;
	agentType: string;
	summary?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// Turn Repository Types
// =============================================================================

export const CreateTurnInputSchema = z.object({
	sessionId: z.string(),
	userContent: z.string(),
	userContentHash: z.string(),
	assistantPreview: z.string().max(2000),
	assistantBlobRef: z.string().optional(),
	embedding: z.array(z.number()).optional(),
	sequenceIndex: z.number().int(),
	filesTouched: z.array(z.string()).default([]),
	toolCallsCount: z.number().int().default(0),
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
	cacheReadTokens: z.number().int().optional(),
	cacheWriteTokens: z.number().int().optional(),
	reasoningTokens: z.number().int().optional(),
	costUsd: z.number().optional(),
	durationMs: z.number().int().optional(),
	gitCommit: z.string().optional(),
});

export type CreateTurnInput = z.infer<typeof CreateTurnInputSchema>;

export const UpdateTurnInputSchema = z.object({
	assistantPreview: z.string().max(2000).optional(),
	assistantBlobRef: z.string().optional(),
	embedding: z.array(z.number()).optional(),
	filesTouched: z.array(z.string()).optional(),
	toolCallsCount: z.number().int().optional(),
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
	cacheReadTokens: z.number().int().optional(),
	cacheWriteTokens: z.number().int().optional(),
	reasoningTokens: z.number().int().optional(),
	costUsd: z.number().optional(),
	durationMs: z.number().int().optional(),
	gitCommit: z.string().optional(),
});

export type UpdateTurnInput = z.infer<typeof UpdateTurnInputSchema>;

/**
 * Turn entity returned from repository.
 */
export interface Turn {
	id: string;
	sessionId: string;
	userContent: string;
	userContentHash: string;
	assistantPreview: string;
	assistantBlobRef?: string;
	embedding?: number[];
	sequenceIndex: number;
	filesTouched: string[];
	toolCallsCount: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	costUsd?: number;
	durationMs?: number;
	gitCommit?: string;
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// Reasoning Repository Types
// =============================================================================

export const CreateReasoningInputSchema = z.object({
	turnId: z.string(),
	contentHash: z.string(),
	preview: z.string().max(1000),
	blobRef: z.string().optional(),
	reasoningType: z
		.enum(["chain_of_thought", "reflection", "planning", "analysis", "unknown"])
		.default("unknown"),
	sequenceIndex: z.number().int(),
	embedding: z.array(z.number()).optional(),
});

export type CreateReasoningInput = z.infer<typeof CreateReasoningInputSchema>;

/**
 * Reasoning entity returned from repository.
 */
export interface Reasoning {
	id: string;
	turnId: string;
	contentHash: string;
	preview: string;
	blobRef?: string;
	reasoningType: string;
	sequenceIndex: number;
	embedding?: number[];
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// ToolCall Repository Types
// =============================================================================

export const CreateToolCallInputSchema = z.object({
	turnId: z.string(),
	callId: z.string(),
	toolName: z.string(),
	toolType: z.string().default("unknown"),
	argumentsJson: z.string(),
	argumentsPreview: z.string().max(500).optional(),
	status: z.enum(["pending", "success", "error", "cancelled"]).default("pending"),
	errorMessage: z.string().optional(),
	sequenceIndex: z.number().int(),
	reasoningSequence: z.number().int().optional(),
});

export type CreateToolCallInput = z.infer<typeof CreateToolCallInputSchema>;

export const ToolResultSchema = z.object({
	status: z.enum(["success", "error", "cancelled"]),
	errorMessage: z.string().optional(),
	executionTimeMs: z.number().int().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * ToolCall entity returned from repository.
 */
export interface ToolCall {
	id: string;
	turnId: string;
	callId: string;
	toolName: string;
	toolType: string;
	argumentsJson: string;
	argumentsPreview?: string;
	status: string;
	errorMessage?: string;
	sequenceIndex: number;
	reasoningSequence?: number;
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// FileTouch Repository Types
// =============================================================================

export const CreateFileTouchInputSchema = z.object({
	toolCallId: z.string(),
	filePath: z.string(),
	action: z.enum(["read", "edit", "create", "delete", "list", "search"]),
	sequenceIndex: z.number().int().optional(),
	diffPreview: z.string().max(500).optional(),
	linesAdded: z.number().int().optional(),
	linesRemoved: z.number().int().optional(),
	matchCount: z.number().int().optional(),
	matchedFiles: z.array(z.string()).optional(),
});

export type CreateFileTouchInput = z.infer<typeof CreateFileTouchInputSchema>;

/**
 * FileTouch entity returned from repository.
 */
export interface FileTouch {
	id: string;
	toolCallId: string;
	filePath: string;
	action: string;
	sequenceIndex?: number;
	diffPreview?: string;
	linesAdded?: number;
	linesRemoved?: number;
	matchCount?: number;
	matchedFiles?: string[];
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// Memory Repository Types
// =============================================================================

export const CreateMemoryInputSchema = z.object({
	content: z.string(),
	contentHash: z.string(),
	type: z.enum(["decision", "context", "insight", "preference", "fact", "turn"]).default("context"),
	tags: z.array(z.string()).default([]),
	sourceSessionId: z.string().optional(),
	sourceTurnId: z.string().optional(),
	source: z.enum(["user", "auto", "import"]).default("user"),
	project: z.string().optional(),
	workingDir: z.string().optional(),
	embedding: z.array(z.number()).optional(),
});

export type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;

export const UpdateMemoryInputSchema = z.object({
	content: z.string().optional(),
	contentHash: z.string().optional(),
	type: z.enum(["decision", "context", "insight", "preference", "fact", "turn"]).optional(),
	tags: z.array(z.string()).optional(),
	embedding: z.array(z.number()).optional(),
});

export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;

/**
 * Memory entity returned from repository.
 */
export interface Memory {
	id: string;
	content: string;
	contentHash: string;
	type: string;
	tags: string[];
	sourceSessionId?: string;
	sourceTurnId?: string;
	source: string;
	project?: string;
	workingDir?: string;
	embedding?: number[];
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}

// =============================================================================
// Entity Repository Types
// =============================================================================

export const CreateEntityInputSchema = z.object({
	name: z.string(),
	aliases: z.array(z.string()).default([]),
	type: z.enum(["tool", "concept", "pattern", "file", "person", "project", "technology"]),
	description: z.string().optional(),
	mentionCount: z.number().int().default(1),
	project: z.string().optional(),
	embedding: z.array(z.number()).optional(),
});

export type CreateEntityInput = z.infer<typeof CreateEntityInputSchema>;

export const UpdateEntityInputSchema = z.object({
	name: z.string().optional(),
	aliases: z.array(z.string()).optional(),
	type: z
		.enum(["tool", "concept", "pattern", "file", "person", "project", "technology"])
		.optional(),
	description: z.string().optional(),
	mentionCount: z.number().int().optional(),
	embedding: z.array(z.number()).optional(),
});

export type UpdateEntityInput = z.infer<typeof UpdateEntityInputSchema>;

/**
 * Entity entity returned from repository.
 */
export interface Entity {
	id: string;
	name: string;
	aliases: string[];
	type: string;
	description?: string;
	mentionCount: number;
	project?: string;
	embedding?: number[];
	// Bitemporal
	vtStart: number;
	vtEnd: number;
	ttStart: number;
	ttEnd: number;
}
