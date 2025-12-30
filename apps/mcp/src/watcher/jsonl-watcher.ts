/**
 * Watches Claude Code's ~/.claude/history.jsonl for interactive session capture.
 * Provides fallback coverage when hooks aren't configured.
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { watch } from "chokidar";
import type { ClaudeHistoryEntry } from "./types";

/**
 * FNV-1a hash for content deduplication.
 * Fast, non-cryptographic hash suitable for dedup.
 */
function fnv1aHash(content: string): string {
	let hash = 2166136261;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash.toString(16);
}

export interface ClaudeJSONLWatcherOptions {
	/** Path to history.jsonl file (default: ~/.claude/history.jsonl) */
	filepath?: string;
	/** Maximum number of seen hashes to track (default: 10000) */
	maxSeenHashes?: number;
	/** Whether to start from beginning of file (default: false, start from end) */
	fromBeginning?: boolean;
}

export class ClaudeJSONLWatcher extends EventEmitter {
	private filepath: string;
	private position = 0;
	private inode: number | null = null;
	private watcher: ReturnType<typeof watch> | null = null;
	private seenHashes: Set<string> = new Set();
	private maxSeenHashes: number;
	private fromBeginning: boolean;
	private isProcessing = false;

	constructor(options: ClaudeJSONLWatcherOptions = {}) {
		super();
		this.filepath = options.filepath || path.join(os.homedir(), ".claude", "history.jsonl");
		this.maxSeenHashes = options.maxSeenHashes || 10000;
		this.fromBeginning = options.fromBeginning || false;
	}

	/**
	 * Start watching the history file.
	 */
	async start(): Promise<void> {
		// Check if file exists
		if (!fs.existsSync(this.filepath)) {
			this.emit("warn", `File not found: ${this.filepath}`);
			// Still set up watcher in case file is created later
		} else {
			// Get initial position
			const stats = await fs.promises.stat(this.filepath);
			this.position = this.fromBeginning ? 0 : stats.size;
			this.inode = stats.ino;
		}

		this.watcher = watch(this.filepath, {
			persistent: true,
			usePolling: false,
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100,
			},
			alwaysStat: true,
		});

		this.watcher.on("change", async (_path, stats) => {
			if (stats && stats.ino !== this.inode) {
				// File rotated (different inode)
				this.position = 0;
				this.inode = stats.ino;
				this.emit("rotated");
			}

			await this.processNewLines();
		});

		this.watcher.on("add", async (_path, stats) => {
			// File was created
			if (stats) {
				this.inode = stats.ino;
				this.position = 0;
			}
			await this.processNewLines();
		});

		this.watcher.on("error", (error) => {
			this.emit("error", error);
		});

		this.emit("started", { filepath: this.filepath, position: this.position });
	}

	/**
	 * Stop watching.
	 */
	async stop(): Promise<void> {
		await this.watcher?.close();
		this.watcher = null;
	}

	/**
	 * Process new lines added to the file.
	 */
	private async processNewLines(): Promise<void> {
		// Prevent concurrent processing
		if (this.isProcessing) return;
		this.isProcessing = true;

		try {
			if (!fs.existsSync(this.filepath)) {
				return;
			}

			const stats = await fs.promises.stat(this.filepath);
			if (stats.size <= this.position) {
				// No new data
				return;
			}

			const stream = fs.createReadStream(this.filepath, {
				start: this.position,
				encoding: "utf8",
			});

			const rl = readline.createInterface({
				input: stream,
				crlfDelay: Number.POSITIVE_INFINITY,
			});

			let bytesRead = 0;

			for await (const line of rl) {
				bytesRead += Buffer.byteLength(line, "utf8") + 1; // +1 for newline

				if (!line.trim()) continue;

				try {
					const entry = JSON.parse(line) as ClaudeHistoryEntry;

					// Deduplication via content hash
					const hash = this.computeHash(entry);
					if (this.seenHashes.has(hash)) {
						continue; // Skip duplicate
					}

					this.seenHashes.add(hash);
					this.pruneSeenHashes();

					this.emit("entry", entry);
				} catch (err) {
					this.emit("parseError", { line, error: err as Error });
				}
			}

			this.position += bytesRead;
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Compute hash for deduplication.
	 */
	private computeHash(entry: ClaudeHistoryEntry): string {
		// Hash based on content + timestamp + project for dedup
		const content = `${entry.display}:${entry.timestamp}:${entry.project}`;
		return fnv1aHash(content);
	}

	/**
	 * Prune old hashes to prevent memory growth.
	 */
	private pruneSeenHashes(): void {
		if (this.seenHashes.size > this.maxSeenHashes) {
			// Remove oldest half
			const entries = Array.from(this.seenHashes);
			this.seenHashes = new Set(entries.slice(entries.length / 2));
		}
	}

	/**
	 * Get current file position.
	 */
	getPosition(): number {
		return this.position;
	}

	/**
	 * Get number of tracked hashes.
	 */
	getSeenHashCount(): number {
		return this.seenHashes.size;
	}
}
