import { randomUUID } from "node:crypto";
import { z } from "zod";

export const ProviderEnum = z.enum([
	"openai",
	"anthropic",
	"local_mock",
	"xai",
	"claude_code",
	"codex",
	"gemini",
	"opencode",
	"cline",
]);

/**
 * Generate a unique event ID (UUID v4).
 * Use this to ensure all events have properly formatted IDs.
 */
export function generateEventId(): string {
	return randomUUID();
}

export const RawStreamEventSchema = z.object({
	event_id: z.string().uuid(),
	ingest_timestamp: z.string().datetime(),
	provider: ProviderEnum,
	// Zod 3.x behavior for records: z.record(keySchema, valueSchema) OR z.record(valueSchema)
	// We'll use z.record(z.string(), z.unknown()) to be explicit and compatible
	payload: z.record(z.string(), z.unknown()),
	headers: z.record(z.string(), z.string()).optional(),
});

export type RawStreamEvent = z.infer<typeof RawStreamEventSchema>;

export const ParsedStreamEventSchema = z.object({
	event_id: z.string().uuid(),
	original_event_id: z.string().uuid(),
	timestamp: z.string().datetime(),
	type: z.enum(["content", "thought", "tool_call", "diff", "usage", "control"]),
	role: z.enum(["user", "assistant", "system"]).optional(),
	content: z.string().optional(),
	thought: z.string().optional(),
	tool_call: z
		.object({
			id: z.string(),
			name: z.string(),
			arguments_delta: z.string(),
			index: z.number().default(0),
		})
		.optional(),
	diff: z
		.object({
			file: z.string().optional(),
			hunk: z.string(),
		})
		.optional(),
	usage: z
		.object({
			input_tokens: z.number().default(0),
			output_tokens: z.number().default(0),
		})
		.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ParsedStreamEvent = z.infer<typeof ParsedStreamEventSchema>;
