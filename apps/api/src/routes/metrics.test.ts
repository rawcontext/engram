import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { createMetricsRoutes, trackRequest } from "./metrics";

// Mock logger
const createMockLogger = () => ({
	info: mock(() => {}),
	warn: mock(() => {}),
	error: mock(() => {}),
	debug: mock(() => {}),
});

// Mock FalkorDB client
const createMockGraphClient = () => ({
	query: mock(() => Promise.resolve([{ count: 42 }])),
});

describe("Metrics Routes", () => {
	describe("GET /", () => {
		it("should return system metrics overview", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.requests).toBeDefined();
			expect(body.data.errors).toBeDefined();
			expect(body.data.latency).toBeDefined();
			expect(body.data.sessions).toBeDefined();
			expect(body.data.graph).toBeDefined();
		});

		it("should include graph counts", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics");
			const body = await res.json();

			expect(body.data.graph.memories).toBe(42);
			expect(body.data.graph.sessions).toBe(42);
			expect(body.data.graph.turns).toBe(42);
		});
	});

	describe("GET /server", () => {
		it("should return server resource metrics", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/server");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.current).toBeDefined();
			expect(body.data.current.cpu).toBeDefined();
			expect(body.data.current.memory).toBeDefined();
			expect(body.data.history).toBeDefined();
			expect(body.data.thresholds).toBeDefined();
		});

		it("should respect time range parameter", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/server?range=6h");
			const body = await res.json();

			expect(body.meta.timeRange).toBe("6h");
		});

		it("should include CPU cores count", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/server");
			const body = await res.json();

			expect(body.data.current.cpu.cores).toBeGreaterThan(0);
		});
	});

	describe("GET /performance", () => {
		it("should return performance analytics", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/performance");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.percentiles).toBeDefined();
			expect(body.data.latencyDistribution).toBeDefined();
			expect(body.data.strategyComparison).toBeDefined();
		});

		it("should include P50, P90, P99 latency metrics", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/performance");
			const body = await res.json();

			const percentiles = body.data.percentiles;
			const ids = percentiles.map((p: any) => p.id);
			expect(ids).toContain("p50");
			expect(ids).toContain("p90");
			expect(ids).toContain("p99");
		});

		it("should include latency distribution buckets", async () => {
			const logger = createMockLogger();
			const graphClient = createMockGraphClient();
			const app = new Hono();
			app.route(
				"/v1/metrics",
				createMetricsRoutes({
					logger: logger as any,
					graphClient: graphClient as any,
				}),
			);

			const res = await app.request("/v1/metrics/performance");
			const body = await res.json();

			const distribution = body.data.latencyDistribution;
			expect(distribution.length).toBeGreaterThan(0);
			expect(distribution[0].range).toBeDefined();
			expect(distribution[0].count).toBeDefined();
			expect(distribution[0].percentage).toBeDefined();
		});
	});
});

describe("trackRequest", () => {
	it("should track request metrics", () => {
		// This function modifies module-level state
		// Just verify it doesn't throw
		expect(() => trackRequest(100, false)).not.toThrow();
		expect(() => trackRequest(50, true)).not.toThrow();
	});
});
