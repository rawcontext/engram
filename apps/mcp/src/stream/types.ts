/**
 * Types for Claude Code stream-json wrapper.
 * Used for CI/automation scenarios where we capture full streaming output.
 */

export interface StreamWrapperOptions {
	/** The prompt to send to Claude */
	prompt: string;
	/** Working directory for Claude Code execution */
	cwd?: string;
	/** List of allowed tools */
	allowedTools?: string[];
	/** System prompt to use */
	systemPrompt?: string;
	/** Timeout in milliseconds (default: 5 minutes) */
	timeout?: number;
	/** Whether to print output to stdout (default: true) */
	printOutput?: boolean;
}

export interface StreamWrapperEvents {
	/** Emitted when a parsed event is available */
	event: (delta: StreamDelta) => void;
	/** Emitted on stderr output from Claude Code */
	stderr: (message: string) => void;
	/** Emitted on parsing or processing errors */
	error: (error: Error) => void;
	/** Emitted when the process exits */
	exit: (code: number | null) => void;
}

export interface StreamDelta {
	type?: "content" | "tool_call" | "usage" | "stop";
	role?: "user" | "assistant" | "system";
	content?: string;
	toolCall?: {
		id?: string;
		name?: string;
		args?: string;
		index?: number;
	};
	usage?: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	session?: { id: string };
	model?: string;
	stopReason?: string;
	cost?: number;
	timing?: { duration?: number };
}

export interface RawStreamEvent {
	event_id: string;
	ingest_timestamp: string;
	provider: "claude_code";
	payload: Record<string, unknown>;
	headers?: Record<string, string>;
}
