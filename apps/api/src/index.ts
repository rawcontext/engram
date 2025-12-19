import { createLogger } from "@engram/logger";
import { FalkorClient } from "@engram/storage";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { loadConfig } from "./config";
import { apiKeyAuth } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";
import { createHealthRoutes } from "./routes/health";
import { createMemoryRoutes } from "./routes/memory";
import { MemoryService } from "./services/memory";

async function main() {
	const config = loadConfig();
	const logger = createLogger({ level: config.logLevel, component: "api" });

	logger.info({ port: config.port }, "Starting Engram Cloud API");

	// Initialize database clients
	const graphClient = new FalkorClient(config.falkordbUrl);
	await graphClient.connect();
	logger.info("Connected to FalkorDB");

	// Initialize services
	const memoryService = new MemoryService({
		graphClient,
		qdrantUrl: config.qdrantUrl,
		logger,
	});

	// Create Hono app
	const app = new Hono();

	// Global middleware
	app.use("*", cors());
	app.use("*", honoLogger());

	// Health routes (no auth)
	app.route("/v1", createHealthRoutes());

	// Protected routes
	const protectedRoutes = new Hono();
	protectedRoutes.use("*", apiKeyAuth({ logger }));
	protectedRoutes.use("*", rateLimiter({ redisUrl: config.redisUrl, logger }));
	protectedRoutes.route("/memory", createMemoryRoutes({ memoryService, logger }));
	app.route("/v1", protectedRoutes);

	// Global error handler
	app.onError((err, c) => {
		logger.error({ error: err }, "Unhandled error");
		return c.json(
			{
				success: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "An internal error occurred",
				},
			},
			500,
		);
	});

	// 404 handler
	app.notFound((c) => {
		return c.json(
			{
				success: false,
				error: {
					code: "NOT_FOUND",
					message: "Endpoint not found",
				},
			},
			404,
		);
	});

	// Start server
	serve({ fetch: app.fetch, port: config.port });
	logger.info({ port: config.port }, "Engram Cloud API ready");

	// Graceful shutdown
	const shutdown = async () => {
		logger.info("Shutting down...");
		await graphClient.disconnect();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
