import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { hasValidCredentials } from "./auth";
import { detectMode, loadConfig } from "./config";
import { createEngramMcpServer } from "./server";

async function main() {
	const config = loadConfig();
	const mode = detectMode(config);

	const engramServer = createEngramMcpServer({ config });
	const { server, cloudClient, logger, deviceFlowClient, tokenCache } = engramServer;

	// In cloud mode, authenticate via OAuth device flow
	if (mode === "cloud") {
		const hasCredentials = hasValidCredentials(logger);
		logger.debug(
			{ hasCredentials, cachePath: tokenCache?.["cachePath"] },
			"Checking OAuth credentials",
		);

		if (!hasCredentials) {
			// Start device flow authentication
			if (!deviceFlowClient) {
				throw new Error("Device flow client not initialized");
			}

			logger.info("No valid credentials found, starting device flow authentication");

			const result = await deviceFlowClient.startDeviceFlow({
				openBrowser: true,
				onDisplayCode: (code, url, urlComplete) => {
					// Use stderr for prompts (stdout reserved for MCP protocol)
					console.error("\n┌─────────────────────────────────────────────────────┐");
					console.error("│  ENGRAM AUTHENTICATION REQUIRED                     │");
					console.error("│                                                     │");
					console.error(`│  Visit: ${url.padEnd(41)}│`);
					console.error(`│  Enter code: ${code.padEnd(37)}│`);
					console.error("│                                                     │");
					console.error(`│  Or open: ${urlComplete.slice(0, 39).padEnd(39)}│`);
					console.error("└─────────────────────────────────────────────────────┘\n");
				},
				onPolling: () => {
					console.error("Waiting for authorization...");
				},
				onSuccess: (email) => {
					console.error(`\n✓ Authenticated as ${email}\n`);
				},
			});

			if (!result.success) {
				throw new Error(`Authentication failed: ${result.error}`);
			}

			logger.info({ user: tokenCache?.getUser()?.email }, "Device flow authentication successful");
		} else {
			const user = tokenCache?.getUser();
			logger.info({ user: user?.email }, "Using cached OAuth credentials");
		}
	}

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
