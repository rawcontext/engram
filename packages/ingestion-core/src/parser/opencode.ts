import type { ParserStrategy, StreamDelta } from "./interface";

/**
 * Parser for SST OpenCode CLI's `--format json` output.
 *
 * OpenCode CLI JSON events have these types:
 * - step_start: { type: "step_start", timestamp, sessionID, part: { type: "step-start", ... } }
 * - text: { type: "text", timestamp, sessionID, part: { type: "text", text, ... } }
 * - tool_use: { type: "tool_use", timestamp, sessionID, part: { type: "tool", callID, tool, state: { status, input, output } } }
 * - step_finish: { type: "step_finish", timestamp, sessionID, part: { type: "step-finish", reason, cost, tokens: { input, output, reasoning, cache } } }
 */
export class OpenCodeParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		const p = payload as Record<string, unknown>;
		const type = p.type as string;

		// Handle text events (assistant content)
		if (type === "text") {
			const part = p.part as Record<string, unknown> | undefined;
			if (!part) return null;

			const text = part.text as string;
			if (!text) return null;

			return {
				type: "content",
				role: "assistant",
				content: text,
			};
		}

		// Handle tool_use events
		if (type === "tool_use") {
			const part = p.part as Record<string, unknown> | undefined;
			if (!part) return null;

			const callID = part.callID as string;
			const tool = part.tool as string;
			const state = part.state as Record<string, unknown> | undefined;

			// Extract input parameters from state
			const input = state?.input as Record<string, unknown> | undefined;

			return {
				type: "tool_call",
				toolCall: {
					id: callID || "",
					name: tool || "",
					args: input ? JSON.stringify(input) : "{}",
					index: 0,
				},
			};
		}

		// Handle step_finish events with token usage
		if (type === "step_finish") {
			const part = p.part as Record<string, unknown> | undefined;
			if (!part) return null;

			const tokens = part.tokens as Record<string, unknown> | undefined;
			if (!tokens) return null;

			const inputTokens = (tokens.input as number) || 0;
			const outputTokens = (tokens.output as number) || 0;

			// Only return usage if we have actual token counts
			if (inputTokens === 0 && outputTokens === 0) return null;

			return {
				type: "usage",
				usage: {
					input: inputTokens,
					output: outputTokens,
				},
			};
		}

		// Handle step_start events (optional: could log for debugging)
		if (type === "step_start") {
			// We could emit session info here, but it's not critical
			// Just skip for now like Gemini does
			return null;
		}

		// Ignore other event types
		return null;
	}
}
