import { describe, expect, it, vi } from "vitest";
import { requireAnyScope, requireScopes } from "./scopes";

// Mock Hono context
function createMockContext(apiKey?: { keyId: string; scopes: string[] }) {
	let responseBody: unknown;
	let responseStatus = 200;

	return {
		get: vi.fn((key: string) => {
			if (key === "apiKey") return apiKey;
			return undefined;
		}),
		json: vi.fn((body: unknown, status?: number) => {
			responseBody = body;
			responseStatus = status ?? 200;
			return { body, status: responseStatus };
		}),
		getResponseBody: () => responseBody,
		getResponseStatus: () => responseStatus,
	};
}

describe("requireScopes middleware", () => {
	it("should return 401 when no API key context exists", async () => {
		const middleware = requireScopes("memory:read");
		const ctx = createMockContext(undefined);
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
					message: "Authentication required",
				}),
			}),
			401,
		);
	});

	it("should return 403 when API key lacks required scope", async () => {
		const middleware = requireScopes("memory:write");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				success: false,
				error: expect.objectContaining({
					code: "FORBIDDEN",
					message: "Insufficient permissions",
					details: expect.objectContaining({
						required: ["memory:write"],
						missing: ["memory:write"],
						granted: ["memory:read"],
					}),
				}),
			}),
			403,
		);
	});

	it("should call next when API key has required scope", async () => {
		const middleware = requireScopes("memory:read");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read", "memory:write"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
		expect(ctx.json).not.toHaveBeenCalled();
	});

	it("should require all scopes when multiple are specified", async () => {
		const middleware = requireScopes("memory:read", "memory:write", "query:read");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read", "memory:write"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					details: expect.objectContaining({
						missing: ["query:read"],
					}),
				}),
			}),
			403,
		);
	});

	it("should pass when API key has all required scopes", async () => {
		const middleware = requireScopes("memory:read", "memory:write");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read", "memory:write", "query:read"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
	});
});

describe("requireAnyScope middleware", () => {
	it("should return 401 when no API key context exists", async () => {
		const middleware = requireAnyScope("memory:read", "memory:write");
		const ctx = createMockContext(undefined);
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					code: "UNAUTHORIZED",
				}),
			}),
			401,
		);
	});

	it("should return 403 when API key lacks all required scopes", async () => {
		const middleware = requireAnyScope("admin:write", "keys:manage");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read", "memory:write"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).not.toHaveBeenCalled();
		expect(ctx.json).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					code: "FORBIDDEN",
					details: expect.objectContaining({
						required: ["admin:write", "keys:manage"],
						granted: ["memory:read", "memory:write"],
					}),
				}),
			}),
			403,
		);
	});

	it("should call next when API key has at least one required scope", async () => {
		const middleware = requireAnyScope("memory:read", "admin:write");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["memory:read"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
	});

	it("should pass with any matching scope", async () => {
		const middleware = requireAnyScope("scope1", "scope2", "scope3");
		const ctx = createMockContext({
			keyId: "key-123",
			scopes: ["scope2"],
		});
		const next = vi.fn();

		await middleware(ctx as any, next);

		expect(next).toHaveBeenCalled();
	});
});
