/**
 * Limit constants for the Engram system.
 *
 * These constants define maximum values for various operations.
 *
 * @module @engram/common/constants/limits
 */

/**
 * Content size limits.
 */
export const ContentLimits = {
	/** Maximum content length for a single event (100KB) */
	MAX_EVENT_CONTENT_BYTES: 100_000,

	/** Maximum length for thought/turn content (50KB) */
	MAX_THOUGHT_CONTENT_BYTES: 50_000,

	/** Maximum context window size for LLM (200K tokens approx) */
	MAX_CONTEXT_TOKENS: 200_000,

	/** Maximum file content for indexing (1MB) */
	MAX_FILE_INDEX_BYTES: 1_000_000,

	/** Maximum blob size (10MB) */
	MAX_BLOB_BYTES: 10_000_000,

	/** Truncation limit for display (500 chars) */
	DISPLAY_TRUNCATE_CHARS: 500,
} as const;

/**
 * Query and result limits.
 */
export const QueryLimits = {
	/** Default number of results per page */
	DEFAULT_PAGE_SIZE: 10,

	/** Maximum number of results per page */
	MAX_PAGE_SIZE: 100,

	/** Default number of search results */
	DEFAULT_SEARCH_RESULTS: 10,

	/** Maximum number of search results */
	MAX_SEARCH_RESULTS: 100,

	/** Default history items to retrieve */
	DEFAULT_HISTORY_ITEMS: 50,

	/** Maximum history items to retrieve */
	MAX_HISTORY_ITEMS: 500,

	/** Maximum depth for graph traversals */
	MAX_TRAVERSAL_DEPTH: 10,

	/** Maximum candidates for reranking */
	MAX_RERANK_CANDIDATES: 100,
} as const;

/**
 * Session and turn limits.
 */
export const SessionLimits = {
	/** Maximum turns per session for display */
	MAX_TURNS_DISPLAY: 100,

	/** Maximum active sessions per user */
	MAX_ACTIVE_SESSIONS: 10,

	/** Maximum events per turn */
	MAX_EVENTS_PER_TURN: 1000,

	/** Maximum file touches per turn */
	MAX_FILE_TOUCHES_PER_TURN: 500,
} as const;

/**
 * Rate limits.
 */
export const RateLimits = {
	/** Maximum requests per minute for search API */
	SEARCH_RPM: 60,

	/** Maximum requests per minute for embedding API */
	EMBEDDING_RPM: 100,

	/** Maximum requests per hour for LLM reranking */
	LLM_RERANK_RPH: 1000,

	/** Maximum events per second for ingestion */
	INGESTION_EPS: 100,

	/** Maximum WebSocket connections per user */
	WS_CONNECTIONS_PER_USER: 5,
} as const;

/**
 * Batch processing limits.
 */
export const BatchLimits = {
	/** Default batch size for processing */
	DEFAULT_BATCH_SIZE: 100,

	/** Maximum batch size for processing */
	MAX_BATCH_SIZE: 1000,

	/** Batch size for embedding generation */
	EMBEDDING_BATCH_SIZE: 32,

	/** Batch size for fast reranking */
	RERANK_FAST_BATCH_SIZE: 16,

	/** Batch size for accurate reranking */
	RERANK_ACCURATE_BATCH_SIZE: 8,

	/** Batch size for message queue processing */
	MESSAGE_BATCH_SIZE: 100,
} as const;
