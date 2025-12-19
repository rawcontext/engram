/**
 * Zod schemas for runtime validation of API responses from various AI providers.
 *
 * These schemas catch malformed API responses at runtime, providing type-safe
 * parsing with detailed error messages.
 *
 * @module @engram/ingestion-core/parser/schemas
 */

import { z } from "zod";

// ============================================================================
// Anthropic Schemas
// ============================================================================

/**
 * Anthropic message_start event schema.
 * Emitted at the beginning of a message stream.
 */
export const AnthropicMessageStartSchema = z.object({
	type: z.literal("message_start"),
	message: z
		.object({
			id: z.string().optional(),
			type: z.literal("message").optional(),
			role: z.literal("assistant").optional(),
			model: z.string().optional(),
			usage: z
				.object({
					input_tokens: z.number(),
					output_tokens: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
});
export type AnthropicMessageStart = z.infer<typeof AnthropicMessageStartSchema>;

/**
 * Anthropic content_block_start event schema.
 * Signals the start of a content block (text or tool_use).
 */
export const AnthropicContentBlockStartSchema = z.object({
	type: z.literal("content_block_start"),
	index: z.number(),
	content_block: z
		.object({
			type: z.enum(["text", "tool_use"]),
			id: z.string().optional(),
			name: z.string().optional(),
			text: z.string().optional(),
		})
		.optional(),
});
export type AnthropicContentBlockStart = z.infer<typeof AnthropicContentBlockStartSchema>;

/**
 * Anthropic content_block_delta event schema.
 * Streams incremental content updates.
 */
export const AnthropicContentBlockDeltaSchema = z.object({
	type: z.literal("content_block_delta"),
	index: z.number(),
	delta: z.object({
		type: z.enum(["text_delta", "input_json_delta"]),
		text: z.string().optional(),
		partial_json: z.string().optional(),
	}),
});
export type AnthropicContentBlockDelta = z.infer<typeof AnthropicContentBlockDeltaSchema>;

/**
 * Anthropic message_delta event schema.
 * Provides final usage stats and stop reason.
 */
export const AnthropicMessageDeltaSchema = z.object({
	type: z.literal("message_delta"),
	usage: z
		.object({
			output_tokens: z.number(),
		})
		.optional(),
	delta: z
		.object({
			stop_reason: z.string().optional(),
		})
		.optional(),
});
export type AnthropicMessageDelta = z.infer<typeof AnthropicMessageDeltaSchema>;

/**
 * Union schema for all Anthropic event types.
 */
export const AnthropicEventSchema = z.discriminatedUnion("type", [
	AnthropicMessageStartSchema,
	AnthropicContentBlockStartSchema,
	AnthropicContentBlockDeltaSchema,
	AnthropicMessageDeltaSchema,
	// Passthrough for other event types (ping, content_block_stop, message_stop)
	z.object({ type: z.literal("ping") }),
	z.object({ type: z.literal("content_block_stop"), index: z.number() }),
	z.object({ type: z.literal("message_stop") }),
]);
export type AnthropicEvent = z.infer<typeof AnthropicEventSchema>;

// ============================================================================
// OpenAI Schemas
// ============================================================================

/**
 * OpenAI tool call schema within a delta.
 */
export const OpenAIToolCallSchema = z.object({
	index: z.number().optional(),
	id: z.string().optional(),
	type: z.literal("function").optional(),
	function: z
		.object({
			name: z.string().optional(),
			arguments: z.string().optional(),
		})
		.optional(),
});
export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;

/**
 * OpenAI choice delta schema.
 */
export const OpenAIDeltaSchema = z.object({
	role: z.string().optional(),
	content: z.string().nullable().optional(),
	tool_calls: z.array(OpenAIToolCallSchema).optional(),
});
export type OpenAIDelta = z.infer<typeof OpenAIDeltaSchema>;

/**
 * OpenAI choice schema.
 */
export const OpenAIChoiceSchema = z.object({
	index: z.number().optional(),
	delta: OpenAIDeltaSchema.optional(),
	finish_reason: z.string().nullable().optional(),
});
export type OpenAIChoice = z.infer<typeof OpenAIChoiceSchema>;

/**
 * OpenAI usage schema.
 */
export const OpenAIUsageSchema = z.object({
	prompt_tokens: z.number(),
	completion_tokens: z.number(),
	total_tokens: z.number().optional(),
});
export type OpenAIUsage = z.infer<typeof OpenAIUsageSchema>;

/**
 * OpenAI streaming chunk schema.
 */
export const OpenAIChunkSchema = z.object({
	id: z.string().optional(),
	object: z.string().optional(),
	created: z.number().optional(),
	model: z.string().optional(),
	choices: z.array(OpenAIChoiceSchema).optional(),
	usage: OpenAIUsageSchema.optional().nullable(),
});
export type OpenAIChunk = z.infer<typeof OpenAIChunkSchema>;

// ============================================================================
// xAI (Grok) Schemas
// ============================================================================

/**
 * xAI delta extends OpenAI delta with reasoning_content.
 */
export const XAIDeltaSchema = OpenAIDeltaSchema.extend({
	reasoning_content: z.string().optional(),
});
export type XAIDelta = z.infer<typeof XAIDeltaSchema>;

/**
 * xAI choice schema with extended delta.
 */
export const XAIChoiceSchema = z.object({
	index: z.number().optional(),
	delta: XAIDeltaSchema.optional(),
	finish_reason: z.string().nullable().optional(),
});
export type XAIChoice = z.infer<typeof XAIChoiceSchema>;

/**
 * xAI streaming chunk schema (extends OpenAI format).
 */
export const XAIChunkSchema = z.object({
	id: z.string().optional(),
	object: z.string().optional(),
	created: z.number().optional(),
	model: z.string().optional(),
	choices: z.array(XAIChoiceSchema).optional(),
	usage: OpenAIUsageSchema.optional().nullable(),
});
export type XAIChunk = z.infer<typeof XAIChunkSchema>;

// ============================================================================
// Claude Code Schemas
// ============================================================================

/**
 * Claude Code usage schema with cache metrics.
 */
export const ClaudeCodeUsageSchema = z.object({
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cache_read_input_tokens: z.number().optional(),
	cache_creation_input_tokens: z.number().optional(),
});
export type ClaudeCodeUsage = z.infer<typeof ClaudeCodeUsageSchema>;

/**
 * Claude Code content block schema.
 */
export const ClaudeCodeContentBlockSchema = z.object({
	type: z.enum(["text", "tool_use", "tool_result"]),
	text: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	input: z.unknown().optional(),
});
export type ClaudeCodeContentBlock = z.infer<typeof ClaudeCodeContentBlockSchema>;

/**
 * Claude Code assistant event schema.
 */
export const ClaudeCodeAssistantSchema = z.object({
	type: z.literal("assistant"),
	message: z
		.object({
			role: z.string().optional(),
			content: z.array(ClaudeCodeContentBlockSchema).optional(),
			usage: ClaudeCodeUsageSchema.optional(),
			model: z.string().optional(),
			stop_reason: z.string().optional(),
		})
		.optional(),
});
export type ClaudeCodeAssistant = z.infer<typeof ClaudeCodeAssistantSchema>;

/**
 * Claude Code tool_use event schema.
 */
export const ClaudeCodeToolUseSchema = z.object({
	type: z.literal("tool_use"),
	tool_use: z
		.object({
			tool_use_id: z.string(),
			name: z.string(),
			input: z.unknown(),
		})
		.optional(),
});
export type ClaudeCodeToolUse = z.infer<typeof ClaudeCodeToolUseSchema>;

/**
 * Claude Code tool_result event schema.
 */
export const ClaudeCodeToolResultSchema = z.object({
	type: z.literal("tool_result"),
	tool_result: z
		.object({
			tool_use_id: z.string(),
			content: z.string().optional(),
		})
		.optional(),
});
export type ClaudeCodeToolResult = z.infer<typeof ClaudeCodeToolResultSchema>;

/**
 * Claude Code result event schema (final summary).
 */
export const ClaudeCodeResultSchema = z.object({
	type: z.literal("result"),
	result: z.string().optional(),
	subtype: z.string().optional(),
	usage: ClaudeCodeUsageSchema.optional(),
	total_cost_usd: z.number().optional(),
	duration_ms: z.number().optional(),
	duration_api_ms: z.number().optional(),
	session_id: z.string().optional(),
});
export type ClaudeCodeResult = z.infer<typeof ClaudeCodeResultSchema>;

/**
 * Claude Code system event schema.
 */
export const ClaudeCodeSystemSchema = z.object({
	type: z.literal("system"),
	subtype: z.enum(["init", "hook_response", "user"]).optional(),
	model: z.string().optional(),
	tools: z.array(z.string()).optional(),
	session_id: z.string().optional(),
	hook_name: z.string().optional(),
	stdout: z.string().optional(),
});
export type ClaudeCodeSystem = z.infer<typeof ClaudeCodeSystemSchema>;

/**
 * Union schema for all Claude Code event types.
 */
export const ClaudeCodeEventSchema = z.discriminatedUnion("type", [
	ClaudeCodeAssistantSchema,
	ClaudeCodeToolUseSchema,
	ClaudeCodeToolResultSchema,
	ClaudeCodeResultSchema,
	ClaudeCodeSystemSchema,
]);
export type ClaudeCodeEvent = z.infer<typeof ClaudeCodeEventSchema>;

// ============================================================================
// Gemini Schemas
// ============================================================================

/**
 * Gemini init event schema.
 */
export const GeminiInitSchema = z.object({
	type: z.literal("init"),
	timestamp: z.string().optional(),
	session_id: z.string().optional(),
	model: z.string().optional(),
});
export type GeminiInit = z.infer<typeof GeminiInitSchema>;

/**
 * Gemini message event schema.
 */
export const GeminiMessageSchema = z.object({
	type: z.literal("message"),
	timestamp: z.string().optional(),
	role: z.enum(["user", "assistant"]),
	content: z.string().optional(),
	delta: z.boolean().optional(),
});
export type GeminiMessage = z.infer<typeof GeminiMessageSchema>;

/**
 * Gemini tool_use event schema.
 */
export const GeminiToolUseSchema = z.object({
	type: z.literal("tool_use"),
	timestamp: z.string().optional(),
	tool_name: z.string(),
	tool_id: z.string(),
	parameters: z.record(z.string(), z.unknown()).optional(),
});
export type GeminiToolUse = z.infer<typeof GeminiToolUseSchema>;

/**
 * Gemini tool_result event schema.
 */
export const GeminiToolResultSchema = z.object({
	type: z.literal("tool_result"),
	timestamp: z.string().optional(),
	tool_id: z.string(),
	status: z.string(),
	output: z.string().optional(),
});
export type GeminiToolResult = z.infer<typeof GeminiToolResultSchema>;

/**
 * Gemini result (final stats) event schema.
 */
export const GeminiResultSchema = z.object({
	type: z.literal("result"),
	timestamp: z.string().optional(),
	status: z.string().optional(),
	stats: z
		.object({
			total_tokens: z.number().optional(),
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
			duration_ms: z.number().optional(),
			tool_calls: z.number().optional(),
		})
		.optional(),
});
export type GeminiResult = z.infer<typeof GeminiResultSchema>;

/**
 * Union schema for all Gemini event types.
 */
export const GeminiEventSchema = z.discriminatedUnion("type", [
	GeminiInitSchema,
	GeminiMessageSchema,
	GeminiToolUseSchema,
	GeminiToolResultSchema,
	GeminiResultSchema,
]);
export type GeminiEvent = z.infer<typeof GeminiEventSchema>;

// ============================================================================
// Codex Schemas
// ============================================================================

/**
 * Codex item schema (shared across started/completed).
 */
export const CodexItemSchema = z.object({
	id: z.string().optional(),
	type: z.enum(["reasoning", "command_execution", "agent_message"]),
	text: z.string().optional(),
	command: z.string().optional(),
	aggregated_output: z.string().optional(),
	exit_code: z.number().nullable().optional(),
	status: z.string().optional(),
});
export type CodexItem = z.infer<typeof CodexItemSchema>;

/**
 * Codex usage schema with cached tokens.
 */
export const CodexUsageSchema = z.object({
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cached_input_tokens: z.number().optional(),
});
export type CodexUsage = z.infer<typeof CodexUsageSchema>;

/**
 * Codex thread.started event schema.
 */
export const CodexThreadStartedSchema = z.object({
	type: z.literal("thread.started"),
	thread_id: z.string(),
});
export type CodexThreadStarted = z.infer<typeof CodexThreadStartedSchema>;

/**
 * Codex turn.started event schema.
 */
export const CodexTurnStartedSchema = z.object({
	type: z.literal("turn.started"),
});
export type CodexTurnStarted = z.infer<typeof CodexTurnStartedSchema>;

/**
 * Codex item.started event schema.
 */
export const CodexItemStartedSchema = z.object({
	type: z.literal("item.started"),
	item: CodexItemSchema.optional(),
});
export type CodexItemStarted = z.infer<typeof CodexItemStartedSchema>;

/**
 * Codex item.completed event schema.
 */
export const CodexItemCompletedSchema = z.object({
	type: z.literal("item.completed"),
	item: CodexItemSchema.optional(),
});
export type CodexItemCompleted = z.infer<typeof CodexItemCompletedSchema>;

/**
 * Codex turn.completed event schema.
 */
export const CodexTurnCompletedSchema = z.object({
	type: z.literal("turn.completed"),
	usage: CodexUsageSchema.optional(),
});
export type CodexTurnCompleted = z.infer<typeof CodexTurnCompletedSchema>;

/**
 * Union schema for all Codex event types.
 */
export const CodexEventSchema = z.discriminatedUnion("type", [
	CodexThreadStartedSchema,
	CodexTurnStartedSchema,
	CodexItemStartedSchema,
	CodexItemCompletedSchema,
	CodexTurnCompletedSchema,
]);
export type CodexEvent = z.infer<typeof CodexEventSchema>;

// ============================================================================
// Cline Schemas
// ============================================================================

/**
 * Cline API request data schema (embedded in text field).
 */
export const ClineApiDataSchema = z.object({
	tokensIn: z.number().optional(),
	tokensOut: z.number().optional(),
	cacheReads: z.number().optional(),
	cacheWrites: z.number().optional(),
	cost: z.number().optional(),
});
export type ClineApiData = z.infer<typeof ClineApiDataSchema>;

/**
 * Cline tool data schema (embedded in text field).
 */
export const ClineToolDataSchema = z.object({
	id: z.string().optional(),
	tool: z.string().optional(),
	input: z.record(z.string(), z.unknown()).optional(),
});
export type ClineToolData = z.infer<typeof ClineToolDataSchema>;

/**
 * Cline say event schema (all Cline events are "say" type).
 */
export const ClineSayEventSchema = z.object({
	type: z.literal("say"),
	say: z.enum(["text", "api_req_started", "api_req_finished", "tool", "checkpoint_created"]),
	text: z.string().optional(),
});
export type ClineSayEvent = z.infer<typeof ClineSayEventSchema>;

/**
 * Main Cline event schema.
 */
export const ClineEventSchema = ClineSayEventSchema;
export type ClineEvent = z.infer<typeof ClineEventSchema>;

// ============================================================================
// OpenCode Schemas
// ============================================================================

/**
 * OpenCode timing schema.
 */
export const OpenCodeTimingSchema = z.object({
	start: z.number().optional(),
	end: z.number().optional(),
});
export type OpenCodeTiming = z.infer<typeof OpenCodeTimingSchema>;

/**
 * OpenCode cache tokens schema.
 */
export const OpenCodeCacheSchema = z.object({
	read: z.number().optional(),
	write: z.number().optional(),
});
export type OpenCodeCache = z.infer<typeof OpenCodeCacheSchema>;

/**
 * OpenCode tokens schema.
 */
export const OpenCodeTokensSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	reasoning: z.number().optional(),
	cache: OpenCodeCacheSchema.optional(),
});
export type OpenCodeTokens = z.infer<typeof OpenCodeTokensSchema>;

/**
 * OpenCode tool state schema.
 */
export const OpenCodeToolStateSchema = z.object({
	status: z.string().optional(),
	input: z.record(z.string(), z.unknown()).optional(),
	output: z.unknown().optional(),
});
export type OpenCodeToolState = z.infer<typeof OpenCodeToolStateSchema>;

/**
 * OpenCode text part schema.
 */
export const OpenCodeTextPartSchema = z.object({
	type: z.literal("text"),
	text: z.string().optional(),
	id: z.string().optional(),
	sessionID: z.string().optional(),
	messageID: z.string().optional(),
	time: OpenCodeTimingSchema.optional(),
});
export type OpenCodeTextPart = z.infer<typeof OpenCodeTextPartSchema>;

/**
 * OpenCode tool part schema.
 */
export const OpenCodeToolPartSchema = z.object({
	type: z.literal("tool"),
	id: z.string().optional(),
	sessionID: z.string().optional(),
	messageID: z.string().optional(),
	callID: z.string().optional(),
	tool: z.string().optional(),
	state: OpenCodeToolStateSchema.optional(),
});
export type OpenCodeToolPart = z.infer<typeof OpenCodeToolPartSchema>;

/**
 * OpenCode step-start part schema.
 */
export const OpenCodeStepStartPartSchema = z.object({
	type: z.literal("step-start"),
	id: z.string().optional(),
	sessionID: z.string().optional(),
	messageID: z.string().optional(),
	snapshot: z.string().optional(),
});
export type OpenCodeStepStartPart = z.infer<typeof OpenCodeStepStartPartSchema>;

/**
 * OpenCode step-finish part schema.
 */
export const OpenCodeStepFinishPartSchema = z.object({
	type: z.literal("step-finish"),
	id: z.string().optional(),
	sessionID: z.string().optional(),
	messageID: z.string().optional(),
	reason: z.string().optional(),
	cost: z.number().optional(),
	tokens: OpenCodeTokensSchema.optional(),
	snapshot: z.string().optional(),
});
export type OpenCodeStepFinishPart = z.infer<typeof OpenCodeStepFinishPartSchema>;

/**
 * OpenCode text event schema.
 */
export const OpenCodeTextEventSchema = z.object({
	type: z.literal("text"),
	timestamp: z.union([z.string(), z.number()]).optional(),
	sessionID: z.string().optional(),
	part: OpenCodeTextPartSchema.optional(),
});
export type OpenCodeTextEvent = z.infer<typeof OpenCodeTextEventSchema>;

/**
 * OpenCode tool_use event schema.
 */
export const OpenCodeToolUseEventSchema = z.object({
	type: z.literal("tool_use"),
	timestamp: z.union([z.string(), z.number()]).optional(),
	sessionID: z.string().optional(),
	part: OpenCodeToolPartSchema.optional(),
});
export type OpenCodeToolUseEvent = z.infer<typeof OpenCodeToolUseEventSchema>;

/**
 * OpenCode step_start event schema.
 */
export const OpenCodeStepStartEventSchema = z.object({
	type: z.literal("step_start"),
	timestamp: z.union([z.string(), z.number()]).optional(),
	sessionID: z.string().optional(),
	part: OpenCodeStepStartPartSchema.optional(),
});
export type OpenCodeStepStartEvent = z.infer<typeof OpenCodeStepStartEventSchema>;

/**
 * OpenCode step_finish event schema.
 */
export const OpenCodeStepFinishEventSchema = z.object({
	type: z.literal("step_finish"),
	timestamp: z.union([z.string(), z.number()]).optional(),
	sessionID: z.string().optional(),
	part: OpenCodeStepFinishPartSchema.optional(),
});
export type OpenCodeStepFinishEvent = z.infer<typeof OpenCodeStepFinishEventSchema>;

/**
 * Union schema for all OpenCode event types.
 */
export const OpenCodeEventSchema = z.discriminatedUnion("type", [
	OpenCodeTextEventSchema,
	OpenCodeToolUseEventSchema,
	OpenCodeStepStartEventSchema,
	OpenCodeStepFinishEventSchema,
]);
export type OpenCodeEvent = z.infer<typeof OpenCodeEventSchema>;

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Safely parse an Anthropic event with detailed error information.
 */
export function parseAnthropicEvent(payload: unknown):
	| {
			success: true;
			data: AnthropicEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return AnthropicEventSchema.safeParse(payload);
}

/**
 * Safely parse an OpenAI chunk with detailed error information.
 */
export function parseOpenAIChunk(payload: unknown):
	| {
			success: true;
			data: OpenAIChunk;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return OpenAIChunkSchema.safeParse(payload);
}

/**
 * Safely parse an xAI chunk with detailed error information.
 */
export function parseXAIChunk(payload: unknown):
	| {
			success: true;
			data: XAIChunk;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return XAIChunkSchema.safeParse(payload);
}

/**
 * Safely parse a Claude Code event with detailed error information.
 */
export function parseClaudeCodeEvent(payload: unknown):
	| {
			success: true;
			data: ClaudeCodeEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return ClaudeCodeEventSchema.safeParse(payload);
}

/**
 * Safely parse a Gemini event with detailed error information.
 */
export function parseGeminiEvent(payload: unknown):
	| {
			success: true;
			data: GeminiEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return GeminiEventSchema.safeParse(payload);
}

/**
 * Safely parse a Codex event with detailed error information.
 */
export function parseCodexEvent(payload: unknown):
	| {
			success: true;
			data: CodexEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return CodexEventSchema.safeParse(payload);
}

/**
 * Safely parse a Cline event with detailed error information.
 */
export function parseClineEvent(payload: unknown):
	| {
			success: true;
			data: ClineEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return ClineEventSchema.safeParse(payload);
}

/**
 * Safely parse an OpenCode event with detailed error information.
 */
export function parseOpenCodeEvent(payload: unknown):
	| {
			success: true;
			data: OpenCodeEvent;
	  }
	| {
			success: false;
			error: z.ZodError;
	  } {
	return OpenCodeEventSchema.safeParse(payload);
}
