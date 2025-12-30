import { z } from "zod";
import type { ParserStrategy, StreamDelta } from "./interface";
import {
	ClaudeCodeAssistantSchema,
	ClaudeCodeResultSchema,
	ClaudeCodeSystemSchema,
	ClaudeCodeToolResultSchema,
	ClaudeCodeToolUseSchema,
} from "./schemas";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Schema for Claude Code hook event payloads.
 * These are sent by the Engram plugin hooks (SessionStart, SessionEnd, PostToolUse, Stop).
 */
export const ClaudeCodeHookInputSchema = z.object({
	session_id: z.string(),
	transcript_path: z.string().optional(),
	cwd: z.string().optional(),
	permission_mode: z.string().optional(),
	hook_event_name: z.string(),
	tool_name: z.string().optional(),
	tool_input: z.unknown().optional(),
	tool_result: z.unknown().optional(),
	tool_use_id: z.string().optional(),
	prompt: z.string().optional(), // UserPromptSubmit
	stop_hook_active: z.boolean().optional(), // Stop
	reason: z.string().optional(), // SessionEnd
	source: z.string().optional(), // SessionStart
});

/**
 * Parser for Claude Code's stream-json output format and hook events.
 *
 * Claude Code stream-json events have these types:
 * - system: { type: "system", subtype: "init"|"hook_response", ... }
 * - assistant: { type: "assistant", message: { content, usage, ... }, ... }
 * - tool_use: { type: "tool_use", tool_use: { tool_use_id, name, input }, ... }
 * - tool_result: { type: "tool_result", tool_result: { tool_use_id, content }, ... }
 * - result: { type: "result", result: string, usage: {...}, ... }
 *
 * Hook events (from Engram plugin) have:
 * - hook_event_name: "SessionStart" | "SessionEnd" | "PostToolUse" | "Stop" | "UserPromptSubmit"
 * - session_id, cwd, tool_name, tool_input, etc.
 */
export class ClaudeCodeParser implements ParserStrategy {
	parse(payload: unknown): StreamDelta | null {
		// Type guard for payload
		if (!isRecord(payload)) {
			return null;
		}

		// Check if this is a hook event (has hook_event_name)
		if ("hook_event_name" in payload) {
			return this.parseHookEvent(payload);
		}

		const type = typeof payload.type === "string" ? payload.type : "";

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

	/**
	 * Parse hook event payloads from Engram plugin.
	 */
	private parseHookEvent(payload: Record<string, unknown>): StreamDelta | null {
		const parseResult = ClaudeCodeHookInputSchema.safeParse(payload);
		if (!parseResult.success) {
			return null;
		}

		const data = parseResult.data;
		const delta: StreamDelta = {
			session: { id: data.session_id },
		};

		switch (data.hook_event_name) {
			case "SessionStart":
				delta.type = "content";
				delta.content = `[Session Started: ${data.source || "startup"}]`;
				if (data.cwd) {
					delta.content += ` cwd=${data.cwd}`;
				}
				break;

			case "SessionEnd":
				delta.type = "stop";
				delta.stopReason = data.reason || "session_end";
				break;

			case "PostToolUse":
				delta.type = "tool_call";
				delta.toolCall = {
					id: data.tool_use_id,
					name: data.tool_name,
					args: data.tool_input ? JSON.stringify(data.tool_input) : undefined,
					index: 0,
				};
				break;

			case "Stop":
				delta.type = "stop";
				delta.stopReason = "agent_stop";
				break;

			case "UserPromptSubmit":
				delta.type = "content";
				delta.role = "user";
				delta.content = data.prompt || "";
				break;

			default:
				// Unknown hook event type
				return null;
		}

		return delta;
	}
}
