/**
 * Claude Code stream-json wrapper for CI/automation scenarios.
 *
 * Spawns Claude Code in headless mode with stream-json output format,
 * parses NDJSON output, and forwards events for ingestion.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RawStreamEvent, StreamDelta, StreamWrapperOptions } from "./types";

/**
 * Parses Claude Code stream-json events into normalized deltas.
 * Simplified version of ClaudeCodeParser from @engram/parser for
 * standalone use without additional dependencies.
 */
function parseClaudeCodeEvent(payload: Record<string, unknown>): StreamDelta | null {
	const type = typeof payload.type === "string" ? payload.type : "";

	// Handle assistant messages
	if (type === "assistant") {
		const message = payload.message as Record<string, unknown> | undefined;
		if (!message) return null;

		const delta: StreamDelta = {};

		if (message.role === "assistant") {
			delta.role = "assistant";
		}

		const content = message.content as Array<Record<string, unknown>> | undefined;
		if (content && Array.isArray(content)) {
			const textContent = content
				.filter((block) => block.type === "text")
				.map((block) => (block.text as string) || "")
				.join("");

			if (textContent) {
				delta.content = textContent;
				delta.type = "content";
			}

			const toolUseBlocks = content.filter((block) => block.type === "tool_use");
			if (toolUseBlocks.length > 0) {
				const toolBlock = toolUseBlocks[0];
				delta.toolCall = {
					id: toolBlock.id as string | undefined,
					name: toolBlock.name as string | undefined,
					args: JSON.stringify(toolBlock.input),
					index: 0,
				};
				delta.type = "tool_call";
			}
		}

		const usage = message.usage as Record<string, number> | undefined;
		if (usage) {
			delta.usage = {
				input: usage.input_tokens || 0,
				output: usage.output_tokens || 0,
				cacheRead: usage.cache_read_input_tokens || 0,
				cacheWrite: usage.cache_creation_input_tokens || 0,
			};
		}

		if (message.model) {
			delta.model = message.model as string;
		}

		if (message.stop_reason) {
			delta.stopReason = message.stop_reason as string;
		}

		return Object.keys(delta).length > 0 ? delta : null;
	}

	// Handle tool_use events
	if (type === "tool_use") {
		const toolUse = payload.tool_use as Record<string, unknown> | undefined;
		if (!toolUse) return null;

		return {
			type: "tool_call",
			toolCall: {
				id: toolUse.tool_use_id as string | undefined,
				name: toolUse.name as string | undefined,
				args: JSON.stringify(toolUse.input),
				index: 0,
			},
		};
	}

	// Handle result events
	if (type === "result") {
		const delta: StreamDelta = {};

		if (payload.result) {
			delta.type = "stop";
			delta.stopReason = (payload.subtype as string) || "end_turn";
		}

		const usage = payload.usage as Record<string, number> | undefined;
		if (usage) {
			delta.usage = {
				input: usage.input_tokens || 0,
				output: usage.output_tokens || 0,
				cacheRead: usage.cache_read_input_tokens || 0,
				cacheWrite: usage.cache_creation_input_tokens || 0,
			};
			delta.type = "usage";
		}

		if (typeof payload.total_cost_usd === "number") {
			delta.cost = payload.total_cost_usd;
		}

		if (typeof payload.duration_ms === "number" || typeof payload.duration_api_ms === "number") {
			delta.timing = {
				duration:
					(payload.duration_ms as number | undefined) ||
					(payload.duration_api_ms as number | undefined),
			};
		}

		if (payload.session_id) {
			delta.session = { id: payload.session_id as string };
		}

		return Object.keys(delta).length > 0 ? delta : null;
	}

	// Handle system events (init)
	if (type === "system") {
		const subtype = payload.subtype as string | undefined;

		if (subtype === "init") {
			const delta: StreamDelta = {
				type: "content",
				content: `[Session Init] model=${payload.model}, tools=${(payload.tools as string[])?.length || 0}`,
			};

			if (payload.model) {
				delta.model = payload.model as string;
			}

			if (payload.session_id) {
				delta.session = { id: payload.session_id as string };
			}

			return delta;
		}
	}

	return null;
}

export interface ClaudeCodeStreamWrapperOptions {
	/** Function to handle ingestion of events */
	onIngest?: (event: RawStreamEvent) => Promise<void>;
	/** Logger for debug output */
	logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export class ClaudeCodeStreamWrapper extends EventEmitter {
	private process: ChildProcess | null = null;
	private sessionId: string;
	private options: ClaudeCodeStreamWrapperOptions;

	constructor(options: ClaudeCodeStreamWrapperOptions = {}) {
		super();
		this.sessionId = randomUUID();
		this.options = options;
	}

	/**
	 * Execute Claude Code with the given options and stream output.
	 */
	async execute(options: StreamWrapperOptions): Promise<void> {
		const args = ["-p", options.prompt, "--output-format", "stream-json"];

		if (options.allowedTools && options.allowedTools.length > 0) {
			args.push("--allowedTools", options.allowedTools.join(","));
		}

		if (options.systemPrompt) {
			args.push("--system-prompt", options.systemPrompt);
		}

		this.options.logger?.info(`Executing: claude ${args.join(" ")}`);

		this.process = spawn("claude", args, {
			cwd: options.cwd || process.cwd(),
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let buffer = "";
		const printOutput = options.printOutput !== false;

		this.process.stdout?.on("data", async (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.trim()) continue;

				try {
					const payload = JSON.parse(line) as Record<string, unknown>;
					await this.ingestEvent(payload);

					const delta = parseClaudeCodeEvent(payload);
					if (delta) {
						this.emit("event", delta);

						// Print content to stdout for user visibility
						if (printOutput && delta.content && delta.type === "content") {
							process.stdout.write(delta.content);
						}
					}
				} catch (err) {
					this.emit("error", new Error(`Parse error: ${err}`));
				}
			}
		});

		this.process.stderr?.on("data", (chunk: Buffer) => {
			const message = chunk.toString();
			this.emit("stderr", message);
			this.options.logger?.error(`stderr: ${message}`);
		});

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.process?.kill("SIGTERM");
				reject(new Error(`Timeout after ${options.timeout || 300000}ms`));
			}, options.timeout || 300000);

			this.process?.on("close", (code) => {
				clearTimeout(timeout);
				this.emit("exit", code);
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Claude Code exited with code ${code}`));
				}
			});

			this.process?.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	}

	/**
	 * Ingest an event by wrapping it in RawStreamEvent envelope and forwarding.
	 */
	private async ingestEvent(payload: Record<string, unknown>): Promise<void> {
		// Extract session ID from payload if available
		const sessionIdFromPayload =
			(payload.session_id as string | undefined) ||
			((payload.message as Record<string, unknown> | undefined)?.session_id as string | undefined);

		if (sessionIdFromPayload) {
			this.sessionId = sessionIdFromPayload;
		}

		const event: RawStreamEvent = {
			event_id: randomUUID(),
			ingest_timestamp: new Date().toISOString(),
			provider: "claude_code",
			payload,
			headers: {
				"x-session-id": this.sessionId,
				"x-source": "stream-json",
			},
		};

		if (this.options.onIngest) {
			try {
				await this.options.onIngest(event);
			} catch (err) {
				this.options.logger?.error(`Ingestion failed: ${err}`);
			}
		}

		this.emit("ingest", event);
	}

	/**
	 * Kill the running process.
	 */
	kill(): void {
		this.process?.kill("SIGTERM");
	}

	/**
	 * Get the current session ID.
	 */
	getSessionId(): string {
		return this.sessionId;
	}
}
