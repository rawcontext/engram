import type { StreamDelta } from "./interface";
import { OpenAIParser } from "./openai";

export class XAIParser extends OpenAIParser {
	override parse(payload: unknown): StreamDelta | null {
		// First, use the base OpenAI parsing
		let result = super.parse(payload);

		// If base parser found nothing, start with empty object if we have a delta
		const p = payload as Record<string, unknown>;
		const choices = p.choices as Array<Record<string, unknown>> | undefined;
		const choice = choices?.[0];
		const delta = choice?.delta as Record<string, unknown> | undefined;

		if (!result && delta) {
			result = {};
		}

		if (!result) return null;

		if (delta) {
			// Check for reasoning_content (Grok 3 Mini / Reasoning models)
			if (delta.reasoning_content) {
				result.thought = delta.reasoning_content as string;
				result.type = "thought";
			}
		}

		return Object.keys(result).length > 0 ? result : null;
	}
}
