/**
 * Interval constants for the Engram system.
 *
 * These constants define timing intervals for periodic jobs and cleanup.
 * All values are in milliseconds.
 *
 * @module @engram/common/constants/intervals
 */

/**
 * Pruning and cleanup intervals.
 */
export const PruneIntervals = {
	/** Graph pruning job interval (24 hours) */
	GRAPH_PRUNE_MS: 24 * 60 * 60 * 1000, // 86_400_000

	/** Stale turn cleanup interval (5 minutes) */
	STALE_TURN_CLEANUP_MS: 5 * 60 * 1000, // 300_000

	/** Cache cleanup interval (1 hour) */
	CACHE_CLEANUP_MS: 60 * 60 * 1000, // 3_600_000

	/** Session inactivity threshold (30 minutes) */
	SESSION_INACTIVE_MS: 30 * 60 * 1000, // 1_800_000

	/** Stale turn threshold (30 minutes) */
	STALE_TURN_THRESHOLD_MS: 30 * 60 * 1000, // 1_800_000
} as const;

/**
 * Polling and sync intervals.
 */
export const PollIntervals = {
	/** Health check polling interval (30 seconds) */
	HEALTH_CHECK_MS: 30 * 1000, // 30_000

	/** Metrics collection interval (10 seconds) */
	METRICS_COLLECTION_MS: 10 * 1000, // 10_000

	/** Connection retry base interval (1 second) */
	CONNECTION_RETRY_BASE_MS: 1000,

	/** Maximum connection retry interval (30 seconds) */
	CONNECTION_RETRY_MAX_MS: 30 * 1000, // 30_000

	/** Message queue consumer poll interval (100ms) */
	MESSAGE_POLL_MS: 100,
} as const;

/**
 * Debounce and throttle intervals.
 */
export const DebounceIntervals = {
	/** Search input debounce (300ms) */
	SEARCH_INPUT_MS: 300,

	/** Auto-save debounce (1 second) */
	AUTO_SAVE_MS: 1000,

	/** WebSocket reconnect debounce (1 second) */
	WS_RECONNECT_MS: 1000,

	/** Event batching window (100ms) */
	EVENT_BATCH_MS: 100,
} as const;

/**
 * Retention periods.
 */
export const RetentionPeriods = {
	/** Default data retention (30 days) */
	DEFAULT_DAYS: 30,

	/** Session data retention (90 days) */
	SESSION_DAYS: 90,

	/** Metrics retention (7 days) */
	METRICS_DAYS: 7,

	/** Log retention (14 days) */
	LOGS_DAYS: 14,

	/** Convert days to milliseconds helper */
	toMs: (days: number): number => days * 24 * 60 * 60 * 1000,
} as const;

/**
 * WebSocket intervals.
 */
export const WebSocketIntervals = {
	/** Ping interval to keep connection alive (30 seconds) */
	PING_MS: 30 * 1000, // 30_000

	/** Pong timeout before considering connection dead (10 seconds) */
	PONG_TIMEOUT_MS: 10 * 1000, // 10_000

	/** Reconnection attempt interval (1-30 seconds with backoff) */
	RECONNECT_BASE_MS: 1000,
	RECONNECT_MAX_MS: 30 * 1000, // 30_000

	/** Maximum reconnection attempts before giving up */
	MAX_RECONNECT_ATTEMPTS: 10,
} as const;
