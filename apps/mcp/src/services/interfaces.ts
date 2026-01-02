import type { MemoryNode, MemoryType } from "@engram/graph";

/**
 * Tenant context for multi-tenancy isolation
 */
export interface TenantContext {
	/** Organization ID (ULID) for tenant isolation */
	orgId: string;
	/** Organization slug for graph naming */
	orgSlug: string;
}

/**
 * Input for creating a memory
 */
export interface CreateMemoryInput {
	content: string;
	type?: MemoryType;
	tags?: string[];
	project?: string;
	workingDir?: string;
	sourceSessionId?: string;
	sourceTurnId?: string;
	source?: "user" | "auto" | "import";
	/** Tenant context for multi-tenancy (optional for backwards compatibility) */
	tenant?: TenantContext;
}

/**
 * Reranker tier for search quality/latency tradeoff
 */
export type RerankTier = "fast" | "accurate" | "code" | "llm";

/**
 * Filters for recalling memories
 */
export interface RecallFilters {
	type?: MemoryType | "turn";
	project?: string;
	since?: string; // ISO date string
	sessionId?: string;
	rerank?: boolean;
	rerank_tier?: RerankTier;
	/** Filter by valid time end (returns only memories where vt_end > this timestamp in ms). Defaults to Date.now() */
	vtEndAfter?: number;
	/** Tenant context for multi-tenancy (optional for backwards compatibility) */
	tenant?: TenantContext;
}

/**
 * Result from memory recall
 */
export interface RecallResult {
	id: string;
	content: string;
	score: number;
	type: string;
	created_at: string;
	source?: string;
	project?: string;
	invalidated?: boolean;
	invalidatedAt?: number;
	replacedBy?: string | null;
}

/**
 * Context item returned from comprehensive context retrieval
 */
export interface ContextItem {
	type: "memory" | "decision" | "file";
	content: string;
	relevance: number;
	source: string;
}

/**
 * Conflict candidate from search service
 */
export interface ConflictCandidate {
	id: string;
	content: string;
	type: string;
	score: number;
	vt_start: number;
	vt_end?: number;
}

/**
 * Interface for memory storage operations
 */
export interface IMemoryStore {
	/**
	 * Create a new memory with deduplication
	 */
	createMemory(input: CreateMemoryInput): Promise<MemoryNode>;

	/**
	 * Get a memory by ID
	 */
	getMemory(id: string): Promise<MemoryNode | null>;

	/**
	 * List memories with optional filters
	 */
	listMemories(options?: {
		type?: MemoryType;
		project?: string;
		limit?: number;
	}): Promise<MemoryNode[]>;

	/**
	 * Soft-delete a memory
	 */
	deleteMemory(id: string): Promise<boolean>;

	/**
	 * Connect to the underlying data store
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the underlying data store
	 */
	disconnect(): Promise<void>;
}

/**
 * Interface for memory retrieval operations
 */
export interface IMemoryRetriever {
	/**
	 * Search for memories using hybrid retrieval (vector + keyword)
	 */
	recall(query: string, limit?: number, filters?: RecallFilters): Promise<RecallResult[]>;

	/**
	 * Connect to the underlying search services
	 */
	connect(): Promise<void>;
}

/**
 * Interface for graph query operations
 */
export interface IGraphClient {
	/**
	 * Execute a Cypher query
	 */
	query<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;

	/**
	 * Connect to the graph database
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the graph database
	 */
	disconnect(): Promise<void>;

	/**
	 * Check if connected
	 */
	isConnected(): boolean;
}

/**
 * Combined interface for all memory operations in cloud mode
 */
export interface IEngramClient extends IMemoryStore, IMemoryRetriever {
	/**
	 * Execute a read-only Cypher query (cloud mode only)
	 */
	query<T = unknown>(
		cypher: string,
		params?: Record<string, unknown>,
		tenant?: TenantContext,
	): Promise<T[]>;

	/**
	 * Get comprehensive context for a task
	 */
	getContext(
		task: string,
		files?: string[],
		depth?: "shallow" | "medium" | "deep",
		tenant?: TenantContext,
	): Promise<ContextItem[]>;

	/**
	 * Find potential conflict candidates for a new memory
	 */
	findConflictCandidates(content: string, project?: string): Promise<ConflictCandidate[]>;

	/**
	 * Invalidate a memory by setting its vt_end to now
	 * Used when a newer memory supersedes or contradicts an older one
	 */
	invalidateMemory(memoryId: string, tenant?: TenantContext): Promise<void>;
}
