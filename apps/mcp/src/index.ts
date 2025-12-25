import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config";
import { createEngramMcpServer } from "./server";

async function main() {
	const config = loadConfig();

	const engramServer = createEngramMcpServer({ config });
	const { server, mode, cloudClient, logger } = engramServer;

	// Connect to API (both local and cloud modes use API client)
	await cloudClient.connect();
	logger.info({ mode }, "Connected to Engram API");

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down...");
		try {
			await cloudClient.disconnect();
			logger.info("Disconnected from Engram API");
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

		// Update client capabilities after connection
		try {
			const { updateClientCapabilities } = await import("./server");
			const clientInfo = (server as any).server?.getClientVersion();
			await updateClientCapabilities(engramServer, clientInfo);
			logger.info({ clientInfo }, "Client capabilities updated");
		} catch (error) {
			logger.warn({ error }, "Failed to update client capabilities");
		}
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
