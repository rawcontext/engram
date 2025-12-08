import { createNodeLogger, pino } from "@engram/logger";
import { GraphPruner } from "@engram/memory-core";
import { createFalkorClient, createKafkaClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TurnAggregator } from "./turn-aggregator";

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
const turnAggregator = new TurnAggregator(falkor, logger);

// Pruning Job
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TURN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

function startTurnCleanupJob() {
	// Clean up stale turns every 5 minutes (turns inactive for 30 mins)
	setInterval(async () => {
		try {
			await turnAggregator.cleanupStaleTurns(30 * 60 * 1000);
		} catch (error) {
			logger.error({ err: error }, "Turn cleanup failed");
		}
	}, TURN_CLEANUP_INTERVAL_MS);
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

				logger.info(
					{
						event_summary: {
							id: event.event_id,
							meta: event.metadata,
							orig: event.original_event_id,
						},
					},
					"Memory received event",
				);

				const sessionId = event.metadata?.session_id || event.original_event_id; // ingestion might need to pass session_id better

				if (!sessionId) {
					logger.warn("Event missing session_id, skipping persistence");
					return;
				}

				// Persist to FalkorDB
				await falkor.connect();

				// 1. Check if session already exists
				const existingSession = await falkor.query(`MATCH (s:Session {id: $sessionId}) RETURN s`, {
					sessionId,
				});
				const isNewSession =
					!existingSession || (Array.isArray(existingSession) && existingSession.length === 0);

				// 2. Ensure Session Exists and update last_event_at + project context
				const now = Date.now();
				const workingDir = event.metadata?.working_dir || null;
				const gitRemote = event.metadata?.git_remote || null;
				const agentType = event.metadata?.agent_type || "unknown";

				await falkor.query(
					`MERGE (s:Session {id: $sessionId})
                     ON CREATE SET
                        s.started_at = $now,
                        s.last_event_at = $now,
                        s.user_id = $userId,
                        s.working_dir = $workingDir,
                        s.git_remote = $gitRemote,
                        s.agent_type = $agentType
                     ON MATCH SET
                        s.last_event_at = $now,
                        s.working_dir = COALESCE($workingDir, s.working_dir),
                        s.git_remote = COALESCE($gitRemote, s.git_remote),
                        s.agent_type = CASE WHEN $agentType <> 'unknown' THEN $agentType ELSE s.agent_type END`,
					{
						sessionId,
						now,
						userId: event.metadata?.user_id || "unknown",
						workingDir,
						gitRemote,
						agentType,
					},
				);

				// 3. If new session, publish to global sessions channel for homepage
				if (isNewSession) {
					await redis.publishGlobalSessionEvent("session_created", {
						id: sessionId,
						title: null,
						user_id: event.metadata?.user_id || "unknown",
						started_at: now,
						last_event_at: now,
						event_count: 1,
						preview: null,
						is_active: true,
					});
					logger.info({ sessionId }, "Published session_created event");
				}

				// 4. Aggregate into Turn nodes (new hierarchical model)
				// This creates Turn, Reasoning, and FileTouch nodes
				try {
					await turnAggregator.processEvent(event, sessionId);
				} catch (aggError) {
					logger.error(
						{ err: aggError, sessionId },
						"Turn aggregation failed, continuing with legacy",
					);
				}

				// 5. Create Thought/Event Node (LEGACY - kept for backward compatibility)
				// TODO: Remove once UI is updated to use Turn nodes
				const type = event.type || "unknown";
				const content = event.content || event.thought || "";
				const role = event.role || "system";
				const eventId = event.original_event_id || crypto.randomUUID();

				// Create Node
				// We use a simplified model where everything is a 'Thought' for now, distinguished by properties
				// Ideally we should use labels like :Thought:UserMessage etc.
				const eventTimestamp = event.timestamp || new Date().toISOString();

				// First, create the thought and link to session
				const createQuery = `
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
					RETURN t
				`;

				await falkor.query(createQuery, {
					sessionId,
					eventId,
					type,
					role,
					content,
					timestamp: eventTimestamp,
				});

				// Chain thoughts with NEXT relationship for lineage tracking
				// Find the previous thought (most recent by vt_start) and link to the new one
				const chainQuery = `
					MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(prev:Thought)
					WHERE prev.id <> $eventId
					WITH prev ORDER BY prev.vt_start DESC LIMIT 1
					MATCH (curr:Thought {id: $eventId})
					MERGE (prev)-[:NEXT]->(curr)
				`;

				await falkor.query(chainQuery, { sessionId, eventId });

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
	startTurnCleanupJob();
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
