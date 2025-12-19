import { FalkorDB, type Graph } from "falkordb";
import type { GraphClient } from "./interfaces";

// =============================================================================
// FalkorDB Query Parameter Types
// =============================================================================

/**
 * FalkorDB query parameter types (matches library's QueryParams)
 */
export type QueryParam = null | string | number | boolean | QueryParams | Array<QueryParam>;
export type QueryParams = { [key: string]: QueryParam };

// =============================================================================
// FalkorDB Response Types (Infrastructure Layer)
// =============================================================================

/**
 * Generic FalkorDB node type with typed properties.
 * This is the raw node structure returned by FalkorDB queries.
 *
 * @template T - The shape of the node's properties
 *
 * @example
 * // Use with domain types from @engram/memory-core
 * import type { SessionNode } from '@engram/memory-core';
 * const result = await falkor.query<{ s: FalkorNode }>('MATCH (s:Session) RETURN s');
 */
export interface FalkorNode<T extends Record<string, unknown> = Record<string, unknown>> {
	id: number;
	labels: string[];
	properties: T;
}

/**
 * Generic FalkorDB edge type with typed properties.
 * This is the raw edge structure returned by FalkorDB queries.
 *
 * Note: FalkorDB returns edge metadata in multiple formats depending on query type.
 * Use the appropriate field: relationshipType, relation, or type.
 *
 * @template T - The shape of the edge's properties
 */
export interface FalkorEdge<T extends Record<string, unknown> = Record<string, unknown>> {
	id: number;
	relationshipType?: string;
	relation?: string;
	type?: string;
	sourceId?: number;
	srcNodeId?: number;
	destinationId?: number;
	destNodeId?: number;
	properties: T;
}

/**
 * Generic row type for FalkorDB query results
 */
export type FalkorRow<T = Record<string, unknown>> = T;

/**
 * Generic result type for FalkorDB queries
 */
export type FalkorResult<T = Record<string, unknown>> = FalkorRow<T>[];

// =============================================================================
// FalkorDB Client Implementation
// =============================================================================

export class FalkorClient implements GraphClient {
	private dbPromise: Promise<FalkorDB> | null = null;
	private db: FalkorDB | null = null;
	private graph: Graph | null = null;
	private graphName = "EngramGraph";
	private connected = false;
	private connectionConfig: { username: string; password: string; host: string; port: number };

	constructor(url: string = "redis://localhost:6379") {
		const urlObj = new URL(url);
		// Store config but don't connect yet (lazy initialization)
		this.connectionConfig = {
			username: urlObj.username,
			password: urlObj.password,
			host: urlObj.hostname,
			port: Number(urlObj.port) || 6379,
		};
	}

	async connect(): Promise<void> {
		if (this.connected && this.db) {
			return; // Already connected
		}

		// If already connecting, wait for that attempt
		if (this.dbPromise) {
			await this.dbPromise;
			return;
		}

		// Start connection (deferred until first call to connect())
		this.dbPromise = FalkorDB.connect({
			username: this.connectionConfig.username,
			password: this.connectionConfig.password,
			socket: {
				host: this.connectionConfig.host,
				port: this.connectionConfig.port,
			},
		});

		try {
			this.db = await this.dbPromise;
			this.graph = this.db.selectGraph(this.graphName);
			this.connected = true;
		} catch (err) {
			this.dbPromise = null; // Reset on failure for retry
			throw err;
		}
	}

	isConnected(): boolean {
		return this.connected && this.db !== null;
	}

	/**
	 * Execute a typed Cypher query
	 * @template T - The expected row shape of the result
	 * @param cypher - The Cypher query string
	 * @param params - Query parameters
	 * @returns Typed array of result rows
	 *
	 * @example
	 * // Query returning session nodes
	 * interface SessionRow { s: FalkorNode }
	 * const result = await falkor.query<SessionRow>('MATCH (s:Session) RETURN s');
	 * result[0].s.properties.id; // typed as string
	 *
	 * @example
	 * // Query returning scalar values
	 * interface CountRow { cnt: number }
	 * const result = await falkor.query<CountRow>('MATCH (n) RETURN count(n) as cnt');
	 * result[0].cnt; // typed as number
	 */
	async query<T = Record<string, unknown>>(
		cypher: string,
		params: QueryParams = {},
	): Promise<FalkorResult<T>> {
		if (!this.graph) await this.connect();
		// After connect(), graph is guaranteed to be set
		if (!this.graph) throw new Error("Graph connection failed");
		const result = await this.graph.query(cypher, { params });
		return result.data as FalkorResult<T>;
	}

	async disconnect(): Promise<void> {
		if (this.db) {
			await this.db.close();
			this.db = null;
			this.graph = null;
			this.connected = false;
		}
	}
}

export const createFalkorClient = () => {
	const url = process.env.FALKORDB_URL || "redis://localhost:6379";
	return new FalkorClient(url);
};

// =============================================================================
// DEPRECATED: Domain Types
// =============================================================================
// These types are deprecated and will be removed in a future version.
// Import domain types from @engram/memory-core instead.
// =============================================================================

/**
 * @deprecated Import BitemporalProperties from @engram/memory-core
 */
export interface BitemporalProperties {
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
}

/**
 * @deprecated Import SessionNode from @engram/memory-core and use FalkorNode<SessionNode>
 */
export interface SessionProperties extends Partial<BitemporalProperties> {
	id: string;
	started_at?: number;
	last_event_at?: number;
	title?: string;
	user_id?: string;
	preview?: string;
	working_dir?: string;
	git_remote?: string;
	agent_type?: string;
	summary?: string;
	embedding?: number[];
	[key: string]: unknown;
}

/**
 * @deprecated Use TurnProperties instead
 */
export interface ThoughtProperties extends Partial<BitemporalProperties> {
	id: string;
	type: string;
	role: string;
	content: string;
	timestamp?: string;
	preview?: string;
	[key: string]: unknown;
}

/**
 * @deprecated Import TurnNode from @engram/memory-core and use FalkorNode<TurnNode>
 */
export interface TurnProperties extends Partial<BitemporalProperties> {
	id: string;
	user_content: string;
	user_content_hash: string;
	assistant_preview: string;
	assistant_blob_ref?: string;
	embedding?: number[];
	sequence_index: number;
	files_touched?: string[];
	tool_calls_count?: number;
	input_tokens?: number;
	output_tokens?: number;
	cache_read_tokens?: number;
	cache_write_tokens?: number;
	reasoning_tokens?: number;
	cost_usd?: number;
	duration_ms?: number;
	git_commit?: string;
	[key: string]: unknown;
}

/**
 * @deprecated Import ReasoningNode from @engram/memory-core and use FalkorNode<ReasoningNode>
 */
export interface ReasoningProperties extends Partial<BitemporalProperties> {
	id: string;
	content_hash: string;
	preview: string;
	blob_ref?: string;
	reasoning_type?: string;
	sequence_index: number;
	embedding?: number[];
	[key: string]: unknown;
}

/**
 * @deprecated Import FileTouchNode from @engram/memory-core and use FalkorNode<FileTouchNode>
 */
export interface FileTouchProperties extends Partial<BitemporalProperties> {
	id: string;
	file_path: string;
	action: string;
	tool_call_id?: string;
	sequence_index?: number;
	diff_preview?: string;
	lines_added?: number;
	lines_removed?: number;
	match_count?: number;
	matched_files?: string[];
	[key: string]: unknown;
}

/**
 * @deprecated Import ToolCallNode from @engram/memory-core and use FalkorNode<ToolCallNode>
 */
export interface ToolCallProperties extends Partial<BitemporalProperties> {
	id: string;
	call_id: string;
	tool_name: string;
	tool_type: string;
	arguments_json: string;
	arguments_preview?: string;
	status: string;
	error_message?: string;
	sequence_index: number;
	reasoning_sequence?: number;
	[key: string]: unknown;
}

/**
 * @deprecated Import ObservationNode from @engram/memory-core and use FalkorNode<ObservationNode>
 */
export interface ObservationProperties extends Partial<BitemporalProperties> {
	id: string;
	tool_call_id: string;
	content: string;
	content_preview?: string;
	content_hash?: string;
	is_error: boolean;
	error_type?: string;
	execution_time_ms?: number;
	[key: string]: unknown;
}

// =============================================================================
// DEPRECATED: Domain Node Aliases
// =============================================================================

/** @deprecated Import from @engram/memory-core */
export type SessionNode = FalkorNode<SessionProperties>;
/** @deprecated */
export type ThoughtNode = FalkorNode<ThoughtProperties>;
/** @deprecated Import from @engram/memory-core */
export type TurnNode = FalkorNode<TurnProperties>;
/** @deprecated Import from @engram/memory-core */
export type ReasoningNode = FalkorNode<ReasoningProperties>;
/** @deprecated Import from @engram/memory-core */
export type FileTouchNode = FalkorNode<FileTouchProperties>;
/** @deprecated Import from @engram/memory-core */
export type ToolCallNode = FalkorNode<ToolCallProperties>;
/** @deprecated Import from @engram/memory-core */
export type ObservationNode = FalkorNode<ObservationProperties>;
