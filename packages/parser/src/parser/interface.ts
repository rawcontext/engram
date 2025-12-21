export interface StreamDelta {
	type?: "content" | "thought" | "tool_call" | "usage" | "stop";
	role?: string;
	content?: string;
	thought?: string;
	diff?: string;
	diffFile?: string; // File path associated with diff block
	toolCall?: {
		index?: number;
		id?: string;
		name?: string;
		args?: string; // Partial JSON
	};
	usage?: {
		input?: number;
		output?: number;
		reasoning?: number; // Extended thinking/reasoning tokens
		cacheRead?: number; // Prompt cache reads
		cacheWrite?: number; // Prompt cache writes/creation
		total?: number; // Total tokens (if provided directly)
	};
	cost?: number; // Cost in USD
	timing?: {
		start?: number; // Start timestamp (ms epoch)
		end?: number; // End timestamp (ms epoch)
		duration?: number; // Duration in ms
	};
	session?: {
		id?: string; // Session ID
		messageId?: string; // Message ID within session
		partId?: string; // Part/item ID within message
		threadId?: string; // Thread ID (Codex)
	};
	model?: string; // Model used for this event
	gitSnapshot?: string; // Git commit hash at time of event
	stopReason?: string;
}

export interface ParserStrategy {
	parse(payload: unknown): StreamDelta | null;
}
