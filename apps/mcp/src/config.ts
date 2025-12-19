import { z } from "zod";

export const ConfigSchema = z.object({
	// Transport mode
	transport: z.enum(["stdio", "http"]).default("stdio"),

	// HTTP server settings
	httpPort: z.number().int().min(1).max(65535).default(3010),

	// Database connections
	falkordbUrl: z.string().url().default("redis://localhost:6379"),
	qdrantUrl: z.string().url().default("http://localhost:6333"),

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
	return ConfigSchema.parse({
		transport: process.env.MCP_TRANSPORT ?? "stdio",
		httpPort: process.env.MCP_HTTP_PORT ? Number.parseInt(process.env.MCP_HTTP_PORT, 10) : 3010,
		falkordbUrl: process.env.FALKORDB_URL ?? "redis://localhost:6379",
		qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
		logLevel: process.env.LOG_LEVEL ?? "info",
	});
}
