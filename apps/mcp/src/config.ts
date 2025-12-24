import { z } from "zod";

export const ConfigSchema = z.object({
	// Operation mode: cloud (API client) or local (direct connections)
	mode: z.enum(["cloud", "local"]).optional(),

	// Cloud mode settings
	engramApiKey: z.string().optional(),
	engramApiUrl: z.string().url().optional(),

	// Transport mode
	transport: z.enum(["stdio", "http"]).default("stdio"),

	// HTTP server settings
	httpPort: z.number().int().min(1).max(65535).default(3010),

	// HTTP authentication
	authEnabled: z.boolean().default(true),
	authPostgresUrl: z.string().optional(),

	// Local mode: Database connections
	falkordbUrl: z.string().url().default("redis://localhost:6179"),
	qdrantUrl: z.string().url().default("http://localhost:6180"),
	searchUrl: z.string().url().default("http://localhost:6176"),
	searchApiKey: z.string().optional(),

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Detect whether to run in cloud or local mode
 *
 * Priority:
 * 1. Explicit ENGRAM_MODE env var
 * 2. If ENGRAM_API_KEY is set, use cloud mode
 * 3. Default to local mode
 */
export function detectMode(config: Partial<Config>): "cloud" | "local" {
	// Explicit mode takes precedence
	if (config.mode) {
		return config.mode;
	}

	// If API key is set, use cloud mode
	if (config.engramApiKey || process.env.ENGRAM_API_KEY) {
		return "cloud";
	}

	// Default to local
	return "local";
}

export function loadConfig(): Config {
	const rawConfig = {
		mode: process.env.ENGRAM_MODE as "cloud" | "local" | undefined,
		engramApiKey: process.env.ENGRAM_API_KEY,
		engramApiUrl: process.env.ENGRAM_API_URL,
		transport: process.env.MCP_TRANSPORT ?? "stdio",
		httpPort: process.env.MCP_HTTP_PORT ? Number.parseInt(process.env.MCP_HTTP_PORT, 10) : 3010,
		authEnabled: process.env.AUTH_ENABLED !== "false",
		authPostgresUrl:
			process.env.AUTH_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:6183/engram",
		falkordbUrl: process.env.FALKORDB_URL ?? "redis://localhost:6179",
		qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6180",
		searchUrl: process.env.SEARCH_URL ?? "http://localhost:6176",
		searchApiKey: process.env.SEARCH_API_KEY,
		logLevel: process.env.LOG_LEVEL ?? "info",
	};

	return ConfigSchema.parse(rawConfig);
}
