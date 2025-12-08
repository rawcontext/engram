import { FalkorDB, type Graph } from "falkordb";

// FalkorDB query parameter types (matches library's QueryParams)
export type QueryParam = null | string | number | boolean | QueryParams | Array<QueryParam>;
export type QueryParams = { [key: string]: QueryParam };

// =============================================================================
// Generic FalkorDB Response Types
// =============================================================================

/**
 * Generic FalkorDB node type with typed properties
 * @template T - The shape of the node's properties
 */
export interface FalkorNode<T extends Record<string, unknown> = Record<string, unknown>> {
	id: number;
	labels: string[];
	properties: T;
}

/**
 * Generic FalkorDB edge type with typed properties
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

// =============================================================================
// Bitemporal Properties (shared across domain types)
// =============================================================================

export interface BitemporalProperties {
	vt_start: number;
	vt_end: number;
	tt_start: number;
	tt_end: number;
}

// =============================================================================
// Domain Property Types
// =============================================================================

export interface SessionProperties extends Partial<BitemporalProperties> {
	id: string;
	started_at?: number;
	last_event_at?: number;
	title?: string;
	user_id?: string;
	preview?: string;
	[key: string]: unknown;
}

export interface ThoughtProperties extends Partial<BitemporalProperties> {
	id: string;
	type: string;
	role: string;
	content: string;
	timestamp?: string;
	preview?: string;
	[key: string]: unknown;
}

export interface ToolCallProperties extends Partial<BitemporalProperties> {
	id: string;
	name: string;
	arguments?: string;
	result?: string;
	[key: string]: unknown;
}

// =============================================================================
// Domain Node Types (Convenience aliases)
// =============================================================================

export type SessionNode = FalkorNode<SessionProperties>;
export type ThoughtNode = FalkorNode<ThoughtProperties>;
export type ToolCallNode = FalkorNode<ToolCallProperties>;

// =============================================================================
// Query Result Types
// =============================================================================

export type FalkorRow<T = Record<string, unknown>> = T;
export type FalkorResult<T = Record<string, unknown>> = FalkorRow<T>[];

export class FalkorClient {
	private dbPromise;
	private db: FalkorDB | null = null;
	private graph: Graph | null = null;
	private graphName = "EngramGraph";

	constructor(url: string = "redis://localhost:6379") {
		const urlObj = new URL(url);
		// Store the promise or connection logic
		this.dbPromise = FalkorDB.connect({
			username: urlObj.username,
			password: urlObj.password,
			socket: {
				host: urlObj.hostname,
				port: Number(urlObj.port) || 6379,
			},
		});
	}

	async connect() {
		if (!this.db) {
			this.db = await this.dbPromise;
			this.graph = this.db.selectGraph(this.graphName);
		}
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
	 * interface SessionRow { s: SessionNode }
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
		const result = await this.graph?.query(cypher, { params });
		return result.data as FalkorResult<T>;
	}

	async disconnect() {
		if (this.db) {
			await this.db.close();
		}
	}
}

export const createFalkorClient = () => {
	const url = process.env.FALKORDB_URL || "redis://localhost:6379";
	return new FalkorClient(url);
};
