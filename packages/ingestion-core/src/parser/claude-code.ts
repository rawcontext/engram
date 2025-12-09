import type { ParserStrategy, StreamDelta } from "./interface";

/**
 * Parser for Claude Code's stream-json output format.
 *
 * Claude Code stream-json events have these types:
 * - system: { type: "system", subtype: "init"|"hook_response", ... }
 * - assistant: { type: "assistant", message: { content, usage, ... }, ... }
 * - tool_use: { type: "tool_use", tool_use: { tool_use_id, name, input }, ... }
 * - tool_result: { type: "tool_result", tool_result: { tool_use_id, content }, ... }
 * - result: { type: "result", result: string, usage: {...}, ... }
 */
export class ClaudeCodeParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		const p = payload as Record<string, unknown>;
		const type = p.type as string;

		// Handle assistant messages with content
		if (type === "assistant") {
			const message = p.message as Record<string, unknown> | undefined;
			if (!message) return null;

			const role = message.role as string | undefined;
			const content = message.content as Array<Record<string, unknown>> | undefined;
			const usage = message.usage as Record<string, unknown> | undefined;

			const delta: StreamDelta = {};

			// Set role if present
			if (role) {
				delta.role = role;
			}

			// Extract text content from content blocks
			if (content && Array.isArray(content)) {
				const textContent = content
					.filter((block) => block.type === "text")
					.map((block) => block.text as string)
					.join("");

				if (textContent) {
					delta.content = textContent;
					delta.type = "content";
				}

				// Check for tool_use blocks in the content array
				const toolUseBlocks = content.filter((block) => block.type === "tool_use");
				if (toolUseBlocks.length > 0) {
					const toolBlock = toolUseBlocks[0];
					delta.toolCall = {
						id: toolBlock.id as string,
						name: toolBlock.name as string,
						args: JSON.stringify(toolBlock.input),
						index: 0,
					};
					delta.type = "tool_call";
				}
			}

			// Extract usage info
			if (usage) {
				delta.usage = {
					input: (usage.input_tokens as number) || 0,
					output: (usage.output_tokens as number) || 0,
				};
			}

			// Extract stop reason
			if (message.stop_reason) {
				delta.stopReason = message.stop_reason as string;
			}

			return Object.keys(delta).length > 0 ? delta : null;
		}

		// Handle tool_use events
		if (type === "tool_use") {
			const toolUse = p.tool_use as Record<string, unknown> | undefined;
			if (!toolUse) return null;

			return {
				type: "tool_call",
				toolCall: {
					id: toolUse.tool_use_id as string,
					name: toolUse.name as string,
					args: JSON.stringify(toolUse.input),
					index: 0,
				},
			};
		}

		// Handle tool_result events
		if (type === "tool_result") {
			const toolResult = p.tool_result as Record<string, unknown> | undefined;
			if (!toolResult) return null;

			// Tool results contain the output - treat as content
			const resultContent = toolResult.content as string | undefined;
			if (resultContent) {
				return {
					type: "content",
					content: `[Tool Result: ${toolResult.tool_use_id}]\n${resultContent}`,
				};
			}
			return null;
		}

		// Handle result events (final summary)
		if (type === "result") {
			const result = p.result as string | undefined;
			const usage = p.usage as Record<string, unknown> | undefined;

			const delta: StreamDelta = {};

			if (result) {
				delta.type = "stop";
				delta.stopReason = (p.subtype as string) || "end_turn";
			}

			if (usage) {
				delta.usage = {
					input: (usage.input_tokens as number) || 0,
					output: (usage.output_tokens as number) || 0,
				};
				delta.type = "usage";
			}

			return Object.keys(delta).length > 0 ? delta : null;
		}

		// Handle system events (init, hook_response)
		if (type === "system") {
			const subtype = p.subtype as string | undefined;

			// Init events contain metadata about the session
			if (subtype === "init") {
				return {
					type: "content",
					content: `[Session Init] model=${p.model}, tools=${(p.tools as string[])?.length || 0}`,
				};
			}

			// Hook responses contain hook output
			if (subtype === "hook_response") {
				const stdout = p.stdout as string | undefined;
				if (stdout) {
					return {
						type: "content",
						content: `[Hook: ${p.hook_name}] ${stdout.slice(0, 200)}...`,
					};
				}
			}

			// Other system events (user messages, etc.)
			return null;
		}

		// Ignore other event types
		return null;
	}
}
