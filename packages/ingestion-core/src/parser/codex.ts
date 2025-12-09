import type { ParserStrategy, StreamDelta } from "./interface";

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
			const item = p.item as Record<string, unknown> | undefined;
			if (!item) return null;

			const itemType = item.type as string;

			// Agent message - final text content
			if (itemType === "agent_message") {
				return {
					type: "content",
					role: "assistant",
					content: item.text as string,
				};
			}

			// Reasoning - internal thinking
			if (itemType === "reasoning") {
				return {
					type: "thought",
					thought: item.text as string,
				};
			}

			// Command execution - tool call
			if (itemType === "command_execution") {
				const command = item.command as string;
				const output = item.aggregated_output as string;
				const exitCode = item.exit_code as number | null;
				const status = item.status as string;

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
						id: item.id as string,
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
			const item = p.item as Record<string, unknown> | undefined;
			if (!item) return null;

			const itemType = item.type as string;

			// Command execution starting
			if (itemType === "command_execution") {
				return {
					type: "tool_call",
					toolCall: {
						id: item.id as string,
						name: "shell",
						args: JSON.stringify({ command: item.command }),
						index: 0,
					},
				};
			}

			return null;
		}

		// Handle turn.completed events (usage stats)
		if (type === "turn.completed") {
			const usage = p.usage as Record<string, unknown> | undefined;
			if (!usage) return null;

			return {
				type: "usage",
				usage: {
					input: (usage.input_tokens as number) || 0,
					output: (usage.output_tokens as number) || 0,
				},
			};
		}

		// Handle thread.started events (session info)
		if (type === "thread.started") {
			const threadId = p.thread_id as string;
			return {
				type: "content",
				content: `[Thread Started: ${threadId}]`,
			};
		}

		// Handle turn.started events
		if (type === "turn.started") {
			return {
				type: "content",
				content: "[Turn Started]",
			};
		}

		// Ignore other event types
		return null;
	}
}
