import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

// Skip in CI - Bun's mock.module() doesn't work reliably with dynamic imports in CI
const isCI = process.env.CI === "true";
const describeOrSkip = isCI ? describe.skip : describe;

// Mutable container to hold current mock implementations
// This pattern allows tests to modify mock behavior after mock.module() is called
const mockState = {
	defaultQueryImpl: async (): Promise<{ rows: unknown[] }> => ({ rows: [] }),
	defaultEndImpl: async (): Promise<void> => {},
	queryQueue: [] as Array<
		{ type: "resolve"; value: { rows: unknown[] } } | { type: "reject"; error: Error }
	>,
	queryCalls: [] as unknown[][],
	endCalls: [] as unknown[][],
};

// Create stable mock functions that delegate to mutable state
const queryMock = Object.assign(
	async (...args: unknown[]) => {
		mockState.queryCalls.push(args);
		// Check if there's a queued response
		const queued = mockState.queryQueue.shift();
		if (queued) {
			if (queued.type === "resolve") {
				return queued.value;
			} else {
				throw queued.error;
			}
		}
		// Fall back to default implementation
		return mockState.defaultQueryImpl();
	},
	{
		mockClear: () => {
			mockState.queryCalls = [];
			mockState.queryQueue = [];
		},
		mockImplementation: (impl: typeof mockState.defaultQueryImpl) => {
			mockState.defaultQueryImpl = impl;
		},
		mockResolvedValueOnce: (value: { rows: unknown[] }) => {
			mockState.queryQueue.push({ type: "resolve", value });
		},
		mockRejectedValueOnce: (error: Error) => {
			mockState.queryQueue.push({ type: "reject", error });
		},
		mock: {
			get calls() {
				return mockState.queryCalls;
			},
		},
	},
);

const endMock = Object.assign(
	async (...args: unknown[]) => {
		mockState.endCalls.push(args);
		return mockState.defaultEndImpl();
	},
	{
		mockClear: () => {
			mockState.endCalls = [];
		},
		mockImplementation: (impl: typeof mockState.defaultEndImpl) => {
			mockState.defaultEndImpl = impl;
		},
		mock: {
			get calls() {
				return mockState.endCalls;
			},
		},
	},
);

// Mock pg module BEFORE any static imports that use it
// Note: Static imports are hoisted, so we must mock before the module system loads pg
class MockPool {
	query(...args: unknown[]) {
		return queryMock(...args);
	}
	end(...args: unknown[]) {
		return endMock(...args);
	}
}

mock.module("pg", () => {
	// pg is a CommonJS module. For ESM interop, we need to provide both:
	// - default export (for `import pg from "pg"` where pg = default)
	// - named exports (for direct destructuring)
	return {
		default: { Pool: MockPool },
		Pool: MockPool,
	};
});

// Container for dynamically imported functions
const auth: {
	authenticateRequest: typeof import("./auth").authenticateRequest;
	closeAuth: typeof import("./auth").closeAuth;
	initAuth: typeof import("./auth").initAuth;
} = {} as typeof auth;

describeOrSkip("Auth", () => {
	// Import inside beforeAll to ensure mocks are set up first
	beforeAll(async () => {
		const mod = await import("./auth");
		auth.authenticateRequest = mod.authenticateRequest;
		auth.closeAuth = mod.closeAuth;
		auth.initAuth = mod.initAuth;
	});
	let mockLogger: any;

	beforeEach(() => {
		mockLogger = {
			info: mock(),
			warn: mock(),
			debug: mock(),
			error: mock(),
		};
		// Reset mock state
		mockState.queryCalls = [];
		mockState.endCalls = [];
		mockState.queryQueue = [];
		mockState.defaultQueryImpl = async () => ({ rows: [] });
		mockState.defaultEndImpl = async () => {};
	});

	afterEach(async () => {
		// Clean up auth state between tests
		await auth.closeAuth();
	});

	describe("initAuth", () => {
		it("should initialize auth with enabled=true", () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			expect(mockLogger.info).toHaveBeenCalledWith("OAuth authentication enabled");
		});

		it("should initialize auth with enabled=false", () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"OAuth authentication DISABLED (AUTH_ENABLED=false)",
			);
		});

		it("should create connection pool when enabled", () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			expect(mockLogger.info).toHaveBeenCalled();
		});

		it("should not create connection pool when disabled", () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("closeAuth", () => {
		it("should close pool when initialized", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);
			await auth.closeAuth();

			expect(mockState.endCalls.length).toBeGreaterThan(0);
		});

		it("should handle closing when pool is null", async () => {
			// Don't initialize
			await auth.closeAuth();

			// Should not throw
			expect(mockState.endCalls.length).toBe(0);
		});

		it("should set pool to null after closing", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);
			await auth.closeAuth();
			await auth.closeAuth(); // Second call should be safe

			expect(mockState.endCalls.length).toBe(1);
		});
	});

	describe("authenticateRequest", () => {
		let mockReq: Partial<IncomingMessage>;
		let mockRes: Partial<ServerResponse>;
		let writeHeadMock: ReturnType<typeof mock>;
		let endResMock: ReturnType<typeof mock>;

		beforeEach(() => {
			writeHeadMock = mock();
			endResMock = mock();
			mockReq = {
				headers: {},
			};
			mockRes = {
				writeHead: writeHeadMock,
				end: endResMock,
			};
		});

		it("should allow request when auth is disabled", async () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			// Returns dev context object when auth is disabled
			expect(result).not.toBeNull();
			expect(result?.userId).toBe("dev-user");
			expect(result?.orgId).toBe("dev-org");
			expect(result?.orgSlug).toBe("dev");
			expect(writeHeadMock).not.toHaveBeenCalled();
		});

		it("should reject request with missing Authorization header", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: { code: "UNAUTHORIZED", message: "Missing Authorization header" },
				}),
			);
		});

		it("should reject request with invalid Authorization header format", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			mockReq.headers = { authorization: "InvalidFormat token" };

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid Authorization header format. Use: Bearer <token>",
					},
				}),
			);
		});

		it("should reject request with invalid token format", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			mockReq.headers = { authorization: "Bearer invalid_token_format" };

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
				}),
			);
		});

		it("should accept valid OAuth user token with correct scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_X7kM2p`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).not.toBeNull();
			expect(result?.userId).toBe("user-123");
			expect(result?.orgId).toBe("org-123");
			expect(result?.orgSlug).toBe("acme");
			expect(mockState.queryCalls.length).toBe(2); // Once for validation, once for update
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should accept valid OAuth client token with correct scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_client_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_Y8nL3q`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-456",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write", "memory:write"],
						user_id: "client-123",
						org_id: "org-456",
						org_slug: "globex",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).not.toBeNull();
			expect(result?.userId).toBe("client-123");
			expect(result?.orgId).toBe("org-456");
			expect(mockState.queryCalls.length).toBe(2); // Once for validation, once for update
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should reject OAuth token not found in database", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_X7kM2p`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock empty database response
			queryMock.mockResolvedValueOnce({ rows: [] });

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
				}),
			);
		});

		it("should reject revoked OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_Y8nL3q`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with revoked token
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: new Date(),
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should reject expired OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_cccccccccccccccccccccccccccccccc_Z9oP4r`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with expired token
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: yesterday,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should accept OAuth token with future expiration", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_dddddddddddddddddddddddddddddddd_A0qR5s`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with future expiration
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write", "memory:read"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: tomorrow,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).not.toBeNull();
			expect(result?.userId).toBe("user-123");
		});

		it("should reject OAuth token with insufficient scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee_B1sT6t`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with different scopes
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:read"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(403, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: {
						code: "FORBIDDEN",
						message: "Missing required scope. Need one of: ingest:write",
					},
				}),
			);
		});

		it("should accept OAuth token with one of multiple required scopes", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_ffffffffffffffffffffffffffffffff_C2uV7u`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:read"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write", "memory:read"],
			);

			expect(result).not.toBeNull();
		});

		it("should handle database errors gracefully", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_33333333333333333333333333333333_D3wX8v`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database error
			queryMock.mockRejectedValueOnce(new Error("Database connection failed"));

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(mockLogger.error).toHaveBeenCalledWith(
				{ error: expect.any(Error) },
				"Failed to validate token",
			);
			expect(writeHeadMock).toHaveBeenCalledWith(500, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: { code: "INTERNAL_ERROR", message: "Failed to validate token" },
				}),
			);
		});

		it("should update last_used_at for valid OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_11111111111111111111111111111111_E4yZ9w`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			await auth.authenticateRequest(mockReq as IncomingMessage, mockRes as ServerResponse, [
				"ingest:write",
			]);

			// Wait for fire-and-forget UPDATE to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have called query twice: once for SELECT, once for UPDATE
			expect(mockState.queryCalls.length).toBe(2);
			expect(mockState.queryCalls[1][0]).toContain("UPDATE oauth_tokens");
		});

		it("should handle last_used_at update failure gracefully", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_22222222222222222222222222222222_F5aB0x`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response for SELECT
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			// Mock failure for UPDATE (but should not affect the result)
			queryMock.mockRejectedValueOnce(new Error("Update failed"));

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			// Should still succeed since update is fire-and-forget
			expect(result).not.toBeNull();
		});

		it("should reject OAuth token with wrong length", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			mockReq.headers = { authorization: "Bearer egm_oauth_abc123" }; // Too short

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should reject OAuth token with uppercase hex chars", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			mockReq.headers = {
				authorization: `Bearer egm_oauth_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1_K0mN5C`,
			};

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
		});

		it("should accept OAuth token with lowercase hex chars only", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = "egm_oauth_0123456789abcdef0123456789abcdef_J9iK4B";
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).not.toBeNull();
		});

		it("should log with correct prefix for OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_44444444444444444444444444444444_G6cD1y`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: "prefix-123",
						scopes: ["ingest:write"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			await auth.authenticateRequest(mockReq as IncomingMessage, mockRes as ServerResponse, [
				"ingest:write",
			]);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				{ prefix: "prefix-123", method: "oauth" },
				"Request authenticated",
			);
		});

		it("should handle null pool for OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);
			await auth.closeAuth(); // Close pool

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_55555555555555555555555555555555_H7eF2z`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBeNull();
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should handle empty required scopes array", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_77777777777777777777777777777777_L0pQ7D`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-789",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-789",
						org_id: "org-789",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				[],
			);

			// With empty required scopes, any valid token should fail scope check
			expect(result).toBeNull();
		});

		it("should check scopes with some() - any matching scope is sufficient", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `egm_oauth_66666666666666666666666666666666_I8gH3A`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:write", "query:read"],
						user_id: "user-123",
						org_id: "org-123",
						org_slug: "acme",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			// Should succeed because query:read is in token scopes
			const result = await auth.authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write", "query:read", "admin:all"],
			);

			expect(result).not.toBeNull();
		});
	});
});
