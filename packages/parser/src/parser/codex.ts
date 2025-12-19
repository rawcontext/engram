import type { ParserStrategy, StreamDelta } from "./interface";
import {
	CodexItemCompletedSchema,
	CodexItemStartedSchema,
	CodexThreadStartedSchema,
	CodexTurnCompletedSchema,
	CodexTurnStartedSchema,
} from "./schemas";

/**
 * Parser for OpenAI Codex CLI's `--json` output format.
 *
 * Codex CLI JSON events have these types:
 * - thread.started: { type: "thread.started", thread_id: string }
 * - turn.started: { type: "turn.started" }
 * - item.started: { type: "item.started", item: {...} }
 * - item.completed: { type: "item.completed", item: {...} }
 * - turn.completed: { type: "turn.completed", usage: {...} }
 *
 * Item types:
 * - reasoning: { id, type: "reasoning", text: string }
 * - command_execution: { id, type: "command_execution", command, aggregated_output, exit_code, status }
 * - agent_message: { id, type: "agent_message", text: string }
 */
export class CodexParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		const p = payload as Record<string, unknown>;
		const type = p.type as string;

		// Handle item.completed events (main content events)
		if (type === "item.completed") {
			const parseResult = CodexItemCompletedSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const item = parseResult.data.item;
			if (!item) return null;

			const itemType = item.type;

			// Agent message - final text content
			if (itemType === "agent_message") {
				return {
					type: "content",
					role: "assistant",
					content: item.text,
				};
			}

			// Reasoning - internal thinking
			if (itemType === "reasoning") {
				return {
					type: "thought",
					thought: item.text,
				};
			}

			// Command execution - tool call
			if (itemType === "command_execution") {
				const command = item.command;
				const output = item.aggregated_output;
				const exitCode = item.exit_code;
				const status = item.status;

				// For completed commands, return the result
				if (status === "completed") {
					return {
						type: "content",
						content: `[Command: ${command}]\nExit: ${exitCode}\n${output}`,
					};
				}

				// For in-progress commands (shouldn't happen in item.completed)
				return {
					type: "tool_call",
					toolCall: {
						id: item.id,
						name: "shell",
						args: JSON.stringify({ command }),
						index: 0,
					},
				};
			}

			return null;
		}

		// Handle item.started events (for streaming/in-progress state)
		if (type === "item.started") {
			const parseResult = CodexItemStartedSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const item = parseResult.data.item;
			if (!item) return null;

			const itemType = item.type;

			// Command execution starting
			if (itemType === "command_execution") {
				return {
					type: "tool_call",
					toolCall: {
						id: item.id,
						name: "shell",
						args: JSON.stringify({ command: item.command }),
						index: 0,
					},
				};
			}

			return null;
		}

		// Handle turn.completed events (usage stats with cached tokens)
		if (type === "turn.completed") {
			const parseResult = CodexTurnCompletedSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const usage = parseResult.data.usage;
			if (!usage) return null;

			return {
				type: "usage",
				usage: {
					input: usage.input_tokens || 0,
					output: usage.output_tokens || 0,
					cacheRead: usage.cached_input_tokens || 0,
				},
			};
		}

		// Handle thread.started events (session info)
		if (type === "thread.started") {
			const parseResult = CodexThreadStartedSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const threadId = parseResult.data.thread_id;
			return {
				type: "content",
				content: `[Thread Started: ${threadId}]`,
				session: { threadId },
			};
		}

		// Handle turn.started events
		if (type === "turn.started") {
			const parseResult = CodexTurnStartedSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			return {
				type: "content",
				content: "[Turn Started]",
			};
		}

		// Ignore other event types
		return null;
	}
}
