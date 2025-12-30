/**
 * Types for Claude Code history.jsonl file watcher.
 */

/**
 * Entry in Claude Code's ~/.claude/history.jsonl file.
 */
export interface ClaudeHistoryEntry {
	/** Display text shown to the user */
	display: string;
	/** Pasted content attached to the message */
	pastedContents?: Record<
		string,
		{
			id: number;
			type: string;
			content: string;
		}
	>;
	/** Timestamp of the entry (Unix epoch milliseconds) */
	timestamp: number;
	/** Project/working directory */
	project: string;
	/** Optional session ID if available */
	sessionId?: string;
}

export interface WatcherEvents {
	/** Emitted when a new history entry is detected */
	entry: (entry: ClaudeHistoryEntry) => void;
	/** Emitted when the file is rotated */
	rotated: () => void;
	/** Emitted when watcher starts */
	started: (info: { filepath: string; position: number }) => void;
	/** Emitted on parse errors */
	parseError: (info: { line: string; error: Error }) => void;
	/** Emitted on general errors */
	error: (error: Error) => void;
	/** Emitted on warnings */
	warn: (message: string) => void;
}
