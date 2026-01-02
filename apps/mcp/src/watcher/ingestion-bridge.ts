/**
 * Bridges file watcher to ingestion service.
 * Transforms history entries to RawStreamEvent and handles deduplication.
 */

import { ClaudeJSONLWatcher, type ClaudeJSONLWatcherOptions } from "./jsonl-watcher";
import type { ClaudeHistoryEntry } from "./types";

/**
 * RawStreamEvent structure for ingestion.
 */
interface RawStreamEvent {
	event_id: string;
	ingest_timestamp: string;
	provider: "claude_code";
	payload: Record<string, unknown>;
	headers?: Record<string, string>;
}

export interface WatcherIngestionBridgeOptions extends ClaudeJSONLWatcherOptions {
	/** Ingestion service URL */
	ingestionUrl?: string;
	/** OAuth token for authenticated ingestion */
	authToken?: string;
	/** Deduplication window in milliseconds (default: 60000) */
	dedupWindowMs?: number;
	/** Logger */
	logger?: {
		info: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
		debug: (...args: unknown[]) => void;
	};
}

export class WatcherIngestionBridge {
	private watcher: ClaudeJSONLWatcher;
	private ingestionUrl: string;
	private authToken?: string;
	private dedupWindowMs: number;
	private deduplicationWindow: Map<string, number> = new Map();
	private logger?: WatcherIngestionBridgeOptions["logger"];

	constructor(options: WatcherIngestionBridgeOptions = {}) {
		this.watcher = new ClaudeJSONLWatcher(options);
		this.ingestionUrl =
			options.ingestionUrl || process.env.ENGRAM_INGESTION_URL || "http://localhost:6175";
		this.authToken = options.authToken || process.env.ENGRAM_AUTH_TOKEN;
		this.dedupWindowMs = options.dedupWindowMs || 60000; // 1 minute
		this.logger = options.logger;
	}

	/**
	 * Start the bridge.
	 */
	async start(): Promise<void> {
		this.watcher.on("entry", async (entry: ClaudeHistoryEntry) => {
			await this.handleEntry(entry);
		});

		this.watcher.on("error", (err: Error) => {
			this.logger?.error("Watcher error:", err);
		});

		this.watcher.on("warn", (message: string) => {
			this.logger?.info("Watcher warning:", message);
		});

		this.watcher.on("rotated", () => {
			this.logger?.debug("File rotated, resetting position");
		});

		this.watcher.on("started", (info) => {
			this.logger?.info(`Watcher started: ${info.filepath} at position ${info.position}`);
		});

		await this.watcher.start();
	}

	/**
	 * Stop the bridge.
	 */
	async stop(): Promise<void> {
		await this.watcher.stop();
	}

	/**
	 * Handle a history entry.
	 */
	private async handleEntry(entry: ClaudeHistoryEntry): Promise<void> {
		// Check if we've seen this event recently (from hooks)
		const dedupKey = `${entry.sessionId || "no-session"}:${entry.timestamp}`;
		const lastSeen = this.deduplicationWindow.get(dedupKey);

		if (lastSeen && Date.now() - lastSeen < this.dedupWindowMs) {
			this.logger?.debug(`Skipping duplicate event: ${dedupKey}`);
			return; // Skip, likely duplicate from hooks
		}

		this.deduplicationWindow.set(dedupKey, Date.now());
		this.cleanupDeduplicationWindow();

		// Transform to RawStreamEvent
		const event: RawStreamEvent = {
			event_id: crypto.randomUUID(),
			ingest_timestamp: new Date().toISOString(),
			provider: "claude_code",
			payload: {
				type: "user",
				content: entry.display,
				pasted_contents: entry.pastedContents,
				timestamp: entry.timestamp,
			},
			headers: {
				"x-session-id": entry.sessionId || `file-${entry.timestamp}`,
				"x-working-dir": entry.project,
				"x-source": "file-watcher",
			},
		};

		await this.ingestEvent(event);
	}

	/**
	 * Send event to ingestion service.
	 */
	private async ingestEvent(event: RawStreamEvent): Promise<void> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			if (this.authToken) {
				headers.Authorization = `Bearer ${this.authToken}`;
			}

			const response = await fetch(`${this.ingestionUrl}/ingest`, {
				method: "POST",
				headers,
				body: JSON.stringify(event),
				signal: AbortSignal.timeout(5000),
			});

			if (!response.ok) {
				this.logger?.error(`Ingestion returned ${response.status}: ${await response.text()}`);
			} else {
				this.logger?.debug(`Ingested event ${event.event_id}`);
			}
		} catch (err) {
			this.logger?.error(`Ingestion failed: ${err}`);
			// Don't throw - ingestion failures should not crash the watcher
		}
	}

	/**
	 * Clean up old entries from deduplication window.
	 */
	private cleanupDeduplicationWindow(): void {
		const now = Date.now();
		for (const [key, timestamp] of this.deduplicationWindow) {
			if (now - timestamp > this.dedupWindowMs) {
				this.deduplicationWindow.delete(key);
			}
		}
	}

	/**
	 * Get watcher statistics.
	 */
	getStats(): { position: number; seenHashes: number; dedupEntries: number } {
		return {
			position: this.watcher.getPosition(),
			seenHashes: this.watcher.getSeenHashCount(),
			dedupEntries: this.deduplicationWindow.size,
		};
	}
}
