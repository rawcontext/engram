import type { ParserStrategy, StreamDelta } from "./interface";
import {
	OpenCodeStepFinishEventSchema,
	OpenCodeStepStartEventSchema,
	OpenCodeTextEventSchema,
	OpenCodeToolUseEventSchema,
} from "./schemas";

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
			const parseResult = OpenCodeTextEventSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const part = data.part;
			if (!part) return null;

			const text = part.text;
			if (!text) return null;

			const delta: StreamDelta = {
				type: "content",
				role: "assistant",
				content: text,
			};

			// Extract timing from part.time
			const time = part.time;
			if (time) {
				delta.timing = {
					start: time.start,
					end: time.end,
				};
			}

			// Extract session info
			const sessionID = data.sessionID;
			const messageID = part.messageID || undefined;
			const partId = part.id;
			if (sessionID || messageID || partId) {
				delta.session = {
					id: sessionID,
					messageId: messageID,
					partId: partId,
				};
			}

			return delta;
		}

		// Handle tool_use events
		if (type === "tool_use") {
			const parseResult = OpenCodeToolUseEventSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const part = data.part;
			if (!part) return null;

			const callID = part.callID;
			const tool = part.tool;
			const state = part.state;

			// Extract input parameters from state
			const input = state?.input;

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

		// Handle step_finish events with token usage, cost, git snapshot
		if (type === "step_finish") {
			const parseResult = OpenCodeStepFinishEventSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const part = data.part;
			if (!part) return null;

			const tokens = part.tokens;
			if (!tokens) return null;

			const inputTokens = tokens.input || 0;
			const outputTokens = tokens.output || 0;

			// Only return usage if we have actual token counts
			if (inputTokens === 0 && outputTokens === 0) return null;

			const cache = tokens.cache;
			const delta: StreamDelta = {
				type: "usage",
				usage: {
					input: inputTokens,
					output: outputTokens,
					reasoning: tokens.reasoning || 0,
					cacheRead: cache?.read,
					cacheWrite: cache?.write,
				},
			};

			// Extract cost
			if (part.cost !== undefined) {
				delta.cost = part.cost;
			}

			// Extract git snapshot
			if (part.snapshot) {
				delta.gitSnapshot = part.snapshot;
			}

			// Extract stop reason
			if (part.reason) {
				delta.stopReason = part.reason;
			}

			// Extract session info
			const sessionID = data.sessionID;
			const messageID = part.messageID || undefined;
			const partId = part.id;
			if (sessionID || messageID || partId) {
				delta.session = {
					id: sessionID,
					messageId: messageID,
					partId: partId,
				};
			}

			return delta;
		}

		// Handle step_start events (optional: could log for debugging)
		if (type === "step_start") {
			const parseResult = OpenCodeStepStartEventSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			// We could emit session info here, but it's not critical
			// Just skip for now like Gemini does
			return null;
		}

		// Ignore other event types
		return null;
	}
}
