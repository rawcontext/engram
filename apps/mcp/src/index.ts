#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config";
import { createEngramMcpServer } from "./server";

async function main() {
	const config = loadConfig();

	const engramServer = createEngramMcpServer({ config });
	const { server, graphClient, logger } = engramServer;

	// Connect to graph database
	await graphClient.connect();
	logger.info("Connected to FalkorDB");

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down...");
		try {
			await graphClient.disconnect();
			logger.info("Disconnected from FalkorDB");
		} catch (error) {
			logger.error({ error }, "Error during shutdown");
		}
		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	// Use stdio transport (default for MCP)
	if (config.transport === "stdio") {
		const transport = new StdioServerTransport();

		// The MCP SDK handles client info automatically during connection
		// We can detect capabilities when tools are called based on available features

		await server.connect(transport);
		logger.info("Engram MCP server running on stdio");
	} else {
		// HTTP transport - to be implemented in Phase 4
		logger.error("HTTP transport not yet implemented");
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
