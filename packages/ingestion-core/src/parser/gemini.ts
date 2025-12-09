import type { ParserStrategy, StreamDelta } from "./interface";

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
		const p = payload as Record<string, unknown>;
		const type = p.type as string;

		// Handle init events (session initialization)
		if (type === "init") {
			const sessionId = p.session_id as string;
			const model = p.model as string;
			return {
				type: "content",
				content: `[Session Init] model=${model}, session_id=${sessionId}`,
			};
		}

		// Handle message events (user or assistant content)
		if (type === "message") {
			const role = p.role as string;
			const content = p.content as string;

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
			const toolName = p.tool_name as string;
			const toolId = p.tool_id as string;
			const parameters = p.parameters as Record<string, unknown> | undefined;

			return {
				type: "tool_call",
				toolCall: {
					id: toolId,
					name: toolName,
					args: parameters ? JSON.stringify(parameters) : "{}",
					index: 0,
				},
			};
		}

		// Handle tool_result events (tool execution results)
		if (type === "tool_result") {
			const toolId = p.tool_id as string;
			const status = p.status as string;
			const output = p.output as string;

			if (!output) return null;

			return {
				type: "content",
				content: `[Tool Result: ${toolId}] (${status})\n${output}`,
			};
		}

		// Handle result events (final stats/completion)
		if (type === "result") {
			const stats = p.stats as Record<string, unknown> | undefined;
			if (!stats) return null;

			return {
				type: "usage",
				usage: {
					input: (stats.input_tokens as number) || 0,
					output: (stats.output_tokens as number) || 0,
				},
			};
		}

		// Ignore other event types
		return null;
	}
}
