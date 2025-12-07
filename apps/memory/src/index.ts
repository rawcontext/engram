import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeLogger, pino } from "@the-soul/logger";
import { GraphPruner } from "@the-soul/memory-core";
import { createFalkorClient } from "@the-soul/storage";
import { z } from "zod";

// Initialize Logger (stderr for MCP safety)
const logger = createNodeLogger(
	{
		service: "memory-service",
		level: "info",
		base: { component: "server" },
	},
	pino.destination(2),
);

// Initialize Services
const falkor = createFalkorClient();
const pruner = new GraphPruner(falkor);

// Pruning Job
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function startPruningJob() {
	// Start the periodic job
	setInterval(async () => {
		try {
			logger.info("Starting scheduled graph pruning...");
			// Default retention: 30 days
			const deleted = await pruner.pruneHistory();
			logger.info({ deleted }, "Graph pruning complete");
		} catch (error) {
			logger.error({ err: error }, "Graph pruning failed");
		}
	}, PRUNE_INTERVAL_MS);
}

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
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ err: error }, "read_graph failed");
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
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
			// Note: Using limit in Cypher string
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
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ err: error }, "get_session_history failed");
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// Start Server
export { server };

async function main() {
	await falkor.connect();
	startPruningJob();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("Soul Memory MCP Server running on stdio");
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Fatal error:", err); // Fallback if logger fails
		process.exit(1);
	});
}
