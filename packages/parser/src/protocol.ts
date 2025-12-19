import type { IncomingHttpHeaders } from "node:http";

export type Protocol = "openai" | "anthropic" | "unknown";

export function detectProtocol(headers: IncomingHttpHeaders, bodyChunk: unknown): Protocol {
	const chunk = bodyChunk as Record<string, unknown>;
	// 1. Header Check (Fastest)
	if (headers["anthropic-version"]) return "anthropic";

	// 2. Body Structure Check (Robust)
	if (chunk) {
		// Anthropic Event Shape
		if (chunk.type === "message_start" || chunk.type === "content_block_delta") {
			return "anthropic";
		}

		// OpenAI Event Shape
		if (chunk.object === "chat.completion.chunk") {
			return "openai";
		}

		// Azure OpenAI (often resembles OpenAI but might have specific fields)
		if (chunk.object === "chat.completion.chunk" && chunk.model_extra) {
			return "openai"; // Treat as OpenAI compatible
		}
	}

	return "unknown";
}
