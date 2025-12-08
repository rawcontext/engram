import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeLogger, pino } from "@engram/logger";
import { GraphPruner } from "@engram/memory-core";
import { createFalkorClient, createKafkaClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";
import { z } from "zod";

// Initialize Logger (stderr for MCP safety)
const logger = createNodeLogger(
	{
		service: "memory-service",
		level: "info",
		base: { component: "server" },
		pretty: false,
	},
	pino.destination(2),
);

// Initialize Services
const falkor = createFalkorClient();
const kafka = createKafkaClient("memory-service");
const redis = createRedisPublisher();
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

// Kafka Consumer for Persistence
async function startPersistenceConsumer() {
	const consumer = await kafka.createConsumer("memory-group");
	await consumer.subscribe({ topic: "parsed_events", fromBeginning: false });

	await consumer.run({
		eachMessage: async ({ message }) => {
			try {
				const value = message.value?.toString();
				if (!value) return;
				const event = JSON.parse(value);
                
                logger.info({ event_summary: { id: event.event_id, meta: event.metadata, orig: event.original_event_id } }, "Memory received event");

				const sessionId = event.metadata?.session_id || event.original_event_id; // ingestion might need to pass session_id better

				if (!sessionId) {
					logger.warn("Event missing session_id, skipping persistence");
					return;
				}

				// Persist to FalkorDB
				await falkor.connect();

				// 1. Ensure Session Exists and update lastEventAt
				const now = Date.now();
				await falkor.query(
					`MERGE (s:Session {id: $sessionId})
                     ON CREATE SET s.startedAt = $now, s.lastEventAt = $now
                     ON MATCH SET s.lastEventAt = $now`,
					{ sessionId, now },
				);

				// 2. Create Thought/Event Node
				// Determine type and content
				const type = event.type || "unknown";
				const content = event.content || event.thought || "";
				const role = event.role || "system";
				const eventId = event.original_event_id || crypto.randomUUID();

				// Create Node
				// We use a simplified model where everything is a 'Thought' for now, distinguished by properties
				// Ideally we should use labels like :Thought:UserMessage etc.
				const query = `
                    MATCH (s:Session {id: $sessionId})
                    CREATE (t:Thought {
                        id: $eventId,
                        type: $type,
                        role: $role,
                        content: $content,
                        vt_start: timestamp(),
                        timestamp: $timestamp
                    })
                    MERGE (s)-[:TRIGGERS]->(t)
                    // TODO: Link to previous thought for chain (NEXT)
                    // For now, simple TRIGGERS from Session is enough to show in Replay if we sort by time
                `;

				await falkor.query(query, {
					sessionId,
					eventId,
					type,
					role,
					content,
					timestamp: event.timestamp || new Date().toISOString(),
				});

				logger.info({ eventId, sessionId }, "Persisted event to graph");

				// Publish to Redis for real-time WebSocket streaming
				await redis.publishSessionUpdate(sessionId, {
					type: "node_created",
					data: {
						id: eventId,
						type,
						role,
						content,
						timestamp: event.timestamp || new Date().toISOString(),
					},
				});

				// Publish 'memory.node_created' for Search Service
				await kafka.sendEvent("memory.node_created", eventId, {
					id: eventId,
					labels: ["Thought"],
					properties: { content, role, type },
				});
			} catch (e) {
				logger.error({ err: e }, "Persistence error");
			}
		},
	});
	logger.info("Memory Persistence Consumer started");
}

// Initialize MCP Server
const server = new McpServer({
	name: "engram-memory",
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
	startPersistenceConsumer().catch((err) => {
		logger.error({ err }, "Failed to start persistence consumer");
	});
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("Engram Memory MCP Server running on stdio");
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Fatal error:", err); // Fallback if logger fails
		process.exit(1);
	});
}
