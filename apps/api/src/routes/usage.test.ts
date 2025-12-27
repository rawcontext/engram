import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { createUsageRoutes } from "./usage";

// Mock auth context middleware
const mockAuthContext = {
	id: "token-123",
	prefix: "engram_oauth_...",
	method: "oauth" as const,
	type: "oauth" as const,
	userId: "user-123",
	scopes: ["memory:read", "memory:write"],
	rateLimit: 60,
};

function createApp(usageRepo: any) {
	const mockLogger = {
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
	};

	const app = new Hono();

	// Mock auth middleware
	app.use("*", async (c, next) => {
		c.set("auth", mockAuthContext);
		await next();
	});

	app.route("/usage", createUsageRoutes({ usageRepo, logger: mockLogger as any }));

	return app;
}

describe("Usage Routes", () => {
	describe("GET /usage", () => {
		it("should return usage summary by default", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock().mockResolvedValue({
					totalRequests: 1000,
					totalErrors: 50,
					operations: {
						remember: 400,
						recall: 500,
						query: 100,
					},
					periodStart: new Date("2024-01-01"),
					periodEnd: new Date("2024-01-31"),
				}),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.summary.totalRequests).toBe(1000);
			expect(body.data.summary.totalErrors).toBe(50);
			expect(body.data.summary.errorRate).toBe(0.05); // 50/1000
			expect(body.data.summary.operations).toEqual({
				remember: 400,
				recall: 500,
				query: 100,
			});
			expect(mockUsageRepo.getUsageSummary).toHaveBeenCalledWith("token-123", {
				startDate: undefined,
				endDate: undefined,
			});
		});

		it("should calculate error rate as 0 when totalRequests is 0", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock().mockResolvedValue({
					totalRequests: 0,
					totalErrors: 0,
					operations: {},
					periodStart: new Date("2024-01-01"),
					periodEnd: new Date("2024-01-31"),
				}),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.summary.errorRate).toBe(0);
		});

		it("should pass startDate and endDate query parameters", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock().mockResolvedValue({
					totalRequests: 100,
					totalErrors: 5,
					operations: { recall: 100 },
					periodStart: new Date("2024-01-01"),
					periodEnd: new Date("2024-01-07"),
				}),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request(
				"/usage?startDate=2024-01-01T00:00:00Z&endDate=2024-01-07T23:59:59Z",
			);

			expect(res.status).toBe(200);
			expect(mockUsageRepo.getUsageSummary).toHaveBeenCalledWith("token-123", {
				startDate: new Date("2024-01-01T00:00:00Z"),
				endDate: new Date("2024-01-07T23:59:59Z"),
			});
		});

		it("should return detailed usage when granularity=detailed", async () => {
			const mockUsageRepo = {
				getUsageStats: mock().mockResolvedValue([
					{
						periodStart: new Date("2024-01-01T00:00:00Z"),
						periodEnd: new Date("2024-01-01T01:00:00Z"),
						requestCount: 50,
						errorCount: 2,
						operations: { recall: 50 },
					},
					{
						periodStart: new Date("2024-01-01T01:00:00Z"),
						periodEnd: new Date("2024-01-01T02:00:00Z"),
						requestCount: 30,
						errorCount: 1,
						operations: { remember: 30 },
					},
				]),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage?granularity=detailed");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.periods).toHaveLength(2);
			expect(body.data.periods[0].requestCount).toBe(50);
			expect(body.data.periods[0].errorCount).toBe(2);
			expect(body.data.periods[1].requestCount).toBe(30);
			expect(mockUsageRepo.getUsageStats).toHaveBeenCalledWith("token-123", {
				startDate: undefined,
				endDate: undefined,
				limit: 100,
			});
		});

		it("should pass date filters to detailed usage", async () => {
			const mockUsageRepo = {
				getUsageStats: mock().mockResolvedValue([]),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request(
				"/usage?granularity=detailed&startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z",
			);

			expect(res.status).toBe(200);
			expect(mockUsageRepo.getUsageStats).toHaveBeenCalledWith("token-123", {
				startDate: new Date("2024-01-01T00:00:00Z"),
				endDate: new Date("2024-01-31T23:59:59Z"),
				limit: 100,
			});
		});

		it("should return 400 for invalid startDate", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock(),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage?startDate=invalid-date");

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
			expect(mockUsageRepo.getUsageSummary).not.toHaveBeenCalled();
		});

		it("should return 400 for invalid endDate", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock(),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage?endDate=not-a-date");

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 for invalid granularity", async () => {
			const mockUsageRepo = {
				getUsageSummary: mock(),
			};

			const app = createApp(mockUsageRepo);
			const res = await app.request("/usage?granularity=invalid");

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should handle database errors", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockUsageRepo = {
				getUsageSummary: mock().mockRejectedValue(new Error("Database error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("auth", mockAuthContext);
				await next();
			});
			app.route(
				"/usage",
				createUsageRoutes({ usageRepo: mockUsageRepo, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/usage");
			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
