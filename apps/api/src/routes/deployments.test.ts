import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { OAuthAuthContext } from "../middleware/auth";
import { createDeploymentsRoutes } from "./deployments";

// Mock logger
const createMockLogger = () => ({
	info: mock(() => {}),
	warn: mock(() => {}),
	error: mock(() => {}),
	debug: mock(() => {}),
});

// Mock auth context middleware
const withAuth = (scopes: string[] = ["deployments:read"]) => {
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

describe("Deployments Routes", () => {
	describe("GET /", () => {
		it("should list all deployments", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta.total).toBeGreaterThan(0);
		});

		it("should filter by environment", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments?environment=production");
			const body = await res.json();

			expect(body.success).toBe(true);
			for (const deployment of body.data) {
				expect(deployment.environment).toBe("production");
			}
		});

		it("should respect limit parameter", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments?limit=2");
			const body = await res.json();

			expect(body.data.length).toBeLessThanOrEqual(2);
		});

		it("should require deployments:read scope", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth(["memory:read"]));
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments");

			expect(res.status).toBe(403);
		});
	});

	describe("GET /:id", () => {
		it("should return single deployment", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments/dep-001");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBe("dep-001");
			expect(body.data.commitHash).toBeDefined();
			expect(body.data.environment).toBeDefined();
		});

		it("should return 404 for non-existent deployment", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments/non-existent");

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("NOT_FOUND");
		});
	});

	describe("GET /latest/:environment", () => {
		it("should return latest successful deployment for environment", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments/latest/production");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.environment).toBe("production");
			expect(body.data.status).toBe("success");
		});

		it("should return 404 for environment with no successful deployments", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments/latest/unknown-env");

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("NOT_FOUND");
		});
	});

	describe("deployment schema", () => {
		it("should include all required fields", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments/dep-001");
			const body = await res.json();
			const deployment = body.data;

			expect(deployment.id).toBeDefined();
			expect(deployment.status).toBeDefined();
			expect(deployment.commitHash).toBeDefined();
			expect(deployment.commitMessage).toBeDefined();
			expect(deployment.branch).toBeDefined();
			expect(deployment.environment).toBeDefined();
			expect(deployment.deployedAt).toBeDefined();
			expect(deployment.deployedBy).toBeDefined();
		});

		it("should have valid status values", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments");
			const body = await res.json();

			const validStatuses = ["success", "failed", "in_progress", "pending", "cancelled"];
			for (const deployment of body.data) {
				expect(validStatuses).toContain(deployment.status);
			}
		});

		it("should have valid environment values", async () => {
			const logger = createMockLogger();
			const app = new Hono();
			app.use("*", withAuth());
			app.route("/v1/deployments", createDeploymentsRoutes({ logger: logger as any }));

			const res = await app.request("/v1/deployments");
			const body = await res.json();

			const validEnvironments = ["production", "staging", "development"];
			for (const deployment of body.data) {
				expect(validEnvironments).toContain(deployment.environment);
			}
		});
	});
});
