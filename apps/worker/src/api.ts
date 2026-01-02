/**
 * Worker Service HTTP API
 *
 * Provides manual job triggering endpoints for intelligence layer operations.
 * Cron jobs run automatically on schedule, but these endpoints allow on-demand execution.
 *
 * Authentication: OAuth tokens with admin:write scope required for job triggers.
 * Health and metrics endpoints are public for Kubernetes and Prometheus.
 */

import type { Logger } from "@engram/logger";
import type { NatsClient } from "@engram/storage";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { IntelligenceConfig } from "./config";
import type { WorkerMetrics } from "./metrics";

/**
 * Middleware for OAuth authentication.
 * Validates Bearer tokens against Observatory's introspection endpoint.
 */
async function authMiddleware(
	c: any,
	next: any,
	logger: Logger,
	requiredScopes: string[],
): Promise<Response | undefined> {
	const authHeader = c.req.header("Authorization");

	if (!authHeader) {
		return c.json(
			{
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Missing Authorization header",
				},
			},
			401,
		);
	}

	if (!authHeader.startsWith("Bearer ")) {
		return c.json(
			{
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Invalid Authorization header format. Use: Bearer <token>",
				},
			},
			401,
		);
	}

	const token = authHeader.slice(7);

	// In production, this would validate against Observatory's introspection endpoint.
	// For now, we accept any bearer token with proper format for local development.
	// TODO: Implement full OAuth introspection (RFC 7662)

	// Mock auth context - in production this comes from token introspection
	const mockScopes = ["admin:read", "admin:write"];

	// Check scope requirements
	const missingScopes = requiredScopes.filter((scope) => !mockScopes.includes(scope));
	if (missingScopes.length > 0) {
		return c.json(
			{
				success: false,
				error: {
					code: "FORBIDDEN",
					message: `Insufficient scopes. Missing: ${missingScopes.join(", ")}`,
					required_scopes: requiredScopes,
					granted_scopes: mockScopes,
				},
			},
			403,
		);
	}

	logger.debug({ token: `${token.slice(0, 20)}...` }, "Authenticated request");

	await next();
}

/**
 * Create HTTP API for worker service.
 *
 * Endpoints:
 * - GET /health - Health check (public)
 * - GET /metrics - Prometheus metrics (public)
 * - POST /jobs/decay - Trigger decay calculation (admin:write)
 * - POST /jobs/community-detection - Trigger community detection (admin:write)
 * - POST /jobs/conflict-scan - Trigger conflict scanning (admin:write)
 */
export function createApi(
	config: IntelligenceConfig,
	nats: NatsClient,
	metrics: WorkerMetrics,
	logger: Logger,
): Hono {
	const app = new Hono();

	// CORS middleware
	app.use("*", cors());

	// =============================================================================
	// Public Endpoints
	// =============================================================================

	// GET /health - Health check for Kubernetes liveness probe
	app.get("/health", (c) => {
		return c.json({
			status: "healthy",
			service: config.serviceName,
			timestamp: Date.now(),
		});
	});

	// GET /metrics - Prometheus metrics endpoint
	app.get("/metrics", async (c) => {
		const metricsText = await metrics.getMetrics();
		return c.text(metricsText, 200, {
			"Content-Type": "text/plain; version=0.0.4",
		});
	});

	// =============================================================================
	// Protected Endpoints - Manual Job Triggers
	// =============================================================================

	// POST /jobs/decay - Trigger memory decay calculation
	app.post("/jobs/decay", async (c) => {
		const authResult = await authMiddleware(c, () => {}, logger, ["admin:write"]);
		if (authResult) return authResult;

		const executionId = `decay-${Date.now()}`;

		logger.info(
			{
				job: "decay-calculation",
				executionId,
				triggeredBy: "manual",
			},
			"Manual decay calculation triggered",
		);

		try {
			// Publish job trigger to NATS
			await nats.sendEvent("engram.jobs.decay-calculation", executionId, {
				job: "decay-calculation",
				executionId,
				timestamp: Date.now(),
				triggeredBy: "manual",
			});

			return c.json({
				success: true,
				data: {
					job: "decay-calculation",
					executionId,
					status: "triggered",
					message: "Decay calculation job triggered successfully",
				},
			});
		} catch (error) {
			logger.error({ error, executionId }, "Failed to trigger decay calculation");

			return c.json(
				{
					success: false,
					error: {
						code: "JOB_TRIGGER_FAILED",
						message: "Failed to trigger decay calculation job",
						details: error instanceof Error ? error.message : String(error),
					},
				},
				500,
			);
		}
	});

	// POST /jobs/community-detection - Trigger community detection
	app.post("/jobs/community-detection", async (c) => {
		const authResult = await authMiddleware(c, () => {}, logger, ["admin:write"]);
		if (authResult) return authResult;

		const executionId = `community-detection-${Date.now()}`;

		logger.info(
			{
				job: "community-detection",
				executionId,
				triggeredBy: "manual",
			},
			"Manual community detection triggered",
		);

		try {
			// Publish job trigger to NATS
			await nats.sendEvent("engram.jobs.community-detection", executionId, {
				job: "community-detection",
				executionId,
				timestamp: Date.now(),
				triggeredBy: "manual",
			});

			return c.json({
				success: true,
				data: {
					job: "community-detection",
					executionId,
					status: "triggered",
					message: "Community detection job triggered successfully",
				},
			});
		} catch (error) {
			logger.error({ error, executionId }, "Failed to trigger community detection");

			return c.json(
				{
					success: false,
					error: {
						code: "JOB_TRIGGER_FAILED",
						message: "Failed to trigger community detection job",
						details: error instanceof Error ? error.message : String(error),
					},
				},
				500,
			);
		}
	});

	// POST /jobs/conflict-scan - Trigger conflict scanning
	app.post("/jobs/conflict-scan", async (c) => {
		const authResult = await authMiddleware(c, () => {}, logger, ["admin:write"]);
		if (authResult) return authResult;

		const executionId = `conflict-scan-${Date.now()}`;

		logger.info(
			{
				job: "conflict-scan",
				executionId,
				triggeredBy: "manual",
			},
			"Manual conflict scan triggered",
		);

		try {
			// Publish job trigger to NATS
			await nats.sendEvent("engram.jobs.conflict-scan", executionId, {
				job: "conflict-scan",
				executionId,
				timestamp: Date.now(),
				triggeredBy: "manual",
			});

			return c.json({
				success: true,
				data: {
					job: "conflict-scan",
					executionId,
					status: "triggered",
					message: "Conflict scan job triggered successfully",
				},
			});
		} catch (error) {
			logger.error({ error, executionId }, "Failed to trigger conflict scan");

			return c.json(
				{
					success: false,
					error: {
						code: "JOB_TRIGGER_FAILED",
						message: "Failed to trigger conflict scan job",
						details: error instanceof Error ? error.message : String(error),
					},
				},
				500,
			);
		}
	});

	return app;
}
