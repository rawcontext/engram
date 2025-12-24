import type { Logger } from "@engram/logger";

/**
 * Detected client capabilities based on MCP negotiation
 */
export interface ClientCapabilities {
	/** Client supports sampling (LLM requests from server) */
	sampling: boolean;
	/** Client supports elicitation (user input requests) */
	elicitation: boolean;
	/** Client supports roots (workspace boundaries) */
	roots: boolean;
	/** Client supports resources */
	resources: boolean;
	/** Client supports prompts */
	prompts: boolean;
	/** Client name if available */
	clientName?: string;
	/** Client version if available */
	clientVersion?: string;
}

/**
 * Known client capability matrix based on
 * https://github.com/apify/mcp-client-capabilities
 */
const KNOWN_CLIENTS: Record<string, Partial<ClientCapabilities>> = {
	"vscode-copilot": {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: true,
		prompts: true,
	},
	vscode: {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: true,
		prompts: true,
	},
	code: {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: true,
		prompts: true,
	},
	"visual studio code": {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: true,
		prompts: true,
	},
	cursor: {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: true,
		prompts: true,
	},
	"claude-code": {
		sampling: false,
		elicitation: false,
		roots: true,
		resources: true,
		prompts: true,
	},
	codex: {
		sampling: false, // Unknown, assume false
		elicitation: false, // Unknown, assume false
		roots: true,
		resources: true,
		prompts: true,
	},
	gemini: {
		sampling: false, // Unknown, assume false
		elicitation: false, // Unknown, assume false
		roots: true,
		resources: true,
		prompts: true,
	},
	windsurf: {
		sampling: false,
		elicitation: false,
		roots: false,
		resources: false,
		prompts: false,
	},
	zed: {
		sampling: false,
		elicitation: false,
		roots: false,
		resources: false,
		prompts: true,
	},
	jetbrains: {
		sampling: true,
		elicitation: true,
		roots: true,
		resources: false,
		prompts: false,
	},
	cline: {
		sampling: false,
		elicitation: false,
		roots: false,
		resources: true,
		prompts: false,
	},
};

/**
 * Default capabilities when client is unknown
 */
const DEFAULT_CAPABILITIES: ClientCapabilities = {
	sampling: false,
	elicitation: false,
	roots: false,
	resources: true,
	prompts: true,
};

/**
 * Detect client capabilities from initialization info
 */
export function detectClientCapabilities(
	clientInfo?: { name?: string; version?: string },
	serverCapabilities?: { sampling?: unknown; elicitation?: unknown },
	logger?: Logger,
): ClientCapabilities {
	const clientName = clientInfo?.name?.toLowerCase() ?? "";
	const clientVersion = clientInfo?.version;

	// Try to match against known clients
	for (const [pattern, caps] of Object.entries(KNOWN_CLIENTS)) {
		if (clientName.includes(pattern)) {
			const capabilities = {
				...DEFAULT_CAPABILITIES,
				...caps,
				clientName: clientInfo?.name,
				clientVersion,
			};
			logger?.info({ clientName, capabilities }, "Detected known client capabilities");
			return capabilities;
		}
	}

	// Unknown client - use defaults with any negotiated capabilities
	const capabilities: ClientCapabilities = {
		...DEFAULT_CAPABILITIES,
		sampling: Boolean(serverCapabilities?.sampling),
		elicitation: Boolean(serverCapabilities?.elicitation),
		clientName: clientInfo?.name,
		clientVersion,
	};

	logger?.info(
		{ clientName: clientInfo?.name, capabilities },
		"Using default capabilities for unknown client",
	);
	return capabilities;
}

/**
 * Session context tracked per-connection
 */
export interface SessionContext {
	/** Current session ID */
	sessionId?: string;
	/** Current working directory */
	workingDir?: string;
	/** Current project identifier */
	project?: string;
	/** Registered roots */
	roots: string[];
	/** Client capabilities */
	capabilities: ClientCapabilities;
}

export function createSessionContext(capabilities: ClientCapabilities): SessionContext {
	return {
		roots: [],
		capabilities,
	};
}

export {
	type ConfirmationOptions,
	type ElicitationResult,
	ElicitationService,
	type SelectionOption,
} from "./elicitation";
export { type Root, RootsService } from "./roots";
// Export capability services
export { type SamplingOptions, type SamplingResult, SamplingService } from "./sampling";
