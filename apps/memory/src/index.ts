import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createFalkorClient } from "@the-soul/storage";
import { GraphWriter, QueryBuilder } from "@the-soul/memory-core";

// Initialize Services
const falkor = createFalkorClient();
const writer = new GraphWriter(falkor);

// Initialize MCP Server
const server = new McpServer({
  name: "soul-memory",
  version: "1.0.0",
});

// Tool: read_graph
server.tool(
  "read_graph",
  "Execute a read-only Cypher query against the knowledge graph",
  {
    cypher: z.string().describe("The Cypher query to execute"),
    params: z.string().optional().describe("JSON string of query parameters"),
  },
  async ({ cypher, params }) => {
    try {
      await falkor.connect(); // Ensure connected (idempotent-ish?)
      const parsedParams = params ? JSON.parse(params) : {};
      const result = await falkor.query(cypher, parsedParams);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// Tool: get_session_history
server.tool(
  "get_session_history",
  "Retrieve the linear thought history for a specific session",
  {
    session_id: z.string(),
    limit: z.number().optional().default(50),
  },
  async ({ session_id, limit }) => {
    try {
      await falkor.connect();
      // MATCH (s:Session {id: $id})-[:TRIGGERS|NEXT*]->(t:Thought)
      // This is a simplification. Real history is a linked list of thoughts.
      // (s)-[:TRIGGERS]->(t1)-[:NEXT]->(t2)...

      // We need a recursive query or just find all thoughts linked to session (if we index them by session_id in properties for speed, or traverse).
      // For V1, let's assume thoughts have a session_id property (denormalized) OR we traverse.
      // Let's traverse.

      const cypher = `
            MATCH (s:Session {id: $session_id})-[:TRIGGERS]->(first:Thought)
            MATCH p = (first)-[:NEXT*0..${limit}]->(t:Thought)
            RETURN t
            ORDER BY t.vt_start ASC
        `;

      const result = await falkor.query(cypher, { session_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  },
);

// Start Server
async function main() {
  await falkor.connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Soul Memory MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
