import { z } from "zod";

/**
 * @deprecated Legacy dev API key pattern. OAuth 2.1 is now required.
 * Local development uses client credentials flow via Observatory.
 */
export const LOCAL_DEV_API_KEY = "";

/**
 * Default API URL - production cloud mode.
 * Override with ENGRAM_API_URL=http://localhost:6174 for local development.
 */
export const DEFAULT_API_URL = "https://api.engram.rawcontext.com";

/**
 * Default Observatory URL (used for OAuth device flow)
 */
export const DEFAULT_OBSERVATORY_URL = "http://localhost:6178";

/**
 * Production Observatory URL
 */
export const PRODUCTION_OBSERVATORY_URL = "https://observatory.engram.rawcontext.com";

export const ConfigSchema = z.object({
	// API URL - localhost = local mode, remote = cloud mode (OAuth required)
	engramApiUrl: z.string().url(),

	// Observatory URL (for OAuth device flow in cloud mode)
	observatoryUrl: z.string().url(),

	// Transport mode
	transport: z.enum(["stdio", "http"]).default("stdio"),

	// HTTP server settings
	httpPort: z.number().int().min(1).max(65535).default(3010),

	// HTTP authentication (for HTTP transport mode)
	authEnabled: z.boolean().default(true),
	authPostgresUrl: z.string().optional(),

	// OAuth server configuration (for HTTP transport inbound auth)
	authServerUrl: z.string().url().optional(),
	mcpServerUrl: z.string().url().optional(),
	mcpClientId: z.string().optional(),
	mcpClientSecret: z.string().optional(),

	// Session configuration
	sessionTtlSeconds: z.number().int().min(60).default(3600),
	maxSessionsPerUser: z.number().int().min(1).default(10),

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Configuration for conflict detection during remember operations.
 */
export interface ConflictDetectionConfig {
	/** Enable conflict detection during remember operations */
	enabled: boolean;
	/** Minimum similarity score to consider as potential conflict (0-1) */
	similarityThreshold: number;
	/** Maximum number of candidate memories to check */
	maxCandidates: number;
	/** Require user confirmation before resolving conflicts */
	requireConfirmation: boolean;
	/** Enable verbose logging for debugging */
	verboseLogging: boolean;
}

/**
 * Default conflict detection configuration.
 */
export const defaultConflictDetectionConfig: ConflictDetectionConfig = {
	enabled: true,
	similarityThreshold: 0.65,
	maxCandidates: 10,
	requireConfirmation: false,
	verboseLogging: false,
};

/**
 * Check if a URL points to localhost
 */
export function isLocalhostUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname === "localhost" ||
			parsed.hostname === "127.0.0.1" ||
			parsed.hostname === "::1" ||
			parsed.hostname.endsWith(".localhost")
		);
	} catch {
		return false;
	}
}

/**
 * Detect whether to run in cloud or local mode based on API URL.
 * - localhost URLs → local mode (uses dev API key, no OAuth)
 * - Remote URLs → cloud mode (OAuth required)
 * - ENGRAM_FORCE_OAUTH=true → cloud mode (forces OAuth for local testing)
 */
export function detectMode(config: Config): "cloud" | "local" {
	// Allow forcing OAuth mode for local testing
	if (process.env.ENGRAM_FORCE_OAUTH === "true") {
		return "cloud";
	}
	return isLocalhostUrl(config.engramApiUrl) ? "local" : "cloud";
}

export function loadConfig(): Config {
	const apiUrl = process.env.ENGRAM_API_URL ?? DEFAULT_API_URL;
	const isLocalhost = isLocalhostUrl(apiUrl);
	const transport = process.env.MCP_TRANSPORT ?? "stdio";
	const httpPort = process.env.MCP_HTTP_PORT
		? Number.parseInt(process.env.MCP_HTTP_PORT, 10)
		: 3010;

	// Determine Observatory URL based on API URL
	// When forcing OAuth locally (ENGRAM_FORCE_OAUTH=true), will use local Observatory by default
	const observatoryUrl =
		process.env.ENGRAM_OBSERVATORY_URL ??
		(isLocalhost ? DEFAULT_OBSERVATORY_URL : PRODUCTION_OBSERVATORY_URL);

	// Auth defaults: enabled for cloud/HTTP, disabled for local/stdio
	const authExplicitlySet = process.env.AUTH_ENABLED !== undefined;
	const authEnabled = authExplicitlySet
		? process.env.AUTH_ENABLED === "true"
		: transport === "http" && !isLocalhost;

	// MCP server URL (for OAuth resource metadata)
	const mcpServerUrl =
		process.env.ENGRAM_MCP_SERVER_URL ??
		(isLocalhost ? `http://localhost:${httpPort}` : "https://mcp.engram.rawcontext.com");

	// Auth server URL (defaults to Observatory)
	const authServerUrl =
		process.env.ENGRAM_AUTH_SERVER_URL ??
		(isLocalhost ? observatoryUrl : "https://auth.engram.rawcontext.com");

	const rawConfig = {
		engramApiUrl: apiUrl,
		observatoryUrl,
		transport,
		httpPort,
		authEnabled,
		authPostgresUrl:
			process.env.AUTH_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:6183/engram",
		// OAuth server configuration
		authServerUrl,
		mcpServerUrl,
		mcpClientId: process.env.ENGRAM_MCP_CLIENT_ID ?? "mcp-server",
		mcpClientSecret: process.env.ENGRAM_MCP_CLIENT_SECRET,
		// Session configuration
		sessionTtlSeconds: process.env.SESSION_TTL_SECONDS
			? Number.parseInt(process.env.SESSION_TTL_SECONDS, 10)
			: 3600,
		maxSessionsPerUser: process.env.MAX_SESSIONS_PER_USER
			? Number.parseInt(process.env.MAX_SESSIONS_PER_USER, 10)
			: 10,
		logLevel: process.env.LOG_LEVEL ?? "info",
	};

	return ConfigSchema.parse(rawConfig);
}
