/**
 * Transport Layer
 *
 * Factory for creating MCP transports (stdio or HTTP).
 * Handles transport selection based on configuration.
 */

export { createHttpTransport, type HttpTransportOptions, type HttpTransportResult } from "./http";
export {
	createStdioTransport,
	type StdioTransportOptions,
	type StdioTransportResult,
} from "./stdio";

import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionStore } from "../auth/session-store";
import type { Config } from "../config";
import { createHttpTransport, type HttpTransportResult } from "./http";
import { createStdioTransport, type StdioTransportResult } from "./stdio";

export type TransportResult = StdioTransportResult | HttpTransportResult;

export interface TransportFactoryOptions {
	config: Config;
	mcpServer: McpServer;
	logger: Logger;
	sessionStore?: SessionStore;
}

/**
 * Create the appropriate transport based on configuration
 */
export async function createTransport(options: TransportFactoryOptions): Promise<TransportResult> {
	const { config, mcpServer, logger, sessionStore } = options;

	if (config.transport === "http") {
		return createHttpTransport({
			port: config.httpPort,
			mcpServer,
			logger,
			serverUrl: config.mcpServerUrl ?? `http://localhost:${config.httpPort}`,
			authServerUrl: config.authServerUrl,
			sessionStore,
			authEnabled: config.authEnabled,
		});
	}

	return createStdioTransport({
		mcpServer,
		logger,
	});
}

/**
 * Type guard for HTTP transport
 */
export function isHttpTransport(transport: TransportResult): transport is HttpTransportResult {
	return "app" in transport;
}

/**
 * Type guard for stdio transport
 */
export function isStdioTransport(transport: TransportResult): transport is StdioTransportResult {
	return "transport" in transport;
}
