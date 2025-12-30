import { createNodeLogger } from "@engram/logger";
import { FalkorClient, PostgresClient, TenantAwareFalkorClient } from "@engram/storage";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger as honoLogger } from "hono/logger";
import { loadConfig } from "./config";
import { runMigrations } from "./db/migrate";
import { OAuthTokenRepository } from "./db/oauth-tokens";
import { OrganizationRepository } from "./db/organizations";
import { StateRepository } from "./db/state";
import { UsageRepository } from "./db/usage";
import { auth } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";
import { createAdminRoutes } from "./routes/admin";
import { createAlertsRoutes } from "./routes/alerts";
import { createDeploymentsRoutes } from "./routes/deployments";
import { createHealthRoutes } from "./routes/health";
import { createMemoryRoutes } from "./routes/memory";
import { createMetricsRoutes } from "./routes/metrics";
import { createOrganizationRoutes } from "./routes/organizations";
import { createStateRoutes } from "./routes/state";
import { createUsageRoutes } from "./routes/usage";
import { AuditClient } from "./services/audit";
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
	const oauthTokenRepo = new OAuthTokenRepository(postgresClient);
	const organizationRepo = new OrganizationRepository(postgresClient);
	const usageRepo = new UsageRepository(postgresClient);
	const stateRepo = new StateRepository(postgresClient);

	// Initialize tenant-aware FalkorDB client for multi-tenant graph isolation
	const tenantClient = new TenantAwareFalkorClient(graphClient);

	// Initialize services
	const memoryService = new MemoryService({
		graphClient,
		tenantClient,
		searchUrl: config.searchUrl,
		logger,
	});

	// Initialize audit client for cross-tenant access logging
	const auditClient = new AuditClient({
		logger,
		databaseUrl: config.postgresUrl,
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
	protectedRoutes.use("*", auth({ logger, oauthTokenRepo }));
	protectedRoutes.use("*", rateLimiter({ redisUrl: config.redisUrl, logger }));

	// Memory routes - require memory scopes
	protectedRoutes.route("/memory", createMemoryRoutes({ memoryService, logger }));

	// Organization routes - require org scopes
	protectedRoutes.route("/organizations", createOrganizationRoutes({ organizationRepo, logger }));

	// Usage routes - any authenticated token can view usage
	protectedRoutes.route("/usage", createUsageRoutes({ usageRepo, logger }));

	// Metrics routes - infrastructure monitoring
	protectedRoutes.route("/metrics", createMetricsRoutes({ graphClient, logger }));

	// Admin routes - cache management, NATS streams, cross-tenant access
	protectedRoutes.route(
		"/admin",
		createAdminRoutes({ logger, redisUrl: config.redisUrl, memoryService, auditClient }),
	);

	// Alerts routes - alert rules, notification channels, history
	protectedRoutes.route("/alerts", createAlertsRoutes({ postgresClient, logger }));

	// Deployments routes - deployment history
	protectedRoutes.route("/deployments", createDeploymentsRoutes({ logger }));

	// OpenTofu state routes - uses Basic Auth (password = OAuth token with state:write scope)
	app.route("/v1/tofu", createStateRoutes({ stateRepo, oauthTokenRepo, logger }));

	app.route("/v1", protectedRoutes);

	// Global error handler
	app.onError((err, c) => {
		// Handle HTTPException (from basicAuth, etc.) - return proper status
		if (err instanceof HTTPException) {
			return err.getResponse();
		}

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
		await auditClient.close();
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
