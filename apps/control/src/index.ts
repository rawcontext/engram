import { createNodeLogger } from "@engram/logger";
import { createFalkorClient, createNatsClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";
import { createSearchClient } from "./clients/search.js";
import { ContextAssembler } from "./context/assembler.js";
import { ExecutionService } from "./execution/index.js";
import { SessionManager } from "./session/manager.js";
import { McpToolAdapter, MultiMcpAdapter } from "./tools/mcp_client.js";
import { ToolRouter } from "./tools/router.js";

const logger = createNodeLogger({ service: "control-service", base: { component: "main" } });

// Initialize Services
const nats = createNatsClient("control-service");
const falkor = createFalkorClient();

// Initialize Execution Service (VFS, TimeTravel) - direct integration
const executionService = new ExecutionService({ graphClient: falkor });

// Initialize MCP Adapters for external tools
// Wassette (Official Binary) - placeholder for future external tools
const wassettePath = `${process.env.HOME}/.local/bin/wassette`;
const wassetteAdapter = new McpToolAdapter(wassettePath, ["serve", "--stdio"]);

const multiAdapter = new MultiMcpAdapter();
multiAdapter.addAdapter(wassetteAdapter);

// Create unified ToolRouter that combines ExecutionService + MCP tools
const toolRouter = new ToolRouter(executionService, multiAdapter);

// Initialize Search Client for Python search service
const searchClient = createSearchClient(process.env.SEARCH_URL);

// Initialize Core Logic with search integration
const contextAssembler = new ContextAssembler({ searchClient, graphClient: falkor });

const sessionManager = new SessionManager({
	contextAssembler,
	toolAdapter: toolRouter,
	graphClient: falkor,
});

// Connect to DB and MCP
async function init() {
	await falkor.connect();
	logger.info("FalkorDB connected");

	try {
		await multiAdapter.connectAll();
		logger.info("All MCP Servers connected");
	} catch (error) {
		logger.error({ error }, "Failed to connect to MCP Servers");
	}
}

// NATS Consumer
const startConsumer = async () => {
	await init();

	const consumer = await nats.getConsumer({ groupId: "control-group" });
	await consumer.subscribe({ topic: "parsed_events", fromBeginning: false });

	// Publish consumer ready status to Redis
	const redis = createRedisPublisher();
	await redis.publishConsumerStatus("consumer_ready", "control-group", "control-service");
	logger.info("Published consumer_ready status for control-group");

	// Periodic heartbeat every 10 seconds
	const heartbeatInterval = setInterval(async () => {
		try {
			await redis.publishConsumerStatus("consumer_heartbeat", "control-group", "control-service");
		} catch (e) {
			logger.error({ err: e }, "Failed to publish heartbeat");
		}
	}, 10000);

	// Cleanup heartbeat on process exit
	const cleanup = async () => {
		clearInterval(heartbeatInterval);
		try {
			await redis.publishConsumerStatus(
				"consumer_disconnected",
				"control-group",
				"control-service",
			);
			await redis.disconnect();
			logger.info("Redis publisher disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error during Redis cleanup");
		}
		try {
			await consumer.disconnect();
			logger.info("NATS consumer disconnected");
		} catch (e) {
			logger.error({ err: e }, "Error during NATS cleanup");
		}
		process.exit(0);
	};

	process.on("SIGTERM", cleanup);
	process.on("SIGINT", cleanup);

	await consumer.run({
		eachMessage: async ({ message }) => {
			try {
				const value = message.value?.toString();
				if (!value) return;
				const event = JSON.parse(value);

				// Filter for user messages or system triggers
				if (event.type === "content" && event.role === "user") {
					logger.info({ content: event.content }, "Received user input");
					// Trigger Session Manager
					const sessionId = event.metadata?.session_id || event.original_event_id;
					if (!sessionId) {
						logger.warn("No session_id in event metadata");
						return;
					}
					await sessionManager.handleInput(sessionId, event.content);
				}
			} catch (e) {
				logger.error({ error: e }, "Control processing error");
			}
		},
	});
};

// Start
logger.info("Control Service starting...");
startConsumer().catch((err) => {
	logger.error({ err }, "Fatal error in consumer");
	process.exit(1);
});
