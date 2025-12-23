/**
 * HTTP server entry point for Engram MCP Ingest API
 *
 * This provides HTTP endpoints for passive event capture from hooks.
 * MCP clients should connect via stdio transport (the default).
 *
 * Endpoints:
 * - GET  /health         - Health check
 * - POST /ingest/event   - Generic event ingestion
 * - POST /ingest/tool    - Tool call events
 * - POST /ingest/prompt  - User prompts
 * - POST /ingest/session - Session lifecycle events
 */

import { createNodeLogger } from "@engram/logger";
import { FalkorClient } from "@engram/storage";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { createIngestRouter } from "./ingest";
import { MemoryStore } from "./services";

async function main() {
	const config = loadConfig();

	const logger = createNodeLogger({
		service: "engram-mcp",
		level: config.logLevel,
		base: { component: "mcp-http-server" },
	});

	logger.info({ port: config.httpPort }, "Starting Engram MCP HTTP ingest server");

	// Initialize dependencies
	const graphClient = new FalkorClient(config.falkordbUrl);
	const memoryStore = new MemoryStore({ graphClient, logger });

	// Create the ingest router with auth
	const { app, close: closeRouter } = createIngestRouter({
		memoryStore,
		graphClient,
		logger,
		authEnabled: config.authEnabled,
		authPostgresUrl: config.authPostgresUrl,
	});

	// Start the server
	const server = serve({
		fetch: app.fetch,
		port: config.httpPort,
	});

	logger.info(
		{
			port: config.httpPort,
			endpoints: [
				"GET  /health",
				"POST /ingest/event",
				"POST /ingest/tool",
				"POST /ingest/prompt",
				"POST /ingest/session",
			],
		},
		"HTTP ingest server started",
	);

	// Handle shutdown
	const shutdown = async () => {
		logger.info("Shutting down...");
		server.close();
		await closeRouter();
		await graphClient.disconnect().catch(() => {});
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("Failed to start HTTP server:", err);
	process.exit(1);
});
