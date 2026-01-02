/**
 * CLI integration for running Claude Code with Engram ingestion.
 *
 * Usage:
 *   engram-mcp run-with-ingestion "Your prompt here"
 *   engram-mcp run-with-ingestion -p "Your prompt here" --allowed-tools Read,Write
 */

import type { RawStreamEvent, StreamWrapperOptions } from "./types";
import { ClaudeCodeStreamWrapper } from "./wrapper";

export interface RunWithIngestionOptions extends StreamWrapperOptions {
	/** Ingestion service URL */
	ingestionUrl?: string;
	/** OAuth token for authenticated ingestion */
	authToken?: string;
	/** Whether to log debug output */
	debug?: boolean;
}

/**
 * Run Claude Code with Engram ingestion enabled.
 */
export async function runWithIngestion(options: RunWithIngestionOptions): Promise<void> {
	const ingestionUrl =
		options.ingestionUrl || process.env.ENGRAM_INGESTION_URL || "http://localhost:6175";
	const authToken = options.authToken || process.env.ENGRAM_AUTH_TOKEN;

	const logger = options.debug
		? {
				info: (...args: unknown[]) => console.error("[INFO]", ...args),
				error: (...args: unknown[]) => console.error("[ERROR]", ...args),
			}
		: undefined;

	const onIngest = async (event: RawStreamEvent): Promise<void> => {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			if (authToken) {
				headers.Authorization = `Bearer ${authToken}`;
			}

			const response = await fetch(`${ingestionUrl}/ingest`, {
				method: "POST",
				headers,
				body: JSON.stringify(event),
				signal: AbortSignal.timeout(5000),
			});

			if (!response.ok && options.debug) {
				console.error(`[WARN] Ingestion returned ${response.status}: ${await response.text()}`);
			}
		} catch (err) {
			if (options.debug) {
				console.error(`[WARN] Ingestion failed: ${err}`);
			}
			// Don't throw - ingestion failures should not block execution
		}
	};

	const wrapper = new ClaudeCodeStreamWrapper({ onIngest, logger });

	wrapper.on("error", (err: Error) => {
		console.error(`[ERROR] ${err.message}`);
	});

	wrapper.on("exit", (code: number | null) => {
		if (options.debug) {
			console.error(`\n[INFO] Claude Code exited with code ${code}`);
		}
	});

	try {
		await wrapper.execute({
			prompt: options.prompt,
			cwd: options.cwd,
			allowedTools: options.allowedTools,
			systemPrompt: options.systemPrompt,
			timeout: options.timeout,
			printOutput: options.printOutput,
		});

		// Ensure output ends with newline
		console.log("");
	} catch (err) {
		console.error(`\nError: ${err}`);
		process.exit(1);
	}
}

/**
 * Parse CLI arguments for run-with-ingestion command.
 */
export function parseArgs(args: string[]): RunWithIngestionOptions {
	const options: RunWithIngestionOptions = {
		prompt: "",
		debug: false,
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg === "-p" || arg === "--prompt") {
			options.prompt = args[++i] || "";
		} else if (arg === "--cwd") {
			options.cwd = args[++i];
		} else if (arg === "--allowed-tools") {
			options.allowedTools = (args[++i] || "").split(",").filter(Boolean);
		} else if (arg === "--system-prompt") {
			options.systemPrompt = args[++i];
		} else if (arg === "--timeout") {
			options.timeout = Number.parseInt(args[++i] || "300000", 10);
		} else if (arg === "--ingestion-url") {
			options.ingestionUrl = args[++i];
		} else if (arg === "--auth-token") {
			options.authToken = args[++i];
		} else if (arg === "--debug" || arg === "-d") {
			options.debug = true;
		} else if (arg === "--no-output") {
			options.printOutput = false;
		} else if (!arg.startsWith("-") && !options.prompt) {
			// Positional argument is the prompt
			options.prompt = arg;
		}

		i++;
	}

	return options;
}

/**
 * CLI entry point for run-with-ingestion command.
 */
export async function cli(args: string[]): Promise<void> {
	const options = parseArgs(args);

	if (!options.prompt) {
		console.error("Usage: engram-mcp run-with-ingestion <prompt>");
		console.error("       engram-mcp run-with-ingestion -p <prompt> [options]");
		console.error("");
		console.error("Options:");
		console.error("  -p, --prompt <text>       The prompt to send to Claude");
		console.error("  --cwd <path>              Working directory");
		console.error("  --allowed-tools <tools>   Comma-separated list of allowed tools");
		console.error("  --system-prompt <text>    System prompt");
		console.error("  --timeout <ms>            Timeout in milliseconds (default: 300000)");
		console.error("  --ingestion-url <url>     Ingestion service URL");
		console.error("  --auth-token <token>      OAuth token for authenticated ingestion");
		console.error("  -d, --debug               Enable debug logging");
		console.error("  --no-output               Don't print Claude's output");
		process.exit(1);
	}

	await runWithIngestion(options);
}
