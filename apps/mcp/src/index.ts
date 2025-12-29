/**
 * Engram MCP Server Entry Point
 *
 * Supports two transport modes:
 * - stdio: Default for CLI usage (no auth needed)
 * - http: For remote access with OAuth 2.1 authentication
 */

import {
	createSessionStore,
	createTokenVerifier,
	hasValidCredentials,
	mountAuthRouter,
	requireBearerAuth,
	skipAuthForLocalhost,
} from "./auth";
import { detectMode, isLocalhostUrl, loadConfig } from "./config";
import { createEngramMcpServer } from "./server";
import {
	createTransport,
	type HttpTransportResult,
	isHttpTransport,
	isStdioTransport,
} from "./transport";

async function main() {
	const config = loadConfig();
	const mode = detectMode(config);

	const engramServer = createEngramMcpServer({ config });
	const { server, cloudClient, logger, deviceFlowClient, tokenCache } = engramServer;

	// In cloud mode, authenticate via OAuth device flow (for outbound API calls)
	if (mode === "cloud") {
		const hasCredentials = hasValidCredentials(logger);
		logger.debug(
			{ hasCredentials, cachePath: tokenCache?.getPath() },
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

	// Connect to Engram API (both local and cloud modes)
	await cloudClient.connect();
	logger.info({ mode }, "Connected to Engram API");

	// Create session store for HTTP transport
	const sessionStore =
		config.transport === "http"
			? createSessionStore({
					logger,
					sessionTtlMs: config.sessionTtlSeconds * 1000,
					maxSessionsPerUser: config.maxSessionsPerUser,
				})
			: undefined;

	// Create transport
	const transport = await createTransport({
		config,
		mcpServer: server,
		logger,
		sessionStore,
	});

	// Configure HTTP transport with OAuth if enabled
	if (isHttpTransport(transport)) {
		const httpTransport = transport as HttpTransportResult;
		const { app } = httpTransport;

		// Mount OAuth metadata endpoints
		if (config.authServerUrl && config.mcpServerUrl) {
			await mountAuthRouter(app, {
				serverUrl: config.mcpServerUrl,
				authServerUrl: config.authServerUrl,
				resourceName: "Engram MCP Server",
				documentationUrl: "https://github.com/rawcontext/engram/tree/main/apps/mcp",
				logger,
			});
		}

		// Configure authentication middleware
		if (config.authEnabled) {
			if (!config.mcpClientSecret) {
				logger.warn(
					"Auth is enabled but ENGRAM_MCP_CLIENT_SECRET is not set. Token verification will fail.",
				);
			}

			// Skip auth for localhost in development
			if (isLocalhostUrl(config.mcpServerUrl ?? "")) {
				app.use(skipAuthForLocalhost(logger));
			}

			// Create token verifier
			const verifier = createTokenVerifier({
				introspectionEndpoint: `${config.authServerUrl}/api/auth/introspect`,
				clientId: config.mcpClientId ?? "mcp-server",
				clientSecret: config.mcpClientSecret ?? "",
				resourceServerUrl: config.mcpServerUrl ?? `http://localhost:${config.httpPort}`,
				logger,
				skipAudienceValidation: isLocalhostUrl(config.mcpServerUrl ?? ""),
			});

			// Apply auth middleware to MCP endpoints
			app.use(
				"/mcp",
				requireBearerAuth({
					verifier,
					serverUrl: config.mcpServerUrl ?? `http://localhost:${config.httpPort}`,
					requiredScopes: [], // All scopes are optional by default
					logger,
					skipPaths: [], // Auth required for all /mcp paths
				}),
			);

			logger.info("OAuth authentication enabled for HTTP transport");
		} else {
			logger.info("OAuth authentication disabled for HTTP transport");
		}
	}

	// Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down...");

		try {
			// Stop transport
			await transport.stop();

			// Shutdown session store
			if (sessionStore) {
				sessionStore.shutdown();
			}

			// Disconnect from API
			await cloudClient.disconnect();
			logger.info("Disconnected from Engram API");
		} catch (error) {
			logger.error({ error }, "Error during shutdown");
		}

		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));

	// Start transport
	await transport.start();

	if (isStdioTransport(transport)) {
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
		logger.info(
			{ port: config.httpPort, authEnabled: config.authEnabled },
			"Engram MCP server running on HTTP",
		);
	}
}

main().catch((error) => {
	// Use stderr for fatal errors (stdout reserved for MCP protocol)
	console.error("Fatal error:", error);
	process.exit(1);
});
