import { describe, expect, it, vi } from "vitest";
import { apiKeyAuth, type ApiKeyAuthOptions } from "./auth";

// Mock Hono context
function createMockContext(headers: Record<string, string> = {}) {
	const responseHeaders = new Map<string, string>();
	let responseBody: unknown;
	let responseStatus = 200;

	return {
		req: {
			header: (name: string) => headers[name],
		},
		set: vi.fn(),
		get: vi.fn(),
		json: vi.fn((body: unknown, status?: number) => {
			responseBody = body;
			responseStatus = status ?? 200;
			return { body, status: responseStatus };
		}),
		header: (name: string, value: string) => responseHeaders.set(name, value),
		getResponseBody: () => responseBody,
		getResponseStatus: () => responseStatus,
		getResponseHeaders: () => responseHeaders,
	};
}

describe("apiKeyAuth middleware", () => {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as unknown as ApiKeyAuthOptions["logger"];

	const validApiKey = "engram_live_abcdefghijklmnopqrstuvwxyz123456";

	const mockValidatedKey = {
		id: "key-uuid-123",
		keyPrefix: "engram_live_abcdefghij...",
		keyType: "live" as const,
		userId: "user-123",
		scopes: ["memory:read", "memory:write"],
		rateLimitRpm: 60,
		isActive: true,
		name: "Test Key",
		keyHash: "hash",
		createdAt: new Date(),
		updatedAt: new Date(),
		metadata: {},
	};

	it("should return 401 when Authorization header is missing", async () => {
		const mockApiKeyRepo = { validate: vi.fn() };
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
					message: "Missing Authorization header",
				}),
			}),
			401,
		);
	});

	it("should return 401 when Authorization header does not start with Bearer", async () => {
		const mockApiKeyRepo = { validate: vi.fn() };
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: "Basic abc123" });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
					message: expect.stringContaining("Invalid Authorization header format"),
				}),
			}),
			401,
		);
	});

	it("should return 401 when API key format is invalid", async () => {
		const mockApiKeyRepo = { validate: vi.fn() };
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: "Bearer invalid-key-format" });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
					message: "Invalid API key format",
				}),
			}),
			401,
		);
	});

	it("should return 500 when database validation fails", async () => {
		const mockApiKeyRepo = {
			validate: vi.fn().mockRejectedValue(new Error("Database error")),
		};
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: `Bearer ${validApiKey}` });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(mockLogger.error).toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "INTERNAL_ERROR",
				}),
			}),
			500,
		);
	});

	it("should return 401 when API key is not found in database", async () => {
		const mockApiKeyRepo = {
			validate: vi.fn().mockResolvedValue(null),
		};
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: `Bearer ${validApiKey}` });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
					message: "Invalid or expired API key",
				}),
			}),
			401,
		);
	});

	it("should call next and set apiKey context on valid authentication", async () => {
		const mockApiKeyRepo = {
			validate: vi.fn().mockResolvedValue(mockValidatedKey),
		};
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: `Bearer ${validApiKey}` });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
		expect(ctx.set).toHaveBeenCalledWith(
			"apiKey",
			expect.objectContaining({
				keyId: mockValidatedKey.id,
				keyPrefix: mockValidatedKey.keyPrefix,
				keyType: "live",
				userId: "user-123",
				scopes: ["memory:read", "memory:write"],
				rateLimit: 60,
			}),
		);
	});

	it("should accept test API keys", async () => {
		const testApiKey = "engram_test_abcdefghijklmnopqrstuvwxyz123456";
		const mockApiKeyRepo = {
			validate: vi.fn().mockResolvedValue({
				...mockValidatedKey,
				keyType: "test",
			}),
		};
		const middleware = apiKeyAuth({
			logger: mockLogger,
			apiKeyRepo: mockApiKeyRepo as unknown as ApiKeyAuthOptions["apiKeyRepo"],
		});

		const ctx = createMockContext({ Authorization: `Bearer ${testApiKey}` });
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
		expect(ctx.set).toHaveBeenCalledWith(
			"apiKey",
			expect.objectContaining({
				keyType: "test",
			}),
		);
	});
});
