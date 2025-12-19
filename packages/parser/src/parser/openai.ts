import type { ParserStrategy, StreamDelta } from "./interface";
import { OpenAIChunkSchema } from "./schemas";

export class OpenAIParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		// Validate with Zod schema
		const parseResult = OpenAIChunkSchema.safeParse(payload);
		if (!parseResult.success) {
			// Invalid payload structure
			return null;
		}

		const p = parseResult.data;

		// Check for Usage (Stream Options)
		if (p.usage) {
			return {
				usage: {
					input: p.usage.prompt_tokens,
					output: p.usage.completion_tokens,
				},
			};
		}

		const choice = p.choices?.[0];
		if (!choice) return null;

		const delta = choice.delta;
		if (!delta) return null;

		const result: StreamDelta = {};

		if (delta.role) {
			result.role = delta.role;
		}

		// Content
		if (delta.content) {
			result.type = "content";
			result.content = delta.content;
		}

		// Tool Calls
		const toolCalls = delta.tool_calls;
		if (toolCalls && toolCalls.length > 0) {
			result.type = "tool_call";
			const toolCall = toolCalls[0];
			result.toolCall = {
				index: toolCall.index,
				id: toolCall.id, // Only present in first chunk usually
				name: toolCall.function?.name, // Only present in first chunk usually
				args: toolCall.function?.arguments, // Partial JSON
			};
		}

		if (choice.finish_reason) {
			result.stopReason = choice.finish_reason;
		}

		return Object.keys(result).length > 0 ? result : null;
	}
}
