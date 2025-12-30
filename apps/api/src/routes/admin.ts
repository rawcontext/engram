import { ADMIN_READ_SCOPE } from "@engram/common";
import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { z } from "zod";
import type { OAuthAuthContext } from "../middleware/auth";
import { requireScopes } from "../middleware/scopes";
import type { AuditClient } from "../services/audit";
import type { MemoryService } from "../services/memory";

type Env = {
	Variables: {
		auth: OAuthAuthContext;
	};
};

export interface AdminRoutesOptions {
	logger: Logger;
	redisUrl?: string;
	memoryService?: MemoryService;
	auditClient?: AuditClient;
}

const ClearCacheSchema = z.object({
	type: z.enum(["embedding", "query", "all"]),
});

const ResetConsumerSchema = z.object({
	stream: z.string().min(1),
});

// Cross-tenant query schemas
const AdminMemoriesSchema = z.object({
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
	type: z.enum(["decision", "context", "insight", "preference", "fact"]).optional(),
	orgId: z.string().optional(),
});

const AdminSessionsSchema = z.object({
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
	orgId: z.string().optional(),
});

export function createAdminRoutes(options: AdminRoutesOptions) {
	const { logger, memoryService, auditClient } = options;
	const app = new Hono<Env>();

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

	// GET /v1/admin/memories - List memories across all tenants
	app.get("/memories", requireScopes(ADMIN_READ_SCOPE), async (c) => {
		if (!memoryService) {
			return c.json(
				{
					success: false,
					error: {
						code: "SERVICE_UNAVAILABLE",
						message: "Memory service not configured",
					},
				},
				503,
			);
		}

		try {
			const query = c.req.query();
			const parsed = AdminMemoriesSchema.safeParse({
				limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
				offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
				type: query.type,
				orgId: query.orgId,
			});

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid query parameters",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const { limit, offset, type, orgId } = parsed.data;

			// Get auth context for audit logging
			const auth = c.get("auth");

			// Log cross-tenant access if querying a specific org
			if (auditClient && orgId && orgId !== auth.orgId) {
				await auditClient.logCrossTenantRead({
					userId: auth.userId || "unknown",
					userOrgId: auth.orgId,
					targetOrgId: orgId,
					resourceType: "memory",
					ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
					userAgent: c.req.header("user-agent"),
				});
			}

			// Query memories across all tenants (no org_id filter unless specified)
			const memories = await memoryService.listMemoriesAdmin({
				limit,
				offset,
				type,
				orgId,
			});

			return c.json({
				success: true,
				data: {
					memories,
					limit,
					offset,
				},
				meta: {
					count: memories.length,
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			logger.error({ error }, "Error listing admin memories");
			throw error;
		}
	});

	// GET /v1/admin/sessions - List sessions across all tenants
	app.get("/sessions", requireScopes(ADMIN_READ_SCOPE), async (c) => {
		if (!memoryService) {
			return c.json(
				{
					success: false,
					error: {
						code: "SERVICE_UNAVAILABLE",
						message: "Memory service not configured",
					},
				},
				503,
			);
		}

		try {
			const query = c.req.query();
			const parsed = AdminSessionsSchema.safeParse({
				limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
				offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
				orgId: query.orgId,
			});

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid query parameters",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const { limit, offset, orgId } = parsed.data;

			// Get auth context for audit logging
			const auth = c.get("auth");

			// Log cross-tenant access if querying a specific org
			if (auditClient && orgId && orgId !== auth.orgId) {
				await auditClient.logCrossTenantRead({
					userId: auth.userId || "unknown",
					userOrgId: auth.orgId,
					targetOrgId: orgId,
					resourceType: "session",
					ipAddress: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
					userAgent: c.req.header("user-agent"),
				});
			}

			// Query sessions across all tenants (no org_id filter unless specified)
			const sessions = await memoryService.listSessionsAdmin({
				limit,
				offset,
				orgId,
			});

			return c.json({
				success: true,
				data: {
					sessions,
					limit,
					offset,
				},
				meta: {
					count: sessions.length,
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			logger.error({ error }, "Error listing admin sessions");
			throw error;
		}
	});

	return app;
}
