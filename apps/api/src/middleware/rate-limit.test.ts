import { Hono } from "hono";
import { describe, expect, it, mock } from "bun:test";
import { rateLimiter } from "./rate-limit";

// Mock Redis client
const createMockRedisClient = () => {
	const mockClient = {
		isOpen: false,
		connect: mock().mockResolvedValue(undefined),
		on: mock(),
		multi: mock(),
		quit: mock(),
	};

	const mockPipeline = {
		zRemRangeByScore: mock().mockReturnThis(),
		zAdd: mock().mockReturnThis(),
		zCard: mock().mockReturnThis(),
		expire: mock().mockReturnThis(),
		exec: mock(),
	};

	mockClient.multi.mockReturnValue(mockPipeline);

	return { mockClient, mockPipeline };
};

vi.mock("redis", () => ({
	createClient: mock(),
}));

describe("Rate Limiter Middleware", () => {
	it("should allow request when under rate limit", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockClient.isOpen = true;
		mockPipeline.exec.mockResolvedValue([null, null, 5, null]); // 5 requests in window

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("55"); // 60 - 5
		expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
	});

	it("should block request when rate limit exceeded", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockClient.isOpen = true;
		mockPipeline.exec.mockResolvedValue([null, null, 61, null]); // 61 requests in window

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
		expect(res.headers.get("Retry-After")).toBeTruthy();
		expect(mockLogger.warn).toHaveBeenCalled();
	});

	it("should skip rate limiting when no API key context", async () => {
		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		// Should not set rate limit headers when skipped
		expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
	});

	it("should connect to Redis on first request", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockPipeline.exec.mockResolvedValue([null, null, 1, null]);

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		expect(mockClient.connect).toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith("Redis rate limiter connected");
	});

	it("should reuse existing Redis connection", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		// Initially not open, will be opened on first request
		mockPipeline.exec.mockResolvedValue([null, null, 1, null]);

		let connectCalled = 0;
		mockClient.connect.mockImplementation(async () => {
			connectCalled++;
			mockClient.isOpen = true;
		});

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const middleware = rateLimiter({
			redisUrl: "redis://localhost:6379",
			logger: mockLogger as any,
		});

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", middleware);
		app.get("/test", (c) => c.json({ success: true }));

		// Make multiple requests
		await app.request("/test");
		await app.request("/test");

		// Should only connect once (on first request)
		expect(connectCalled).toBe(1);
	});

	it("should register error handler on Redis client", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockPipeline.exec.mockResolvedValue([null, null, 1, null]);

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		await app.request("/test");

		expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
	});

	it("should allow request if Redis is unavailable", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockPipeline.exec.mockRejectedValue(new Error("Redis connection failed"));

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		expect(mockLogger.error).toHaveBeenCalledWith(
			{ error: expect.any(Error) },
			"Rate limiting failed, allowing request",
		);
	});

	it("should set correct rate limit key based on key prefix", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockClient.isOpen = true;
		mockPipeline.exec.mockResolvedValue([null, null, 1, null]);

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_test_xyz",
				rateLimit: 20,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		await app.request("/test");

		expect(mockPipeline.zRemRangeByScore).toHaveBeenCalledWith(
			"ratelimit:engram_test_xyz",
			expect.any(Number),
			expect.any(Number),
		);
	});

	it("should handle Redis connection failure gracefully", async () => {
		const { mockClient } = createMockRedisClient();
		mockClient.connect.mockRejectedValue(new Error("Connection failed"));

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		const res = await app.request("/test");

		expect(res.status).toBe(200);
		expect(mockLogger.error).toHaveBeenCalled();
	});

	it("should set expiry on rate limit key", async () => {
		const { mockClient, mockPipeline } = createMockRedisClient();
		mockClient.isOpen = true;
		mockPipeline.exec.mockResolvedValue([null, null, 1, null]);

		const { createClient } = await import("redis");
		(createClient as any).mockReturnValue(mockClient);

		const mockLogger = {
			debug: mock(),
			info: mock(),
			warn: mock(),
			error: mock(),
		};

		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("apiKey", {
				keyId: "key-123",
				keyPrefix: "engram_live_abc",
				rateLimit: 60,
			});
			await next();
		});
		app.use("*", rateLimiter({ redisUrl: "redis://localhost:6379", logger: mockLogger as any }));
		app.get("/test", (c) => c.json({ success: true }));

		await app.request("/test");

		expect(mockPipeline.expire).toHaveBeenCalledWith("ratelimit:engram_live_abc", 120); // 2 minutes
	});
});
