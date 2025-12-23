import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { createApiKeyRoutes } from "./api-keys";

// Mock API key context middleware
const mockApiKeyContext = {
	keyId: "key-123",
	keyPrefix: "engram_live_...",
	keyType: "live" as const,
	scopes: ["keys:manage"],
	rateLimit: 60,
	userId: "user-123",
};

function createApp(apiKeyRepo: any) {
	const mockLogger = {
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
	};

	const app = new Hono();

	// Mock auth middleware
	app.use("*", async (c, next) => {
		c.set("apiKey", mockApiKeyContext);
		await next();
	});

	app.route("/keys", createApiKeyRoutes({ apiKeyRepo, logger: mockLogger as any }));

	return app;
}

describe("API Key Routes", () => {
	describe("GET /keys", () => {
		it("should list API keys for authenticated user", async () => {
			const mockApiKeyRepo = {
				listByUser: mock().mockResolvedValue([
					{
						id: "key-1",
						keyPrefix: "engram_live_123",
						keyType: "live",
						name: "Production Key",
						description: "Main API key",
						scopes: ["memory:read", "memory:write"],
						rateLimitRpm: 60,
						isActive: true,
						expiresAt: null,
						createdAt: new Date("2024-01-01"),
						updatedAt: new Date("2024-01-01"),
						lastUsedAt: new Date("2024-01-10"),
						keyHash: "secret-hash-should-not-be-exposed",
						userId: "user-123",
					},
					{
						id: "key-2",
						keyPrefix: "engram_test_456",
						keyType: "test",
						name: "Test Key",
						description: null,
						scopes: ["memory:read"],
						rateLimitRpm: 20,
						isActive: true,
						expiresAt: new Date("2024-12-31"),
						createdAt: new Date("2024-01-01"),
						updatedAt: new Date("2024-01-01"),
						lastUsedAt: null,
						keyHash: "another-secret-hash",
						userId: "user-123",
					},
				]),
			};

			const app = createApp(mockApiKeyRepo);
			const res = await app.request("/keys");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.keys).toHaveLength(2);
			expect(body.data.keys[0].id).toBe("key-1");
			expect(body.data.keys[0].keyPrefix).toBe("engram_live_123");
			expect(body.data.keys[0].name).toBe("Production Key");
			expect(body.data.keys[0].scopes).toEqual(["memory:read", "memory:write"]);

			// Verify sensitive data is not exposed
			expect(body.data.keys[0].keyHash).toBeUndefined();
			expect(body.data.keys[0].userId).toBeUndefined();

			expect(mockApiKeyRepo.listByUser).toHaveBeenCalledWith("user-123");
		});

		it("should return 403 if API key has no userId", async () => {
			const mockApiKeyRepo = {
				listByUser: mock(),
			};

			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("apiKey", { ...mockApiKeyContext, userId: undefined });
				await next();
			});
			app.route(
				"/keys",
				createApiKeyRoutes({ apiKeyRepo: mockApiKeyRepo, logger: mockLogger as any }),
			);

			const res = await app.request("/keys");

			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("FORBIDDEN");
			expect(body.error.message).toBe("API key is not associated with a user");
			expect(mockApiKeyRepo.listByUser).not.toHaveBeenCalled();
		});

		it("should handle database errors", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockApiKeyRepo = {
				listByUser: mock().mockRejectedValue(new Error("Database error")),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("apiKey", mockApiKeyContext);
				await next();
			});
			app.route(
				"/keys",
				createApiKeyRoutes({ apiKeyRepo: mockApiKeyRepo, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/keys");
			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe("POST /keys/revoke", () => {
		it("should revoke API key successfully", async () => {
			const mockApiKeyRepo = {
				listByUser: mock().mockResolvedValue([
					{
						id: "key-to-revoke",
						keyPrefix: "engram_live_abc",
						userId: "user-123",
					},
				]),
				revoke: mock().mockResolvedValue(undefined),
			};

			const app = createApp(mockApiKeyRepo);
			const res = await app.request("/keys/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keyId: "key-to-revoke" }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.keyId).toBe("key-to-revoke");
			expect(body.data.revoked).toBe(true);
			expect(mockApiKeyRepo.revoke).toHaveBeenCalledWith("key-to-revoke");
		});

		it("should return 400 for invalid request body", async () => {
			const mockApiKeyRepo = {
				listByUser: mock(),
				revoke: mock(),
			};

			const app = createApp(mockApiKeyRepo);
			const res = await app.request("/keys/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keyId: "" }), // Empty keyId is invalid
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("VALIDATION_ERROR");
			expect(mockApiKeyRepo.revoke).not.toHaveBeenCalled();
		});

		it("should return 403 if API key has no userId", async () => {
			const mockApiKeyRepo = {
				listByUser: mock(),
				revoke: mock(),
			};

			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("apiKey", { ...mockApiKeyContext, userId: undefined });
				await next();
			});
			app.route(
				"/keys",
				createApiKeyRoutes({ apiKeyRepo: mockApiKeyRepo, logger: mockLogger as any }),
			);

			const res = await app.request("/keys/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keyId: "some-key" }),
			});

			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("FORBIDDEN");
			expect(mockApiKeyRepo.listByUser).not.toHaveBeenCalled();
			expect(mockApiKeyRepo.revoke).not.toHaveBeenCalled();
		});

		it("should return 404 if key not found or not owned by user", async () => {
			const mockApiKeyRepo = {
				listByUser: mock().mockResolvedValue([
					{
						id: "key-1",
						keyPrefix: "engram_live_abc",
						userId: "user-123",
					},
				]),
				revoke: mock(),
			};

			const app = createApp(mockApiKeyRepo);
			const res = await app.request("/keys/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keyId: "non-existent-key" }),
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.success).toBe(false);
			expect(body.error.code).toBe("NOT_FOUND");
			expect(body.error.message).toContain("not found");
			expect(mockApiKeyRepo.revoke).not.toHaveBeenCalled();
		});

		it("should handle database errors", async () => {
			const mockLogger = {
				debug: mock(),
				info: mock(),
				warn: mock(),
				error: mock(),
			};

			const mockApiKeyRepo = {
				listByUser: mock().mockRejectedValue(new Error("Database error")),
				revoke: mock(),
			};

			const app = new Hono();
			app.use("*", async (c, next) => {
				c.set("apiKey", mockApiKeyContext);
				await next();
			});
			app.route(
				"/keys",
				createApiKeyRoutes({ apiKeyRepo: mockApiKeyRepo, logger: mockLogger as any }),
			);

			// Add error handler to catch thrown errors
			app.onError((err, c) => {
				return c.json({ error: err.message }, 500);
			});

			const res = await app.request("/keys/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ keyId: "some-key" }),
			});
			expect(res.status).toBe(500);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
