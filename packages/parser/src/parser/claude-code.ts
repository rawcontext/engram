import type { ParserStrategy, StreamDelta } from "./interface";
import {
	ClaudeCodeAssistantSchema,
	ClaudeCodeResultSchema,
	ClaudeCodeSystemSchema,
	ClaudeCodeToolResultSchema,
	ClaudeCodeToolUseSchema,
} from "./schemas";

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
			const parseResult = ClaudeCodeAssistantSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const message = parseResult.data.message;
			if (!message) return null;

			const delta: StreamDelta = {};

			// Set role if present
			if (message.role) {
				delta.role = message.role;
			}

			// Extract text content from content blocks
			const content = message.content;
			if (content && Array.isArray(content)) {
				const textContent = content
					.filter((block) => block.type === "text")
					.map((block) => block.text || "")
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
						id: toolBlock.id,
						name: toolBlock.name,
						args: JSON.stringify(toolBlock.input),
						index: 0,
					};
					delta.type = "tool_call";
				}
			}

			// Extract usage info with cache metrics
			const usage = message.usage;
			if (usage) {
				delta.usage = {
					input: usage.input_tokens || 0,
					output: usage.output_tokens || 0,
					cacheRead: usage.cache_read_input_tokens || 0,
					cacheWrite: usage.cache_creation_input_tokens || 0,
				};
			}

			// Extract model from the message
			if (message.model) {
				delta.model = message.model;
			}

			// Extract stop reason
			if (message.stop_reason) {
				delta.stopReason = message.stop_reason;
			}

			return Object.keys(delta).length > 0 ? delta : null;
		}

		// Handle tool_use events
		if (type === "tool_use") {
			const parseResult = ClaudeCodeToolUseSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const toolUse = parseResult.data.tool_use;
			if (!toolUse) return null;

			return {
				type: "tool_call",
				toolCall: {
					id: toolUse.tool_use_id,
					name: toolUse.name,
					args: JSON.stringify(toolUse.input),
					index: 0,
				},
			};
		}

		// Handle tool_result events
		if (type === "tool_result") {
			const parseResult = ClaudeCodeToolResultSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const toolResult = parseResult.data.tool_result;
			if (!toolResult) return null;

			// Tool results contain the output - treat as content
			const resultContent = toolResult.content;
			if (resultContent) {
				return {
					type: "content",
					content: `[Tool Result: ${toolResult.tool_use_id}]\n${resultContent}`,
				};
			}
			return null;
		}

		// Handle result events (final summary with cost, duration, session)
		if (type === "result") {
			const parseResult = ClaudeCodeResultSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;

			const delta: StreamDelta = {};

			if (data.result) {
				delta.type = "stop";
				delta.stopReason = data.subtype || "end_turn";
			}

			if (data.usage) {
				delta.usage = {
					input: data.usage.input_tokens || 0,
					output: data.usage.output_tokens || 0,
					cacheRead: data.usage.cache_read_input_tokens || 0,
					cacheWrite: data.usage.cache_creation_input_tokens || 0,
				};
				delta.type = "usage";
			}

			// Extract cost
			if (data.total_cost_usd !== undefined) {
				delta.cost = data.total_cost_usd;
			}

			// Extract timing
			if (data.duration_ms !== undefined || data.duration_api_ms !== undefined) {
				delta.timing = {
					duration: data.duration_ms || data.duration_api_ms,
				};
			}

			// Extract session ID
			if (data.session_id) {
				delta.session = { id: data.session_id };
			}

			return Object.keys(delta).length > 0 ? delta : null;
		}

		// Handle system events (init, hook_response)
		if (type === "system") {
			const parseResult = ClaudeCodeSystemSchema.safeParse(payload);
			if (!parseResult.success) {
				return null;
			}
			const data = parseResult.data;
			const subtype = data.subtype;

			// Init events contain metadata about the session
			if (subtype === "init") {
				const delta: StreamDelta = {
					type: "content",
					content: `[Session Init] model=${data.model}, tools=${data.tools?.length || 0}`,
				};

				if (data.model) {
					delta.model = data.model;
				}

				if (data.session_id) {
					delta.session = { id: data.session_id };
				}

				return delta;
			}

			// Hook responses contain hook output
			if (subtype === "hook_response") {
				const stdout = data.stdout;
				if (stdout) {
					return {
						type: "content",
						content: `[Hook: ${data.hook_name}] ${stdout.slice(0, 200)}...`,
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
