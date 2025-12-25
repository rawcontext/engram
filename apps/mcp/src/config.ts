import { z } from "zod";

/**
 * Default API key for local development.
 * This key is accepted by the API when running locally without database lookup.
 */
export const LOCAL_DEV_API_KEY = "engram_dev_local_mcp";

/**
 * Default API URL for local development.
 */
export const LOCAL_API_URL = "http://localhost:6174";

export const ConfigSchema = z.object({
	// Operation mode: cloud (remote API) or local (localhost API)
	mode: z.enum(["cloud", "local"]).optional(),

	// API settings
	engramApiKey: z.string().optional(),
	engramApiUrl: z.string().url().optional(),

	// Transport mode
	transport: z.enum(["stdio", "http"]).default("stdio"),

	// HTTP server settings
	httpPort: z.number().int().min(1).max(65535).default(3010),

	// HTTP authentication
	authEnabled: z.boolean().default(true),
	authPostgresUrl: z.string().optional(),

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Check if a URL points to localhost
 */
function isLocalhostUrl(url: string | undefined): boolean {
	if (!url) return false;
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
 * Detect whether to run in cloud or local mode
 *
 * Priority:
 * 1. Explicit ENGRAM_MODE env var
 * 2. If ENGRAM_API_URL is localhost → local mode
 * 3. If ENGRAM_API_URL is remote → cloud mode (API key required)
 * 4. Default to local mode
 */
export function detectMode(config: Partial<Config>): "cloud" | "local" {
	// Explicit mode takes precedence
	if (config.mode) {
		return config.mode;
	}

	const apiUrl = config.engramApiUrl ?? process.env.ENGRAM_API_URL;

	// If URL points to localhost, use local mode
	if (isLocalhostUrl(apiUrl)) {
		return "local";
	}

	// If remote URL is set, use cloud mode (API key will be validated separately)
	if (apiUrl) {
		return "cloud";
	}

	// Default to local
	return "local";
}

export function loadConfig(): Config {
	// Detect mode first to determine defaults
	const explicitMode = process.env.ENGRAM_MODE as "cloud" | "local" | undefined;
	const apiUrl = process.env.ENGRAM_API_URL;
	const apiKey = process.env.ENGRAM_API_KEY;
	const isLocalhost = isLocalhostUrl(apiUrl);

	// Infer mode from URL: localhost = local, remote = cloud
	let mode: "cloud" | "local";
	if (explicitMode) {
		mode = explicitMode;
	} else if (isLocalhost) {
		mode = "local";
	} else if (apiUrl) {
		mode = "cloud";
	} else {
		mode = "local";
	}

	// Cloud mode requires explicit API key
	if (mode === "cloud" && !apiKey) {
		throw new Error("ENGRAM_API_KEY is required for cloud mode");
	}

	// Auth defaults: enabled for cloud, disabled for local
	// Explicit AUTH_ENABLED env var always takes precedence
	const authExplicitlySet = process.env.AUTH_ENABLED !== undefined;
	const authEnabled = authExplicitlySet ? process.env.AUTH_ENABLED === "true" : mode === "cloud";

	const rawConfig = {
		mode: explicitMode,
		// Local mode: use defaults, Cloud mode: require explicit values
		engramApiKey: apiKey ?? (mode === "local" ? LOCAL_DEV_API_KEY : undefined),
		engramApiUrl: apiUrl ?? (mode === "local" ? LOCAL_API_URL : undefined),
		transport: process.env.MCP_TRANSPORT ?? "stdio",
		httpPort: process.env.MCP_HTTP_PORT ? Number.parseInt(process.env.MCP_HTTP_PORT, 10) : 3010,
		authEnabled,
		authPostgresUrl:
			process.env.AUTH_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:6183/engram",
		logLevel: process.env.LOG_LEVEL ?? "info",
	};

	return ConfigSchema.parse(rawConfig);
}
