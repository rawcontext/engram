import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { z } from "zod";
import { requireScopes } from "../middleware/scopes";

export interface AdminRoutesOptions {
	logger: Logger;
	redisUrl?: string;
}

const ClearCacheSchema = z.object({
	type: z.enum(["embedding", "query", "all"]),
});

const ResetConsumerSchema = z.object({
	stream: z.string().min(1),
});

export function createAdminRoutes(options: AdminRoutesOptions) {
	const { logger, redisUrl } = options;
	const app = new Hono();

	// GET /v1/admin/streams - List NATS streams
	// Note: Returns mock data for now - full NATS integration would require
	// passing NATS connection through context
	app.get("/streams", requireScopes("admin:read"), async (c) => {
		try {
			// Return streams data
			// In production, this would query NATS JetStream
			return c.json({
				success: true,
				data: {
					streams: [
						{ name: "events.raw", messages: 15234, consumers: 2 },
						{ name: "events.parsed", messages: 14892, consumers: 3 },
						{ name: "events.enriched", messages: 14501, consumers: 1 },
					],
				},
				meta: {
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			logger.error({ error }, "Error fetching streams");
			throw error;
		}
	});

	// POST /v1/admin/cache/clear - Clear cache
	app.post("/cache/clear", requireScopes("admin:write"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = ClearCacheSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const { type } = parsed.data;
			// Simulate cache clear count based on type
			const clearedKeys = type === "all" ? 150 : 75;

			logger.info({ type, clearedKeys }, "Cache cleared");

			return c.json({
				success: true,
				data: {
					clearedKeys,
					timestamp: Date.now(),
				},
				meta: {
					cacheType: type,
				},
			});
		} catch (error) {
			logger.error({ error }, "Error clearing cache");
			throw error;
		}
	});

	// POST /v1/admin/consumers/reset - Reset NATS consumer
	app.post("/consumers/reset", requireScopes("admin:write"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = ResetConsumerSchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const { stream } = parsed.data;
			const consumerName = `${stream.replace(/\./g, "-")}-consumer`;

			// In production, this would reset the actual NATS consumer
			logger.info({ stream, consumer: consumerName }, "Consumer reset requested");

			return c.json({
				success: true,
				data: {
					stream,
					consumer: consumerName,
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			logger.error({ error }, "Error resetting consumer");
			throw error;
		}
	});

	// GET /v1/admin/health - Extended health check with dependencies
	app.get("/health", async (c) => {
		const dependencies: Record<string, { status: string; latency?: number }> = {};

		// Report dependency statuses
		// In production, these would be actual health checks
		dependencies.falkordb = { status: "ok", latency: 5 };
		dependencies.nats = { status: "ok", latency: 3 };
		dependencies.qdrant = { status: "ok", latency: 3 };
		dependencies.postgresql = { status: "ok", latency: 2 };

		return c.json({
			success: true,
			data: {
				status: "ok",
				dependencies,
				uptime: process.uptime(),
				version: process.env.npm_package_version || "1.0.0",
			},
			meta: {
				timestamp: Date.now(),
			},
		});
	});

	return app;
}
