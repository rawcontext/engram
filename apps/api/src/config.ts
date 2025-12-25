import { z } from "zod";

export const ConfigSchema = z.object({
	// Server settings
	port: z.number().int().min(1).max(65535).default(6174),

	// Database connections
	falkordbUrl: z.string().url().default("redis://localhost:6179"),
	postgresUrl: z.string().default("postgresql://postgres:postgres@localhost:6183/engram"),
	redisUrl: z.string().url().default("redis://localhost:6179"),

	// Search service (internal, no auth required)
	searchUrl: z.string().url().default("http://localhost:6176"),

	// Logging
	logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

	// Rate limiting defaults
	rateLimitRpm: z.number().int().default(60),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
	return ConfigSchema.parse({
		port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 6174,
		falkordbUrl: process.env.FALKORDB_URL ?? "redis://localhost:6179",
		postgresUrl: process.env.POSTGRES_URL ?? "postgresql://postgres:postgres@localhost:6183/engram",
		redisUrl: process.env.REDIS_URL ?? "redis://localhost:6179",
		searchUrl: process.env.SEARCH_URL ?? "http://localhost:6176",
		logLevel: process.env.LOG_LEVEL ?? "info",
		rateLimitRpm: process.env.RATE_LIMIT_RPM ? Number.parseInt(process.env.RATE_LIMIT_RPM, 10) : 60,
	});
}
