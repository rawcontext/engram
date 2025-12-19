import type { ParserStrategy, StreamDelta } from "./interface";
import {
	AnthropicContentBlockDeltaSchema,
	AnthropicContentBlockStartSchema,
	AnthropicMessageDeltaSchema,
	AnthropicMessageStartSchema,
} from "./schemas";

export class AnthropicParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		const p = payload as Record<string, unknown>;
		// Anthropic Event Types
		const type = p.type;

		if (type === "message_start") {
			const result = AnthropicMessageStartSchema.safeParse(payload);
			if (!result.success) {
				// Fallback to lenient parsing for malformed but recoverable data
				return null;
			}
			const message = result.data.message;
			const usage = message?.usage;
			return {
				usage: {
					input: usage?.input_tokens || 0,
				},
			};
		}

		if (type === "content_block_start") {
			const result = AnthropicContentBlockStartSchema.safeParse(payload);
			if (!result.success) {
				return null;
			}
			const contentBlock = result.data.content_block;
			if (contentBlock?.type === "tool_use") {
				return {
					toolCall: {
						index: result.data.index,
						id: contentBlock.id,
						name: contentBlock.name,
						args: "", // Start with empty args
					},
				};
			}
		}

		if (type === "content_block_delta") {
			const result = AnthropicContentBlockDeltaSchema.safeParse(payload);
			if (!result.success) {
				return null;
			}
			const delta = result.data.delta;
			if (delta.type === "text_delta") {
				return { content: delta.text };
			}
			if (delta.type === "input_json_delta") {
				return {
					toolCall: {
						index: result.data.index,
						args: delta.partial_json,
					},
				};
			}
		}

		if (type === "message_delta") {
			const result = AnthropicMessageDeltaSchema.safeParse(payload);
			if (!result.success) {
				return null;
			}
			const usage = result.data.usage;
			const delta = result.data.delta;
			const streamDelta: StreamDelta = {};

			if (usage?.output_tokens) {
				streamDelta.usage = { output: usage.output_tokens };
			}
			if (delta?.stop_reason) {
				streamDelta.stopReason = delta.stop_reason;
			}
			return Object.keys(streamDelta).length > 0 ? streamDelta : null;
		}

		return null;
	}
}
