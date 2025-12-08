import { FalkorDB, type Graph } from "falkordb";

// FalkorDB query parameter types (matches library's QueryParams)
export type QueryParam = null | string | number | boolean | QueryParams | Array<QueryParam>;
export type QueryParams = { [key: string]: QueryParam };

// FalkorDB response types
export interface FalkorNode {
	id: number;
	labels: string[];
	properties: Record<string, unknown>;
}

export interface FalkorEdge {
	id: number;
	relationshipType?: string;
	relation?: string;
	type?: string;
	sourceId?: number;
	srcNodeId?: number;
	destinationId?: number;
	destNodeId?: number;
	properties: Record<string, unknown>;
}

export type FalkorRow = Record<string, unknown>;
export type FalkorResult = FalkorRow[];

export class FalkorClient {
	private dbPromise;
	private db: FalkorDB | null = null;
	private graph: Graph | null = null;
	private graphName = "SoulGraph";

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

	async query(cypher: string, params: QueryParams = {}): Promise<FalkorResult> {
		if (!this.graph) await this.connect();
		const result = await this.graph!.query(cypher, { params });
		return result.data as FalkorResult;
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
