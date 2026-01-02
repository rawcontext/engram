import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { OAuthAuthContext } from "../middleware/auth";
import { createAlertsRoutes } from "./alerts";

// Mock logger
const createMockLogger = () => ({
	info: mock(() => {}),
	warn: mock(() => {}),
	error: mock(() => {}),
	debug: mock(() => {}),
});

// Mock postgres client
const createMockPostgresClient = () => ({
	query: mock(() => Promise.resolve({ rows: [] })),
	queryOne: mock(() => Promise.resolve(null)),
});

// Mock auth context middleware
const withAuth = (scopes: string[] = ["alerts:read", "alerts:write"]) => {
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

describe("Alerts Routes", () => {
	describe("GET /rules", () => {
		it("should list all alert rules", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.rules).toBeDefined();
			expect(Array.isArray(body.data.rules)).toBe(true);
		});

		it("should require alerts:read scope", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth(["memory:read"]));
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules");

			expect(res.status).toBe(403);
		});
	});

	describe("POST /rules", () => {
		it("should create a new alert rule", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test Rule",
					metric: "error_rate",
					condition: "greater_than",
					threshold: 10,
					duration: 60,
					severity: "warning",
					channels: ["ch-1"],
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBeDefined();
		});

		it("should validate rule schema", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "", // Invalid: empty
					metric: "error_rate",
					condition: "invalid_condition", // Invalid
					threshold: "not a number", // Invalid
					duration: 0, // Invalid: must be >= 1
					severity: "super_critical", // Invalid
					channels: [],
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should require alerts:write scope", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth(["alerts:read"]));
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test Rule",
					metric: "error_rate",
					condition: "greater_than",
					threshold: 10,
					duration: 60,
					severity: "warning",
					channels: [],
				}),
			});

			expect(res.status).toBe(403);
		});
	});

	describe("PATCH /rules/:id", () => {
		it("should return 404 for non-existent rule", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules/non-existent", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});

			expect(res.status).toBe(404);
		});

		it("should update existing rule", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			// rule-1 is pre-populated in the in-memory store
			const res = await app.request("/v1/alerts/rules/rule-1", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated High Latency" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	describe("DELETE /rules/:id", () => {
		it("should return 404 for non-existent rule", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/rules/non-existent", {
				method: "DELETE",
			});

			expect(res.status).toBe(404);
		});
	});

	describe("GET /channels", () => {
		it("should list all notification channels", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/channels");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.channels).toBeDefined();
			expect(Array.isArray(body.data.channels)).toBe(true);
		});
	});

	describe("POST /channels", () => {
		it("should create a new notification channel", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/channels", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "Test Slack Channel",
					type: "slack",
					config: { webhookUrl: "https://hooks.slack.com/test" },
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBeDefined();
		});

		it("should validate channel schema", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/channels", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "",
					type: "invalid_type",
					config: {},
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});
	});

	describe("POST /channels/:id/test", () => {
		it("should return 404 for non-existent channel", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/channels/non-existent/test", {
				method: "POST",
			});

			expect(res.status).toBe(404);
		});

		it("should test existing channel", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			// ch-1 is pre-populated
			const res = await app.request("/v1/alerts/channels/ch-1/test", {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.message).toContain("Test notification sent");
		});
	});

	describe("GET /history", () => {
		it("should return alert history", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/history");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.alerts).toBeDefined();
			expect(Array.isArray(body.data.alerts)).toBe(true);
		});

		it("should respect limit parameter", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/history?limit=1");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.alerts.length).toBeLessThanOrEqual(1);
		});
	});

	describe("POST /history/:id/acknowledge", () => {
		it("should return 404 for non-existent alert", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			const res = await app.request("/v1/alerts/history/non-existent/acknowledge", {
				method: "POST",
			});

			expect(res.status).toBe(404);
		});

		it("should acknowledge existing alert", async () => {
			const logger = createMockLogger();
			const postgresClient = createMockPostgresClient();
			const app = new Hono();
			app.use("*", withAuth());
			app.route(
				"/v1/alerts",
				createAlertsRoutes({ logger: logger as any, postgresClient: postgresClient as any }),
			);

			// hist-1 is pre-populated
			const res = await app.request("/v1/alerts/history/hist-1/acknowledge", {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});
});
