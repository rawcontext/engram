import { createNodeLogger } from "@engram/logger";
import { createFalkorClient, createKafkaClient } from "@engram/storage";
import { createRedisPublisher } from "@engram/storage/redis";
import { ContextAssembler } from "./context/assembler";
import { SessionManager } from "./session/manager";
import { McpToolAdapter, MultiMcpAdapter } from "./tools/mcp_client";

const logger = createNodeLogger({ service: "control-service", base: { component: "main" } });

// Initialize Services
const kafka = createKafkaClient("control-service");
const falkor = createFalkorClient();

// Initialize MCP Adapters
// 1. Wassette (Official Binary)
const wassettePath = `${process.env.HOME}/.local/bin/wassette`;
const wassetteAdapter = new McpToolAdapter(wassettePath, ["serve", "--stdio"]);

// 2. Execution Service (VFS, TimeTravel)
// Using 'npx tsx' to run the execution service script (Node.js runtime for native module compatibility)
const executionAdapter = new McpToolAdapter("npx", ["tsx", "../../apps/execution/src/index.ts"]);

// Unified Adapter
const multiAdapter = new MultiMcpAdapter();
multiAdapter.addAdapter(wassetteAdapter);
multiAdapter.addAdapter(executionAdapter);

// Initialize Core Logic
// TODO: Replace with real SearchRetriever when available or mocked properly
const contextAssembler = new ContextAssembler(
	{} as unknown as import("@engram/search-core").SearchRetriever,
	falkor,
);

const sessionManager = new SessionManager(contextAssembler, multiAdapter, falkor);

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

// Kafka Consumer
const startConsumer = async () => {
	await init();

	const consumer = await kafka.createConsumer("control-group");
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
	process.on("SIGTERM", () => {
		clearInterval(heartbeatInterval);
		redis.publishConsumerStatus("consumer_disconnected", "control-group", "control-service");
	});
	process.on("SIGINT", () => {
		clearInterval(heartbeatInterval);
		redis.publishConsumerStatus("consumer_disconnected", "control-group", "control-service");
	});

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
startConsumer().catch(console.error);
