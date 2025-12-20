import { createLogger, type Logger } from "@engram/logger";
import { FalkorClient, type GraphClient } from "@engram/storage";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type ClientCapabilities,
	createSessionContext,
	detectClientCapabilities,
	ElicitationService,
	RootsService,
	SamplingService,
	type SessionContext,
} from "./capabilities";
import { type Config, detectMode } from "./config";
import { registerPrimePrompt, registerRecapPrompt, registerWhyPrompt } from "./prompts";
import {
	registerFileHistoryResource,
	registerMemoryResource,
	registerSessionResource,
} from "./resources";
import { MemoryRetriever, MemoryStore } from "./services";
import { EngramCloudClient } from "./services/cloud";
import type { IEngramClient, IMemoryRetriever, IMemoryStore } from "./services/interfaces";
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
	cloudClient?: IEngramClient;
	logger?: Logger;
}

export interface EngramMcpServer {
	server: McpServer;
	mode: "cloud" | "local";
	graphClient: GraphClient | null;
	memoryStore: IMemoryStore;
	memoryRetriever: IMemoryRetriever;
	cloudClient: IEngramClient | null;
	logger: Logger;
	sessionContext: SessionContext;
	// Capability services
	sampling: SamplingService;
	elicitation: ElicitationService;
	roots: RootsService;
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

	// Detect mode
	const mode = detectMode(config);
	logger.info({ mode }, "Initializing Engram MCP server");

	let graphClient: GraphClient | null = null;
	let memoryStore: IMemoryStore;
	let memoryRetriever: IMemoryRetriever;
	let cloudClient: IEngramClient | null = null;

	if (mode === "cloud") {
		// Cloud mode: use API client
		if (!config.engramApiKey) {
			throw new Error("ENGRAM_API_KEY is required for cloud mode");
		}
		if (!config.engramApiUrl) {
			throw new Error("ENGRAM_API_URL is required for cloud mode");
		}

		cloudClient =
			options.cloudClient ??
			new EngramCloudClient({
				apiKey: config.engramApiKey,
				baseUrl: config.engramApiUrl,
				logger,
			});

		// Cloud client implements both interfaces
		memoryStore = cloudClient;
		memoryRetriever = cloudClient;

		logger.info({ apiUrl: config.engramApiUrl }, "Using cloud mode");
	} else {
		// Local mode: direct connections
		graphClient = options.graphClient ?? new FalkorClient(config.falkordbUrl);

		memoryStore =
			options.memoryStore ??
			new MemoryStore({
				graphClient,
				logger,
			});

		memoryRetriever =
			options.memoryRetriever ??
			new MemoryRetriever({
				graphClient,
				logger,
				searchPyUrl: config.searchPyUrl,
			});

		logger.info(
			{ falkordbUrl: config.falkordbUrl, searchPyUrl: config.searchPyUrl },
			"Using local mode",
		);
	}

	// Create MCP server
	const server = new McpServer({
		name: "engram",
		version: "1.0.0",
	});

	// Initialize capability services
	const sampling = new SamplingService(server, logger);
	const elicitation = new ElicitationService(server, logger);
	const roots = new RootsService(server, logger);

	// Initialize session context with default capabilities
	// This will be updated when we receive client info
	const sessionContext = createSessionContext({
		sampling: false,
		elicitation: false,
		roots: false,
		resources: true,
		prompts: true,
	});

	// Set up roots change handler to update session context
	roots.onRootsChanged((newRoots) => {
		sessionContext.roots = newRoots.map((r) => r.uri);
		if (newRoots.length > 0) {
			sessionContext.workingDir = newRoots[0].path;
			sessionContext.project = roots.primaryProject;
		}
	});

	// Helper to get current session context
	const getSessionContext = () => ({
		sessionId: sessionContext.sessionId,
		workingDir: sessionContext.workingDir ?? roots.primaryWorkingDir,
		project: sessionContext.project ?? roots.primaryProject,
	});

	// Register tools
	// Use type assertion for memoryStore since local MemoryStore implements IMemoryStore
	registerRememberTool(server, memoryStore as MemoryStore, getSessionContext);
	registerRecallTool(server, memoryRetriever as MemoryRetriever, getSessionContext);

	// Query tool and resources need graph client - only available in local mode
	if (mode === "local" && graphClient) {
		registerQueryTool(server, graphClient);
		registerContextTool(
			server,
			memoryRetriever as MemoryRetriever,
			graphClient,
			getSessionContext,
			sampling,
		);

		// Register resources (local mode only - require direct graph access)
		registerMemoryResource(server, graphClient);
		registerSessionResource(server, graphClient, getSessionContext);
		registerFileHistoryResource(server, graphClient);

		// Register prompts (local mode only - require direct graph access)
		registerPrimePrompt(server, memoryRetriever as MemoryRetriever, graphClient, getSessionContext);
		registerRecapPrompt(server, graphClient, getSessionContext);
		registerWhyPrompt(server, memoryRetriever as MemoryRetriever, getSessionContext);
	} else if (mode === "cloud" && cloudClient) {
		// Cloud mode: register query tool using cloud client
		// Note: Resources and prompts are not available in cloud mode currently
		// They could be added by proxying through the API

		logger.info(
			"Cloud mode: query, resources, and prompts are limited. Use remember/recall tools.",
		);
	}

	logger.info({ mode }, "Engram MCP server initialized");

	return {
		server,
		mode,
		graphClient,
		memoryStore,
		memoryRetriever,
		cloudClient,
		logger,
		sessionContext,
		sampling,
		elicitation,
		roots,
	};
}

/**
 * Update client capabilities after connection and enable services
 */
export async function updateClientCapabilities(
	engramServer: EngramMcpServer,
	clientInfo?: { name?: string; version?: string },
): Promise<ClientCapabilities> {
	const capabilities = detectClientCapabilities(clientInfo, undefined, engramServer.logger);
	engramServer.sessionContext.capabilities = capabilities;

	// Enable capability services based on detected capabilities
	if (capabilities.sampling) {
		engramServer.sampling.enable();
	}
	if (capabilities.elicitation) {
		engramServer.elicitation.enable();
	}
	if (capabilities.roots) {
		engramServer.roots.enable();
		// Immediately refresh roots
		await engramServer.roots.refreshRoots();
	}

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
