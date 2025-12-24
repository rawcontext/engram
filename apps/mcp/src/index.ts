#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config";
import { createEngramMcpServer } from "./server";

async function main() {
	const config = loadConfig();

	const engramServer = createEngramMcpServer({ config });
	const { server, mode, graphClient, cloudClient, logger } = engramServer;

	// Connect to backend (local mode: FalkorDB, cloud mode: API)
	if (mode === "local" && graphClient) {
		await graphClient.connect();
		logger.info("Connected to FalkorDB");
	} else if (mode === "cloud" && cloudClient) {
		await cloudClient.connect();
		logger.info("Connected to Engram Cloud API");
	}

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down...");
		try {
			if (mode === "local" && graphClient) {
				await graphClient.disconnect();
				logger.info("Disconnected from FalkorDB");
			} else if (mode === "cloud" && cloudClient) {
				await cloudClient.disconnect();
				logger.info("Disconnected from Engram Cloud API");
			}
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

		await server.connect(transport);
		logger.info("Engram MCP server running on stdio");
	} else {
		// HTTP transport - to be implemented in Phase 4
		logger.error("HTTP transport not yet implemented");
		process.exit(1);
	}
}

main().catch((error) => {
	// Use stderr for fatal errors (stdout reserved for MCP protocol)
	console.error("Fatal error:", error);
	process.exit(1);
});
