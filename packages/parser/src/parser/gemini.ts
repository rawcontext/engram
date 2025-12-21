import type { ParserStrategy, StreamDelta } from "./interface";
import {
	GeminiInitSchema,
	GeminiMessageSchema,
	GeminiResultSchema,
	GeminiToolResultSchema,
	GeminiToolUseSchema,
} from "./schemas";

/**
 * Parser for Google Gemini CLI's `--output-format stream-json` output.
 *
 * Gemini CLI stream-json events have these types:
 * - init: { type: "init", timestamp, session_id, model }
 * - message: { type: "message", timestamp, role: "user"|"assistant", content, delta?: boolean }
 * - tool_use: { type: "tool_use", timestamp, tool_name, tool_id, parameters }
 * - tool_result: { type: "tool_result", timestamp, tool_id, status, output }
 * - result: { type: "result", timestamp, status, stats: { total_tokens, input_tokens, output_tokens, duration_ms, tool_calls } }
 */
export class GeminiParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		// Type guard for payload
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			return null;
		}

		const p = payload as Record<string, unknown>;
		const type = typeof p.type === "string" ? p.type : "";

		// Handle init events (session initialization)
		if (type === "init") {
			const parseResult = GeminiInitSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const sessionId = data.session_id;
			const model = data.model;

			const delta: StreamDelta = {
				type: "content",
				content: `[Session Init] model=${model}, session_id=${sessionId}`,
			};

			if (model) {
				delta.model = model;
			}

			if (sessionId) {
				delta.session = { id: sessionId };
			}

			return delta;
		}

		// Handle message events (user or assistant content)
		if (type === "message") {
			const parseResult = GeminiMessageSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const role = data.role;
			const content = data.content;

			if (!content) return null;

			// User messages - we could skip these or include them
			if (role === "user") {
				return null; // Skip user messages (they're input, not output)
			}

			// Assistant messages
			if (role === "assistant") {
				return {
					type: "content",
					role: "assistant",
					content,
				};
			}

			return null;
		}

		// Handle tool_use events (tool invocation)
		if (type === "tool_use") {
			const parseResult = GeminiToolUseSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;

			return {
				type: "tool_call",
				toolCall: {
					id: data.tool_id,
					name: data.tool_name,
					args: data.parameters ? JSON.stringify(data.parameters) : "{}",
					index: 0,
				},
			};
		}

		// Handle tool_result events (tool execution results)
		if (type === "tool_result") {
			const parseResult = GeminiToolResultSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;

			if (!data.output) return null;

			return {
				type: "content",
				content: `[Tool Result: ${data.tool_id}] (${data.status})\n${data.output}`,
			};
		}

		// Handle result events (final stats/completion)
		if (type === "result") {
			const parseResult = GeminiResultSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const stats = data.stats;
			if (!stats) return null;

			const delta: StreamDelta = {
				type: "usage",
				usage: {
					input: stats.input_tokens || 0,
					output: stats.output_tokens || 0,
					total: stats.total_tokens || 0,
				},
			};

			// Extract timing from stats.duration_ms
			if (stats.duration_ms !== undefined) {
				delta.timing = { duration: stats.duration_ms };
			}

			// Extract status as stop reason
			if (data.status) {
				delta.stopReason = data.status;
			}

			return delta;
		}

		// Ignore other event types
		return null;
	}
}
