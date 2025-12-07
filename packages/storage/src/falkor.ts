import { createClient } from "redis";

export class FalkorClient {
	private client;
	private graphName = "SoulGraph";

	constructor(url: string = "redis://localhost:6379") {
		this.client = createClient({ url });
		this.client.on("error", (err) => console.error("Redis Client Error", err));
	}

	async connect() {
		if (!this.client.isOpen) {
			await this.client.connect();
		}
	}

	async query(cypher: string, params: Record<string, unknown> = {}): Promise<unknown> {
		let queryWithParams = cypher;
		for (const [key, value] of Object.entries(params)) {
			const serialized =
				typeof value === "string" ? `'${value.replace(/'/g, "'")}'` : String(value);
			queryWithParams = queryWithParams.replace(new RegExp(`\\$${key}`, "g"), serialized);
		}

		// Try raw command with different casing or protocol hints if needed.
		// 'GRAPH.QUERY' is correct.
		// The error is persistent.
		// It's possible the client is connected to a different redis instance?
		// `redis://localhost:6379` matches `docker-compose`.
		// Maybe node-redis v4 has issues with modules in some envs?
		// Let's try using `client.sendCommand` with a spread operator if it expects varargs?
		// No, array is standard.

		// Wait, "ERR unknown command 'GRAPH.QUERY'" FROM REDIS means Redis itself doesn't know it.
		// But CLI works.
		// Is there another Redis running on port 6379 on the host?
		// The `docker-compose` mapped it to 6379.
		// If the test environment connects to a DIFFERENT redis (e.g. system redis) that doesn't have the module...
		// Check if `redis-server` is running locally on Mac?
		// `lsof -i :6379` might show.

		// Assuming we might be hitting a local redis.
		// We can try to force connection to the docker one if we knew the IP, but localhost should map.

		return this.client.sendCommand(["GRAPH.QUERY", this.graphName, queryWithParams]);
	}

	async disconnect() {
		await this.client.disconnect();
	}
}

export const createFalkorClient = () => {
	const url = process.env.FALKORDB_URL || "redis://localhost:6379";
	return new FalkorClient(url);
};
