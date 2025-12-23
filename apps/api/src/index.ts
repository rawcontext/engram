import { createNodeLogger } from "@engram/logger";
import { FalkorClient, PostgresClient } from "@engram/storage";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { loadConfig } from "./config";
import { ApiKeyRepository } from "./db/api-keys";
import { runMigrations } from "./db/migrate";
import { StateRepository } from "./db/state";
import { UsageRepository } from "./db/usage";
import { apiKeyAuth } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";
import { requireScopes } from "./middleware/scopes";
import { createApiKeyRoutes } from "./routes/api-keys";
import { createHealthRoutes } from "./routes/health";
import { createMemoryRoutes } from "./routes/memory";
import { createStateRoutes } from "./routes/state";
import { createUsageRoutes } from "./routes/usage";
import { MemoryService } from "./services/memory";

async function main() {
	const config = loadConfig();
	const logger = createNodeLogger({
		service: "engram-api",
		level: config.logLevel,
		base: { component: "api" },
	});

	logger.info({ port: config.port }, "Starting Engram Cloud API");

	// Initialize database clients
	const graphClient = new FalkorClient(config.falkordbUrl);
	await graphClient.connect();
	logger.info("Connected to FalkorDB");

	const postgresClient = new PostgresClient({ url: config.postgresUrl });
	await postgresClient.connect();
	logger.info("Connected to PostgreSQL");

	// Run database migrations
	await runMigrations(postgresClient, logger);

	// Initialize repositories
	const apiKeyRepo = new ApiKeyRepository(postgresClient);
	const usageRepo = new UsageRepository(postgresClient);
	const stateRepo = new StateRepository(postgresClient);

	// Initialize services
	const memoryService = new MemoryService({
		graphClient,
		searchUrl: config.searchUrl,
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
	protectedRoutes.use("*", apiKeyAuth({ logger, apiKeyRepo }));
	protectedRoutes.use("*", rateLimiter({ redisUrl: config.redisUrl, logger }));

	// Memory routes - require memory scopes
	protectedRoutes.route("/memory", createMemoryRoutes({ memoryService, logger }));

	// Usage routes - any authenticated key can view usage
	protectedRoutes.route("/usage", createUsageRoutes({ usageRepo, logger }));

	// API key management routes - require keys:manage scope
	const keyManagementRoutes = new Hono();
	keyManagementRoutes.use("*", requireScopes("keys:manage"));
	keyManagementRoutes.route("/", createApiKeyRoutes({ apiKeyRepo, logger }));
	protectedRoutes.route("/keys", keyManagementRoutes);

	// OpenTofu state routes - uses Basic Auth (password = API key with state:write scope)
	app.route("/v1/tofu", createStateRoutes({ stateRepo, apiKeyRepo, logger }));

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
		await postgresClient.disconnect();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	// Use basic logger since main() may have failed before logger was created
	const fallbackLogger = createNodeLogger({
		service: "engram-api",
		level: "error",
		base: { component: "api" },
	});
	fallbackLogger.error({ err }, "Fatal error");
	process.exit(1);
});
