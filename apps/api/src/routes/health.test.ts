import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import { createHealthRoutes } from "./health";

describe("Health Routes", () => {
	it("should return healthy status on GET /health", async () => {
		const app = new Hono();
		app.route("/v1", createHealthRoutes());

		const res = await app.request("/v1/health");

		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe("healthy");
		expect(body.data.service).toBe("engram-api");
		expect(body.data.version).toBe("0.0.1");
		expect(body.data.timestamp).toBeDefined();
	});

	it("should return valid ISO timestamp", async () => {
		const app = new Hono();
		app.route("/v1", createHealthRoutes());

		const res = await app.request("/v1/health");
		const body = await res.json();

		const timestamp = new Date(body.data.timestamp);
		expect(timestamp.toISOString()).toBe(body.data.timestamp);
		expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it("should respond to health check quickly", async () => {
		const app = new Hono();
		app.route("/v1", createHealthRoutes());

		const start = performance.now();
		await app.request("/v1/health");
		const duration = performance.now() - start;

		// Health check should be fast (< 100ms)
		expect(duration).toBeLessThan(100);
	});
});
