import type { IncomingHttpHeaders } from "node:http";

export type Protocol = "openai" | "anthropic" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function detectProtocol(headers: IncomingHttpHeaders, bodyChunk: unknown): Protocol {
	// 1. Header Check (Fastest)
	if (headers["anthropic-version"]) return "anthropic";

	// 2. Body Structure Check (Robust)
	if (!isRecord(bodyChunk)) {
		return "unknown";
	}

	// Anthropic Event Shape
	if (bodyChunk.type === "message_start" || bodyChunk.type === "content_block_delta") {
		return "anthropic";
	}

	// OpenAI Event Shape
	if (bodyChunk.object === "chat.completion.chunk") {
		return "openai";
	}

	// Azure OpenAI (often resembles OpenAI but might have specific fields)
	if (bodyChunk.object === "chat.completion.chunk" && bodyChunk.model_extra) {
		return "openai"; // Treat as OpenAI compatible
	}

	return "unknown";
}
