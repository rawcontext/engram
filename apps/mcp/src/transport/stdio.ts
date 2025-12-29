/**
 * Stdio Transport for MCP Server
 *
 * Uses the MCP SDK's StdioServerTransport for local CLI-based communication.
 * This is the default transport for MCP servers running as CLI tools.
 */

import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export interface StdioTransportOptions {
	mcpServer: McpServer;
	logger: Logger;
}

export interface StdioTransportResult {
	transport: StdioServerTransport;
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

/**
 * Create a stdio transport for the MCP server
 *
 * Note: All logging MUST go to stderr (fd 2) as stdout is reserved
 * for JSON-RPC protocol messages.
 */
export async function createStdioTransport(
	options: StdioTransportOptions,
): Promise<StdioTransportResult> {
	const { mcpServer, logger } = options;

	const transport = new StdioServerTransport();

	return {
		transport,
		start: async () => {
			await mcpServer.connect(transport);
			logger.info("Stdio transport connected");
		},
		stop: async () => {
			await transport.close();
			logger.info("Stdio transport closed");
		},
	};
}
