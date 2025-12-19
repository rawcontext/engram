import { createLogger, type Logger } from "@engram/logger";
import { createFalkorClient, FalkorClient, type GraphClient } from "@engram/storage";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type ClientCapabilities,
	createSessionContext,
	detectClientCapabilities,
	type SessionContext,
} from "./capabilities";
import type { Config } from "./config";
import { MemoryRetriever, MemoryStore } from "./services";
import {
	registerContextTool,
	registerQueryTool,
	registerRecallTool,
	registerRememberTool,
} from "./tools";

export interface EngramMcpServerOptions {
	config: Config;
	graphClient?: GraphClient;
	memoryStore?: MemoryStore;
	memoryRetriever?: MemoryRetriever;
	logger?: Logger;
}

export interface EngramMcpServer {
	server: McpServer;
	graphClient: GraphClient;
	memoryStore: MemoryStore;
	memoryRetriever: MemoryRetriever;
	logger: Logger;
	sessionContext: SessionContext;
}

export function createEngramMcpServer(options: EngramMcpServerOptions): EngramMcpServer {
	const { config } = options;

	// Initialize logger
	const logger =
		options.logger ??
		createLogger({
			level: config.logLevel,
			component: "mcp-server",
		});

	// Initialize graph client (uses FALKORDB_URL env var by default)
	const graphClient = options.graphClient ?? new FalkorClient(config.falkordbUrl);

	// Initialize services
	const memoryStore =
		options.memoryStore ??
		new MemoryStore({
			graphClient,
			logger,
		});

	const memoryRetriever =
		options.memoryRetriever ??
		new MemoryRetriever({
			graphClient,
			logger,
			qdrantUrl: config.qdrantUrl,
		});

	// Create MCP server
	const server = new McpServer({
		name: "engram",
		version: "1.0.0",
	});

	// Initialize session context with default capabilities
	// This will be updated when we receive client info
	const sessionContext = createSessionContext({
		sampling: false,
		elicitation: false,
		roots: false,
		resources: true,
		prompts: true,
	});

	// Helper to get current session context
	const getSessionContext = () => ({
		sessionId: sessionContext.sessionId,
		workingDir: sessionContext.workingDir,
		project: sessionContext.project,
	});

	// Register tools
	registerRememberTool(server, memoryStore, getSessionContext);
	registerRecallTool(server, memoryRetriever, getSessionContext);
	registerQueryTool(server, graphClient);
	registerContextTool(
		server,
		memoryRetriever,
		graphClient,
		getSessionContext,
		sessionContext.capabilities,
	);

	logger.info("Engram MCP server initialized");

	return {
		server,
		graphClient,
		memoryStore,
		memoryRetriever,
		logger,
		sessionContext,
	};
}

/**
 * Update client capabilities after connection
 */
export function updateClientCapabilities(
	engramServer: EngramMcpServer,
	clientInfo?: { name?: string; version?: string },
): ClientCapabilities {
	const capabilities = detectClientCapabilities(clientInfo, undefined, engramServer.logger);
	engramServer.sessionContext.capabilities = capabilities;
	return capabilities;
}

/**
 * Update session context with project info
 */
export function updateSessionContext(
	engramServer: EngramMcpServer,
	context: { sessionId?: string; workingDir?: string; project?: string },
): void {
	if (context.sessionId) {
		engramServer.sessionContext.sessionId = context.sessionId;
	}
	if (context.workingDir) {
		engramServer.sessionContext.workingDir = context.workingDir;
		// Derive project from working directory if not set
		if (!context.project) {
			// Use the last part of the path as project name
			const parts = context.workingDir.split("/").filter(Boolean);
			engramServer.sessionContext.project = parts[parts.length - 1];
		}
	}
	if (context.project) {
		engramServer.sessionContext.project = context.project;
	}
}

/**
 * Handle roots update from client
 */
export function updateRoots(
	engramServer: EngramMcpServer,
	roots: Array<{ uri: string; name?: string }>,
): void {
	engramServer.sessionContext.roots = roots.map((r) => r.uri);

	// Update working dir and project from first root
	if (roots.length > 0) {
		const firstRoot = roots[0];
		const path = firstRoot.uri.replace(/^file:\/\//, "");
		updateSessionContext(engramServer, {
			workingDir: path,
			project: firstRoot.name ?? path.split("/").filter(Boolean).pop(),
		});
	}

	engramServer.logger.debug({ roots: engramServer.sessionContext.roots }, "Updated roots");
}
