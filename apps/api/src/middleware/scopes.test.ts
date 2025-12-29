import { describe, expect, it, mock } from "bun:test";
import type { Context } from "hono";
import type { AuthContext } from "./auth";
import { requireAnyScope, requireScopes } from "./scopes";

describe("Scopes Middleware", () => {
	describe("requireScopes", () => {
		it("should return 401 when auth context is missing", async () => {
			const middleware = requireScopes("memory:read");

			const mockContext = {
				get: mock(() => undefined),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				401,
			);
			expect(mockNext).not.toHaveBeenCalled();
			expect(result).toEqual({
				data: {
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				status: 401,
			});
		});

		it("should return 403 when user has no required scopes", async () => {
			const middleware = requireScopes("memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"], // Missing memory:write
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write"],
							missing: ["memory:write"],
							granted: ["memory:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
			expect(result).toEqual({
				data: {
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write"],
							missing: ["memory:write"],
							granted: ["memory:read"],
						},
					},
				},
				status: 403,
			});
		});

		it("should return 403 when user has some but not all required scopes", async () => {
			const middleware = requireScopes("memory:read", "memory:write", "query:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read", "memory:write"], // Missing query:read
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:read", "memory:write", "query:read"],
							missing: ["query:read"],
							granted: ["memory:read", "memory:write"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should call next when user has all required scopes", async () => {
			const middleware = requireScopes("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read", "memory:write", "query:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should call next when user has exact required scopes", async () => {
			const middleware = requireScopes("memory:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should call next when no scopes are required", async () => {
			const middleware = requireScopes();

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: [],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should return 403 when user has empty scopes array and scopes are required", async () => {
			const middleware = requireScopes("memory:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: [],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:read"],
							missing: ["memory:read"],
							granted: [],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should return 403 with all missing scopes when user has no matching scopes", async () => {
			const middleware = requireScopes("scope:a", "scope:b", "scope:c");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["scope:x", "scope:y"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["scope:a", "scope:b", "scope:c"],
							missing: ["scope:a", "scope:b", "scope:c"],
							granted: ["scope:x", "scope:y"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should handle dev token auth context", async () => {
			const middleware = requireScopes("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "dev",
				prefix: "engram_dev_test",
				method: "dev",
				type: "dev",
				userId: "dev",
				scopes: ["memory:read", "memory:write", "query:read", "state:write"],
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should handle auth context with user info", async () => {
			const middleware = requireScopes("memory:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
				user: {
					name: "Test User",
					email: "test@example.com",
				},
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});
	});

	describe("requireAnyScope", () => {
		it("should return 401 when auth context is missing", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write");

			const mockContext = {
				get: mock(() => undefined),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				401,
			);
			expect(mockNext).not.toHaveBeenCalled();
			expect(result).toEqual({
				data: {
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Authentication required",
					},
				},
				status: 401,
			});
		});

		it("should return 403 when user has none of the required scopes", async () => {
			const middleware = requireAnyScope("memory:write", "query:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write", "query:write"],
							granted: ["memory:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
			expect(result).toEqual({
				data: {
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write", "query:write"],
							granted: ["memory:read"],
						},
					},
				},
				status: 403,
			});
		});

		it("should call next when user has at least one required scope", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read", "query:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should call next when user has all required scopes", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read", "memory:write", "query:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should call next when user has exactly one matching scope", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write", "query:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["query:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should return 403 when user has empty scopes array", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: [],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:read", "memory:write"],
							granted: [],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should return 403 when no scopes are required (edge case)", async () => {
			// Edge case: when requireAnyScope is called with no arguments,
			// the .some() check returns false for empty array, resulting in 403
			const middleware = requireAnyScope();

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			// Empty array.some() returns false, so it returns 403
			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: [],
							granted: ["memory:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should handle single scope requirement that matches", async () => {
			const middleware = requireAnyScope("memory:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should return 403 for single scope requirement that does not match", async () => {
			const middleware = requireAnyScope("memory:write");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write"],
							granted: ["memory:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should handle dev token auth context", async () => {
			const middleware = requireAnyScope("memory:read", "memory:write");

			const authContext: AuthContext = {
				id: "dev",
				prefix: "engram_dev_test",
				method: "dev",
				type: "dev",
				userId: "dev",
				scopes: ["memory:read", "memory:write", "query:read", "state:write"],
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should handle auth context with user info", async () => {
			const middleware = requireAnyScope("memory:read");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimit: 100,
				user: {
					name: "Test User",
					email: "test@example.com",
				},
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should not include missing scopes in error details", async () => {
			const middleware = requireAnyScope("scope:a", "scope:b");

			const authContext: AuthContext = {
				id: "test-id",
				prefix: "test-prefix",
				method: "oauth",
				type: "oauth",
				userId: "user-123",
				scopes: ["scope:x"],
				rateLimit: 100,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			// requireAnyScope should NOT include "missing" field in details
			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["scope:a", "scope:b"],
							granted: ["scope:x"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();

			// Verify "missing" field is NOT present
			const callArgs = (mockContext.json as ReturnType<typeof mock>).mock.calls[0];
			expect(callArgs[0].error.details).not.toHaveProperty("missing");
		});
	});

	describe("Client Token Scope Enforcement", () => {
		it("should reject client token with insufficient scopes for endpoint", async () => {
			const middleware = requireScopes("memory:write");

			const authContext: AuthContext = {
				id: "engram-search",
				prefix: "egm_client_abc123...",
				method: "client_credentials",
				type: "client",
				userId: "engram-search",
				scopes: ["memory:read", "query:read"], // Missing memory:write
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["memory:write"],
							missing: ["memory:write"],
							granted: ["memory:read", "query:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should allow client token with exactly registered scopes", async () => {
			const middleware = requireScopes("memory:read", "query:read");

			const authContext: AuthContext = {
				id: "engram-search",
				prefix: "egm_client_abc123...",
				method: "client_credentials",
				type: "client",
				userId: "engram-search",
				scopes: ["memory:read", "query:read"],
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should reject client token attempting to access mcp:prompts scope", async () => {
			const middleware = requireScopes("mcp:prompts");

			const authContext: AuthContext = {
				id: "engram-search",
				prefix: "egm_client_abc123...",
				method: "client_credentials",
				type: "client",
				userId: "engram-search",
				scopes: ["memory:read", "query:read"],
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Insufficient permissions",
						details: {
							required: ["mcp:prompts"],
							missing: ["mcp:prompts"],
							granted: ["memory:read", "query:read"],
						},
					},
				},
				403,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should allow client token with superset of required scopes", async () => {
			const middleware = requireScopes("memory:read");

			const authContext: AuthContext = {
				id: "engram-tuner",
				prefix: "egm_client_xyz789...",
				method: "client_credentials",
				type: "client",
				userId: "engram-tuner",
				scopes: ["memory:read", "memory:write", "tuner:read", "tuner:write"],
				rateLimit: 1000,
			};

			const mockContext = {
				get: mock(() => authContext),
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});
	});
});
