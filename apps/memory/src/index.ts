import { GraphPruner } from "@engram/graph";
import { createNodeLogger, type Logger, pino, withTraceContext } from "@engram/logger";
import {
	createFalkorClient,
	createNatsClient,
	type GraphClient,
	TenantAwareFalkorClient,
} from "@engram/storage";
import { createNatsPubSubPublisher, type NatsPubSubPublisher } from "@engram/storage/nats";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
	type NodeCreatedCallback,
	TurnAggregator,
	type TurnFinalizedCallback,
} from "./turn-aggregator";

/**
 * Dependencies for Memory Service construction.
 * Supports dependency injection for testability.
 */
export interface MemoryServiceDeps {
	/** Graph client for session persistence. Defaults to FalkorClient. */
	graphClient?: GraphClient;
	/** Tenant-aware client for multi-tenant graph isolation. */
	tenantClient?: TenantAwareFalkorClient;
	/** NATS client for event streaming. */
	natsClient?: ReturnType<typeof createNatsClient>;
	/** NATS pub/sub publisher for real-time updates. */
	natsPubSub?: NatsPubSubPublisher;
	/** Logger instance. */
	logger?: Logger;
	/** Turn aggregator for event processing. */
	turnAggregator?: TurnAggregator;
	/** Graph pruner for cleanup. */
	graphPruner?: GraphPruner;
}

/**
 * Factory function for creating Memory Service dependencies.
 * Returns an object with all initialized services for the memory app.
 *
 * @example
 * // Production usage (uses defaults)
 * const deps = createMemoryServiceDeps();
 *
 * @example
 * // Test usage (inject mocks)
 * const deps = createMemoryServiceDeps({
 *   graphClient: mockGraphClient,
 *   natsPubSub: mockNatsPubSub,
 * });
 */
export function createMemoryServiceDeps(deps?: MemoryServiceDeps): Required<
	Omit<MemoryServiceDeps, "turnAggregator" | "graphPruner">
> & {
	turnAggregator: TurnAggregator;
	graphPruner: GraphPruner;
} {
	const logger =
		deps?.logger ??
		createNodeLogger(
			{
				service: "memory-service",
				level: "info",
				base: { component: "server" },
				pretty: false,
			},
			pino.destination(2),
		);

	// Create FalkorClient - keep reference for tenant client
	const falkorClient = createFalkorClient();
	const graphClient = deps?.graphClient ?? falkorClient;
	// Tenant client needs concrete FalkorClient, not the interface
	const tenantClient = deps?.tenantClient ?? new TenantAwareFalkorClient(falkorClient);
	const natsClient = deps?.natsClient ?? createNatsClient("memory-service");
	const natsPubSub = deps?.natsPubSub ?? createNatsPubSubPublisher();
	const graphPruner = deps?.graphPruner ?? new GraphPruner(graphClient);

	// Callback for real-time WebSocket updates via NATS pub/sub
	const onNodeCreated: NodeCreatedCallback = async (sessionId, node) => {
		try {
			await natsPubSub.publishSessionUpdate(sessionId, {
				type: "graph_node_created",
				data: {
					id: node.id,
					nodeType: node.type,
					label: node.label,
					properties: node.properties,
					timestamp: new Date().toISOString(),
				},
			});
			logger.debug(
				{ sessionId, nodeId: node.id, nodeType: node.type },
				"Published graph node event",
			);
		} catch (e) {
			logger.error({ err: e, sessionId, nodeId: node.id }, "Failed to publish graph node event");
		}
	};

	// Callback for publishing turn_finalized events to NATS for search indexing
	const onTurnFinalized: TurnFinalizedCallback = async (payload) => {
		try {
			await natsClient.sendEvent("memory.turn_finalized", payload.id, payload);
			logger.debug(
				{ turnId: payload.id, sessionId: payload.session_id },
				"Published turn_finalized event",
			);
		} catch (e) {
			logger.error({ err: e, turnId: payload.id }, "Failed to publish turn_finalized event");
		}
	};

	const turnAggregator =
		deps?.turnAggregator ??
		new TurnAggregator({
			graphClient,
			tenantClient,
			logger,
			onNodeCreated,
			onTurnFinalized,
		});

	return {
		graphClient,
		tenantClient,
		natsClient,
		natsPubSub,
		logger,
		turnAggregator,
		graphPruner,
	};
}

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
const tenantClient = new TenantAwareFalkorClient(falkor);
const nats = createNatsClient("memory-service");
const natsPubSub = createNatsPubSubPublisher();
const pruner = new GraphPruner(falkor);

// Callback for real-time WebSocket updates when TurnAggregator creates graph nodes (via NATS pub/sub)
const onNodeCreated: NodeCreatedCallback = async (sessionId, node) => {
	try {
		await natsPubSub.publishSessionUpdate(sessionId, {
			type: "graph_node_created",
			data: {
				id: node.id,
				nodeType: node.type,
				label: node.label,
				properties: node.properties,
				timestamp: new Date().toISOString(),
			},
		});
		logger.debug({ sessionId, nodeId: node.id, nodeType: node.type }, "Published graph node event");
	} catch (e) {
		logger.error({ err: e, sessionId, nodeId: node.id }, "Failed to publish graph node event");
	}
};

// Callback for publishing turn_finalized events to NATS for search indexing
const onTurnFinalized: TurnFinalizedCallback = async (payload) => {
	try {
		await nats.sendEvent("memory.turn_finalized", payload.id, payload);
		logger.debug(
			{ turnId: payload.id, sessionId: payload.session_id },
			"Published turn_finalized event",
		);
	} catch (e) {
		logger.error({ err: e, turnId: payload.id }, "Failed to publish turn_finalized event");
	}
};

const turnAggregator = new TurnAggregator({
	graphClient: falkor,
	tenantClient,
	logger,
	onNodeCreated,
	onTurnFinalized,
});

// Pruning Job Configuration
const PRUNE_INTERVAL_MS =
	Number.parseInt(process.env.PRUNE_INTERVAL_HOURS ?? "24", 10) * 60 * 60 * 1000;
const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_DAYS ?? "30", 10);
const TURN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Store interval IDs for cleanup on shutdown
let pruningIntervalId: NodeJS.Timeout | null = null;
let turnCleanupIntervalId: NodeJS.Timeout | null = null;

export function startPruningJob(): NodeJS.Timeout {
	// Start the periodic job
	pruningIntervalId = setInterval(async () => {
		try {
			logger.info({ retentionDays: RETENTION_DAYS }, "Starting scheduled graph pruning...");
			const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
			const deleted = await pruner.pruneHistory({ retentionMs });
			logger.info({ deleted, retentionDays: RETENTION_DAYS }, "Graph pruning complete");
		} catch (error) {
			logger.error({ err: error }, "Graph pruning failed");
		}
	}, PRUNE_INTERVAL_MS);
	return pruningIntervalId;
}

export function startTurnCleanupJob(): NodeJS.Timeout {
	// Clean up stale turns every 5 minutes (turns inactive for 30 mins)
	turnCleanupIntervalId = setInterval(async () => {
		try {
			await turnAggregator.cleanupStaleTurns(30 * 60 * 1000);
		} catch (error) {
			logger.error({ err: error }, "Turn cleanup failed");
		}
	}, TURN_CLEANUP_INTERVAL_MS);
	return turnCleanupIntervalId;
}

/**
 * Clear all interval timers - call on shutdown
 */
export function clearAllIntervals(): void {
	if (pruningIntervalId) {
		clearInterval(pruningIntervalId);
		pruningIntervalId = null;
	}
	if (turnCleanupIntervalId) {
		clearInterval(turnCleanupIntervalId);
		turnCleanupIntervalId = null;
	}
}

/**
 * Message handler for NATS persistence consumer.
 * Extracted for testability.
 */
export async function handlePersistenceMessage({ message }: { message: any }) {
	// Extract trace context from NATS message headers
	const headers = message.headers || {};
	const traceId = headers.trace_id?.toString();
	const correlationId = headers.correlation_id?.toString() || headers.message_id?.toString();

	// Create child logger with trace context for this message
	const messageLogger =
		traceId || correlationId ? withTraceContext(logger, { traceId, correlationId }) : logger;

	// Define event type for type safety
	interface ParsedEvent {
		event_id?: string;
		original_event_id?: string;
		type?: string;
		role?: string;
		content?: string;
		thought?: string;
		timestamp?: string;
		metadata?: {
			session_id?: string;
			working_dir?: string;
			git_remote?: string;
			agent_type?: string;
			user_id?: string;
		};
	}

	let event: ParsedEvent | undefined;
	let rawValue: string | undefined;
	try {
		rawValue = message.value?.toString();
		if (!rawValue) return;
		event = JSON.parse(rawValue) as ParsedEvent;

		messageLogger.info(
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
			messageLogger.warn("Event missing session_id, skipping persistence");
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
                        s.vt_start = $now,
                        s.tt_start = $now,
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

		// 3. If new session, publish to global sessions subject for homepage (via NATS pub/sub)
		// Note: use camelCase to match frontend SessionListItem interface
		if (isNewSession) {
			await natsPubSub.publishGlobalSessionEvent("session_created", {
				id: sessionId,
				title: null,
				userId: event.metadata?.user_id || "unknown",
				startedAt: now,
				lastEventAt: now,
				eventCount: 1,
				preview: null,
				isActive: true,
			});
			logger.info({ sessionId }, "Published session_created event");
		}

		// 4. Aggregate into Turn nodes (new hierarchical model)
		// This creates Turn, Reasoning, and FileTouch nodes
		try {
			await turnAggregator.processEvent(event, sessionId);
		} catch (aggError) {
			logger.error({ err: aggError, sessionId }, "Turn aggregation failed, continuing with legacy");
		}

		// Publish 'memory.node_created' for Search Service indexing
		// Note: Real-time graph node updates are published via TurnAggregator's onNodeCreated callback
		const eventId = event.original_event_id || crypto.randomUUID();
		const type = event.type || "unknown";
		const content = event.content || event.thought || "";
		const role = event.role || "system";

		await nats.sendEvent("memory.node_created", eventId, {
			id: eventId,
			labels: ["Turn"],
			session_id: sessionId,
			properties: { content, role, type },
		});
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		logger.error({ err: e }, "Persistence error");

		// Send to Dead Letter Queue for later analysis/retry
		try {
			const eventId = event?.original_event_id || event?.event_id || `unknown-${Date.now()}`;
			await nats.sendEvent("memory.dead_letter", String(eventId), {
				error: errorMessage,
				payload: event ?? rawValue,
				timestamp: new Date().toISOString(),
				source: "persistence_consumer",
			});
			logger.warn({ eventId }, "Sent failed message to memory DLQ");
		} catch (dlqError) {
			logger.error({ err: dlqError }, "Failed to send to DLQ");
		}
	}
}

/**
 * Start NATS consumer for persistence operations.
 * Exported for testing.
 */
export async function startPersistenceConsumer() {
	const consumer = await nats.getConsumer({ groupId: "memory-group" });
	await consumer.subscribe({ topic: "parsed_events", fromBeginning: false });

	// Publish consumer ready status via NATS pub/sub
	await natsPubSub.publishConsumerStatus("consumer_ready", "memory-group", "memory-service");
	logger.info("Published consumer_ready status for memory-group");

	// Periodic heartbeat every 10 seconds
	const heartbeatInterval = setInterval(async () => {
		try {
			await natsPubSub.publishConsumerStatus(
				"consumer_heartbeat",
				"memory-group",
				"memory-service",
			);
		} catch (e) {
			logger.error({ err: e }, "Failed to publish heartbeat");
		}
	}, 10000);

	// Graceful shutdown handler
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down gracefully...");
		clearInterval(heartbeatInterval);
		clearAllIntervals(); // Clear pruning and turn cleanup intervals
		try {
			await consumer.disconnect();
			logger.info("NATS consumer disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error disconnecting consumer");
		}
		await natsPubSub.publishConsumerStatus(
			"consumer_disconnected",
			"memory-group",
			"memory-service",
		);
		await natsPubSub.disconnect();
		logger.info("NATS pub/sub publisher disconnected");
		await falkor.disconnect();
		logger.info("FalkorDB disconnected");
		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	await consumer.run({
		eachMessage: handlePersistenceMessage,
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

/**
 * Main entry point for the memory service.
 * Exported for testing.
 */
export async function main() {
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
