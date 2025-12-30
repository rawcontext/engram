/**
 * Multi-layer deduplication engine for Claude Code events.
 *
 * Handles events arriving from multiple sources (hooks, stream-json, file-watcher)
 * and ensures each unique event is only ingested once.
 */

/**
 * Source priority for deduplication.
 * Higher priority sources "win" when the same content arrives from multiple sources.
 */
export type EventSource = "stream-json" | "hook" | "file-watcher";

const SOURCE_PRIORITY: Record<EventSource, number> = {
	"stream-json": 3, // Highest - full context
	hook: 2, // Rich metadata, tool inputs/outputs
	"file-watcher": 1, // Lowest - user prompts only
};

export interface DeduplicationKey {
	sessionId: string;
	timestamp: number;
	contentHash: string;
	source: EventSource;
}

interface SeenEntry {
	timestamp: number;
	sources: Set<EventSource>;
	highestPriority: number;
}

export interface DeduplicationEngineOptions {
	/** Time-to-live for dedup entries in milliseconds (default: 5 minutes) */
	ttlMs?: number;
	/** Maximum number of entries to track (default: 50000) */
	maxEntries?: number;
	/** Cleanup interval in milliseconds (default: 60 seconds) */
	cleanupIntervalMs?: number;
}

/**
 * FNV-1a hash for content deduplication.
 */
export function fnv1aHash(content: string): string {
	let hash = 2166136261;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash.toString(16);
}

/**
 * Compute content hash from event payload.
 */
export function computeEventHash(payload: Record<string, unknown>): string {
	// Create a deterministic representation of key fields
	const parts: string[] = [];

	// Include type
	if (payload.type) {
		parts.push(`type:${payload.type}`);
	}

	// Include content if present
	if (payload.content) {
		parts.push(`content:${String(payload.content).slice(0, 500)}`);
	}

	// Include tool info if present
	const toolUse = payload.tool_use as Record<string, unknown> | undefined;
	if (payload.tool_name || toolUse?.name) {
		const toolName = (payload.tool_name as string) || toolUse?.name;
		parts.push(`tool:${toolName}`);
	}

	// Include session if present
	if (payload.session_id) {
		parts.push(`session:${payload.session_id}`);
	}

	return fnv1aHash(parts.join("|"));
}

export class DeduplicationEngine {
	private seen: Map<string, SeenEntry> = new Map();
	private ttlMs: number;
	private maxEntries: number;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(options: DeduplicationEngineOptions = {}) {
		this.ttlMs = options.ttlMs ?? 300000; // 5 minutes
		this.maxEntries = options.maxEntries ?? 50000;

		// Start cleanup timer
		const cleanupInterval = options.cleanupIntervalMs ?? 60000;
		this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
	}

	/**
	 * Check if an event should be ingested.
	 * Returns true if this is a new event or higher priority than existing.
	 */
	shouldIngest(key: DeduplicationKey): boolean {
		const hashKey = `${key.sessionId}:${key.contentHash}`;
		const existing = this.seen.get(hashKey);
		const sourcePriority = SOURCE_PRIORITY[key.source];

		if (existing) {
			// Already seen from another source
			existing.sources.add(key.source);
			existing.timestamp = Date.now(); // Refresh TTL

			// Only ingest if this source has higher priority than all previous
			if (sourcePriority > existing.highestPriority) {
				existing.highestPriority = sourcePriority;
				return true; // Allow re-ingestion from higher priority source
			}

			return false; // Skip, already have this or better
		}

		// New event
		this.seen.set(hashKey, {
			timestamp: Date.now(),
			sources: new Set([key.source]),
			highestPriority: sourcePriority,
		});

		this.enforceMaxEntries();
		return true;
	}

	/**
	 * Check if an event is a duplicate without marking it as seen.
	 */
	isDuplicate(sessionId: string, contentHash: string): boolean {
		const hashKey = `${sessionId}:${contentHash}`;
		return this.seen.has(hashKey);
	}

	/**
	 * Mark an event as seen from ingestion service response.
	 * Called after successful POST to /ingest to sync with server-side dedup.
	 */
	markSeen(sessionId: string, contentHash: string, source: EventSource = "hook"): void {
		const hashKey = `${sessionId}:${contentHash}`;
		if (!this.seen.has(hashKey)) {
			this.seen.set(hashKey, {
				timestamp: Date.now(),
				sources: new Set([source]),
				highestPriority: SOURCE_PRIORITY[source],
			});
		}
	}

	/**
	 * Get sources that have provided a specific event.
	 */
	getSources(sessionId: string, contentHash: string): EventSource[] {
		const hashKey = `${sessionId}:${contentHash}`;
		const entry = this.seen.get(hashKey);
		return entry ? Array.from(entry.sources) : [];
	}

	/**
	 * Clean up expired entries.
	 */
	private cleanup(): void {
		const now = Date.now();
		let removed = 0;

		for (const [key, entry] of this.seen) {
			if (now - entry.timestamp > this.ttlMs) {
				this.seen.delete(key);
				removed++;
			}
		}

		if (removed > 0) {
			// Could log here if debug logging is needed
		}
	}

	/**
	 * Enforce maximum entries by removing oldest.
	 */
	private enforceMaxEntries(): void {
		if (this.seen.size <= this.maxEntries) return;

		// Sort by timestamp and remove oldest 10%
		const entries = Array.from(this.seen.entries());
		entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

		const toRemove = Math.floor(this.maxEntries * 0.1);
		for (let i = 0; i < toRemove && i < entries.length; i++) {
			this.seen.delete(entries[i][0]);
		}
	}

	/**
	 * Get statistics about the deduplication engine.
	 */
	getStats(): { entries: number; maxEntries: number; ttlMs: number } {
		return {
			entries: this.seen.size,
			maxEntries: this.maxEntries,
			ttlMs: this.ttlMs,
		};
	}

	/**
	 * Stop the cleanup timer.
	 */
	stop(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}

	/**
	 * Clear all entries.
	 */
	clear(): void {
		this.seen.clear();
	}
}
