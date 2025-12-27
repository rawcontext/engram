import { z } from "zod";

/**
 * Default API key for local development.
 * This key is accepted by the API when running locally without database lookup.
 */
export const LOCAL_DEV_API_KEY = "engram_dev_local_mcp";

/**
 * Default API URL - production cloud mode.
 * Override with ENGRAM_API_URL=http://localhost:6174 for local development.
 */
export const DEFAULT_API_URL = "https://api.statient.com";

/**
 * Default Observatory URL (used for OAuth device flow)
 */
export const DEFAULT_OBSERVATORY_URL = "http://localhost:6178";

/**
 * Production Observatory URL
 */
export const PRODUCTION_OBSERVATORY_URL = "https://observatory.statient.com";

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

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

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

	// Determine Observatory URL based on API URL
	// When forcing OAuth locally (ENGRAM_FORCE_OAUTH=true), will use local Observatory by default
	const observatoryUrl =
		process.env.ENGRAM_OBSERVATORY_URL ??
		(isLocalhost ? DEFAULT_OBSERVATORY_URL : PRODUCTION_OBSERVATORY_URL);

	// Auth defaults: enabled for cloud, disabled for local
	const authExplicitlySet = process.env.AUTH_ENABLED !== undefined;
	const authEnabled = authExplicitlySet ? process.env.AUTH_ENABLED === "true" : !isLocalhost;

	const rawConfig = {
		engramApiUrl: apiUrl,
		observatoryUrl,
		transport: process.env.MCP_TRANSPORT ?? "stdio",
		httpPort: process.env.MCP_HTTP_PORT ? Number.parseInt(process.env.MCP_HTTP_PORT, 10) : 3010,
		authEnabled,
		authPostgresUrl:
			process.env.AUTH_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:6183/engram",
		logLevel: process.env.LOG_LEVEL ?? "info",
	};

	return ConfigSchema.parse(rawConfig);
}
