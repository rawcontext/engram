import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { OAuthAuthContext } from "../middleware/auth";
import { createAdminRoutes } from "./admin";

// Mock logger
const createMockLogger = () => ({
	info: mock(() => {}),
	warn: mock(() => {}),
	error: mock(() => {}),
	debug: mock(() => {}),
});

// Mock auth context middleware
const withAuth = (scopes: string[] = ["admin:read", "admin:write"]) => {
	return async (c: any, next: () => Promise<void>) => {
		const auth: OAuthAuthContext = {
			type: "oauth",
			id: "token-123",
			userId: "user-123",
			orgId: "org-123",
			scopes,
			rateLimit: 100,
			prefix: "egm_oauth_abc",
			expiresAt: new Date(Date.now() + 86400000),
		};
		c.set("auth", auth);
		await next();
	};
};

describe("Admin Routes", () => {
	describe("GET /streams", () => {
		it("should return streams data", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/streams");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.streams).toBeDefined();
			expect(Array.isArray(body.data.streams)).toBe(true);
		});

		it("should require admin:read scope", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth(["memory:read"])); // Wrong scope
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/streams");

			expect(res.status).toBe(403);
		});
	});

	describe("POST /cache/clear", () => {
		it("should clear cache with valid type", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/cache/clear", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "all" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.clearedKeys).toBe(150);
		});

		it("should return 400 for invalid cache type", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/cache/clear", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "invalid" }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should require admin:write scope", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth(["admin:read"])); // Read only
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/cache/clear", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ type: "all" }),
			});

			expect(res.status).toBe(403);
		});
	});

	describe("POST /consumers/reset", () => {
		it("should reset consumer with valid stream", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/consumers/reset", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stream: "events.raw" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.stream).toBe("events.raw");
			expect(body.data.consumer).toBe("events-raw-consumer");
		});

		it("should return 400 for empty stream name", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/consumers/reset", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ stream: "" }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("GET /health", () => {
		it("should return extended health status", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/health");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.status).toBe("ok");
			expect(body.data.dependencies).toBeDefined();
			expect(body.data.dependencies.falkordb).toBeDefined();
			expect(body.data.dependencies.nats).toBeDefined();
			expect(body.data.uptime).toBeDefined();
		});
	});

	describe("GET /memories (admin cross-tenant)", () => {
		it("should return 503 when memory service not configured", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/memories");

			expect(res.status).toBe(503);
			const body = await res.json();
			expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
		});

		it("should list memories when service configured", async () => {
			const logger = createMockLogger();
			const mockMemoryService = {
				listMemoriesAdmin: mock(() => Promise.resolve([{ id: "mem-1", content: "test memory" }])),
			};
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/admin",
				createAdminRoutes({
					logger: logger as any,
					memoryService: mockMemoryService as any,
				}),
			);

			const res = await app.request("/v1/admin/memories");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.memories).toHaveLength(1);
		});

		it("should validate query parameters", async () => {
			const logger = createMockLogger();
			const mockMemoryService = {
				listMemoriesAdmin: mock(() => Promise.resolve([])),
			};
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/admin",
				createAdminRoutes({
					logger: logger as any,
					memoryService: mockMemoryService as any,
				}),
			);

			const res = await app.request("/v1/admin/memories?limit=200");

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should audit cross-tenant access", async () => {
			const logger = createMockLogger();
			const mockMemoryService = {
				listMemoriesAdmin: mock(() => Promise.resolve([])),
			};
			const mockAuditClient = {
				logCrossTenantRead: mock(() => Promise.resolve()),
			};
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/admin",
				createAdminRoutes({
					logger: logger as any,
					memoryService: mockMemoryService as any,
					auditClient: mockAuditClient as any,
				}),
			);

			await app.request("/v1/admin/memories?orgId=other-org");

			expect(mockAuditClient.logCrossTenantRead).toHaveBeenCalled();
		});
	});

	describe("GET /sessions (admin cross-tenant)", () => {
		it("should return 503 when memory service not configured", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/admin", createAdminRoutes({ logger: logger as any }));

			const res = await app.request("/v1/admin/sessions");

			expect(res.status).toBe(503);
		});

		it("should list sessions when service configured", async () => {
			const logger = createMockLogger();
			const mockMemoryService = {
				listSessionsAdmin: mock(() =>
					Promise.resolve([{ id: "sess-1", agentType: "claude-code" }]),
				),
			};
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/admin",
				createAdminRoutes({
					logger: logger as any,
					memoryService: mockMemoryService as any,
				}),
			);

			const res = await app.request("/v1/admin/sessions");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.sessions).toHaveLength(1);
		});
	});
});
