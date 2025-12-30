import type { Logger } from "@engram/logger";
import pino from "pino";

/**
 * Create a logger specifically for MCP servers using stdio transport.
 * CRITICAL: All logs MUST go to stderr - stdout is reserved for JSON-RPC protocol.
 */
function createMcpLogger(options: {
	service: string;
	level?: string;
	base?: Record<string, unknown>;
}): Logger {
	const { service, level = "info", base = {} } = options;
	const isDev = process.env.NODE_ENV !== "production";

	return pino(
		{
			level,
			formatters: {
				level(label) {
					return { severity: label.toUpperCase() };
				},
				bindings(bindings) {
					const { pid: _pid, hostname: _hostname, ...rest } = bindings;
					return { service, ...base, ...rest };
				},
			},
			timestamp: pino.stdTimeFunctions.isoTime,
			// For MCP: use stderr destination with pino-pretty transport
			transport: isDev
				? {
						target: "pino-pretty",
						options: {
							destination: 2, // fd 2 = stderr
							colorize: true,
							translateTime: "SYS:standard",
							ignore: "pid,hostname",
							levelFirst: true,
							messageFormat: "{component} - {msg}",
						},
					}
				: undefined,
		},
		// In production, write JSON directly to stderr
		isDev ? undefined : pino.destination(2),
	) as Logger;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeviceFlowClient, TokenCache } from "./auth";
import {
	type ClientCapabilities,
	createSessionContext,
	detectClientCapabilities,
	ElicitationService,
	RootsService,
	SamplingService,
	type SessionContext,
} from "./capabilities";
import { type Config, detectMode, LOCAL_DEV_API_KEY } from "./config";
import { registerPrimePrompt, registerRecapPrompt, registerWhyPrompt } from "./prompts";
import {
	registerFileHistoryResource,
	registerMemoryResource,
	registerSessionResource,
} from "./resources";
import { EngramCloudClient } from "./services/cloud";
import type { IEngramClient, IMemoryRetriever, IMemoryStore } from "./services/interfaces";
import {
	registerContextTool,
	registerEnrichMemoryTool,
	registerExtractFactsTool,
	registerQueryTool,
	registerRecallTool,
	registerRememberTool,
	registerSummarizeTool,
} from "./tools";

export interface EngramMcpServerOptions {
	config: Config;
	cloudClient?: IEngramClient;
	logger?: Logger;
	/** Pre-configured token cache (for testing) */
	tokenCache?: TokenCache;
	/** Pre-configured device flow client (for testing) */
	deviceFlowClient?: DeviceFlowClient;
}

export interface EngramMcpServer {
	server: McpServer;
	mode: "cloud" | "local";
	memoryStore: IMemoryStore;
	memoryRetriever: IMemoryRetriever;
	cloudClient: IEngramClient;
	logger: Logger;
	sessionContext: SessionContext;
	// Capability services
	sampling: SamplingService;
	elicitation: ElicitationService;
	roots: RootsService;
	// OAuth support
	tokenCache?: TokenCache;
	deviceFlowClient?: DeviceFlowClient;
}

export function createEngramMcpServer(options: EngramMcpServerOptions): EngramMcpServer {
	const { config } = options;

	// Initialize logger - MUST use stderr for MCP stdio transport
	// stdout is reserved for JSON-RPC protocol messages
	const logger =
		options.logger ??
		createMcpLogger({
			service: "engram-mcp",
			level: config.logLevel,
			base: { component: "mcp-server" },
		});

	// Detect mode based on API URL (localhost = local, remote = cloud)
	const mode = detectMode(config);
	logger.info({ mode, apiUrl: config.engramApiUrl }, "Initializing Engram MCP server");

	// Initialize OAuth components for cloud mode
	let tokenCache: TokenCache | undefined;
	let deviceFlowClient: DeviceFlowClient | undefined;

	if (mode === "cloud") {
		tokenCache = options.tokenCache ?? new TokenCache({ logger });
		deviceFlowClient =
			options.deviceFlowClient ??
			new DeviceFlowClient({
				apiUrl: config.observatoryUrl,
				logger,
				tokenCache,
			});
		logger.debug({ observatoryUrl: config.observatoryUrl }, "OAuth device flow initialized");
	}

	// Create API client
	let cloudClient: IEngramClient;
	if (options.cloudClient) {
		cloudClient = options.cloudClient;
	} else if (mode === "local") {
		// Local mode: use dev API key (no OAuth needed)
		cloudClient = new EngramCloudClient({
			apiKey: LOCAL_DEV_API_KEY,
			baseUrl: config.engramApiUrl,
			logger,
		});
	} else {
		// Cloud mode: use OAuth tokens
		cloudClient = new EngramCloudClient({
			baseUrl: config.engramApiUrl,
			logger,
			tokenCache,
			deviceFlowClient,
		});
	}

	// Cloud client implements both store and retriever interfaces
	const memoryStore: IMemoryStore = cloudClient;
	const memoryRetriever: IMemoryRetriever = cloudClient;

	logger.info({ mode }, mode === "local" ? "Using local API" : "Using cloud API with OAuth");

	// Create MCP server
	const mcpServer = new McpServer({
		name: "engram",
		version: "1.0.0",
	});

	// Initialize capability services
	const sampling = new SamplingService(mcpServer, logger);
	const elicitation = new ElicitationService(mcpServer, logger);
	const roots = new RootsService(mcpServer, logger);

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
	const getSessionContext = () => {
		// Update sampling capability dynamically based on client negotiation
		sessionContext.capabilities.sampling = sampling.enabled;

		return {
			sessionId: sessionContext.sessionId,
			workingDir: sessionContext.workingDir ?? roots.primaryWorkingDir,
			project: sessionContext.project ?? roots.primaryProject,
			capabilities: sessionContext.capabilities,
			roots: sessionContext.roots,
			orgId: sessionContext.orgId,
			orgSlug: sessionContext.orgSlug,
		};
	};

	// Register core tools
	registerRememberTool(mcpServer, memoryStore, getSessionContext);
	registerRecallTool(mcpServer, memoryRetriever, getSessionContext, elicitation);

	// Register sampling-based tools (available when client supports sampling)
	registerSummarizeTool(mcpServer, sampling);
	registerExtractFactsTool(mcpServer, sampling);
	registerEnrichMemoryTool(mcpServer, sampling);

	// Register query and context tools
	registerQueryTool(mcpServer, cloudClient, getSessionContext);
	registerContextTool(mcpServer, memoryRetriever, cloudClient, getSessionContext, sampling);

	// Register resources
	registerMemoryResource(mcpServer, cloudClient);
	registerSessionResource(mcpServer, cloudClient, getSessionContext);
	registerFileHistoryResource(mcpServer, cloudClient);

	// Register prompts
	registerPrimePrompt(mcpServer, memoryRetriever, cloudClient, getSessionContext);
	registerRecapPrompt(mcpServer, cloudClient, getSessionContext);
	registerWhyPrompt(mcpServer, memoryRetriever, getSessionContext);

	logger.info({ mode }, "Engram MCP server initialized");

	return {
		server: mcpServer,
		mode,
		memoryStore,
		memoryRetriever,
		cloudClient,
		logger,
		sessionContext,
		sampling,
		elicitation,
		roots,
		tokenCache,
		deviceFlowClient,
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
