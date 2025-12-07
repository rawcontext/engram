import { createClient } from "redis";

export class FalkorClient {
  private client;
  private graphName = "SoulGraph";

  constructor(url: string = "redis://localhost:6379") {
    this.client = createClient({ url });
    this.client.on("error", (err) => console.error("Redis Client Error", err));
  }

  async connect() {
    await this.client.connect();
    // Optional: Verify module is loaded
    // const modules = await this.client.sendCommand(['MODULE', 'LIST']);
  }

  async query(cypher: string, params: any = {}): Promise<any> {
    // GRAPH.QUERY <graph> <query> [params] --compact
    // Note: Parameter handling in raw Redis command requires specific formatting if not using a higher-level lib.
    // For V1, we might rely on string interpolation (carefully) or implement a param serializer.
    // Ideally, we'd use a proper falkordb-js client if one exists and is stable, but raw redis is fine.

    // Simple param serialization (very basic, needs improvement for production)
    let queryWithParams = cypher;
    for (const [key, value] of Object.entries(params)) {
      const serialized =
        typeof value === "string" ? `'${value.replace(/'/g, "\'")}'` : String(value);
      queryWithParams = queryWithParams.replace(new RegExp(`\$${key}`, "g"), serialized);
    }

    return this.client.sendCommand(["GRAPH.QUERY", this.graphName, queryWithParams, "--compact"]);
  }

  async disconnect() {
    await this.client.disconnect();
  }
}

export const createFalkorClient = () => {
  const url = process.env.FALKORDB_URL || "redis://localhost:6379";
  return new FalkorClient(url);
};
