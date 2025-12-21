import type { StreamDelta } from "./interface";
import { OpenAIParser } from "./openai";
import { XAIChunkSchema } from "./schemas";

export class XAIParser extends OpenAIParser {
	override parse(payload: unknown): StreamDelta | null {
		// First, use the base OpenAI parsing
		let result = super.parse(payload);

		// Validate with xAI-specific schema to extract reasoning_content
		const parseResult = XAIChunkSchema.safeParse(payload);
		if (!parseResult.success) {
			return result;
		}

		const p = parseResult.data;
		const choice = p.choices?.[0];
		const delta = choice?.delta;

		if (delta?.reasoning_content) {
			// Create or extend result with proper StreamDelta type
			result = {
				...result,
				thought: delta.reasoning_content,
				type: "thought" as const,
			};
		}

		return result && Object.keys(result).length > 0 ? result : null;
	}
}
