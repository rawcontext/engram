import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

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

// Use dynamic import to ensure mock is applied first
// This works because dynamic imports are NOT hoisted
const { authenticateRequest, closeAuth, initAuth } = await import("./auth");

describe("Auth", () => {
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
		await closeAuth();
	});

	describe("initAuth", () => {
		it("should initialize auth with enabled=true", () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			expect(mockLogger.info).toHaveBeenCalledWith("OAuth authentication enabled");
		});

		it("should initialize auth with enabled=false", () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

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

			initAuth(config);

			expect(mockLogger.info).toHaveBeenCalled();
		});

		it("should not create connection pool when disabled", () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

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

			initAuth(config);
			await closeAuth();

			expect(mockState.endCalls.length).toBeGreaterThan(0);
		});

		it("should handle closing when pool is null", async () => {
			// Don't initialize
			await closeAuth();

			// Should not throw
			expect(mockState.endCalls.length).toBe(0);
		});

		it("should set pool to null after closing", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);
			await closeAuth();
			await closeAuth(); // Second call should be safe

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

			initAuth(config);

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
			expect(writeHeadMock).not.toHaveBeenCalled();
		});

		it("should reject request with missing Authorization header", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
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

			initAuth(config);

			mockReq.headers = { authorization: "InvalidFormat token" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
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

			initAuth(config);

			mockReq.headers = { authorization: "Bearer invalid_token_format" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
			expect(endResMock).toHaveBeenCalledWith(
				JSON.stringify({
					success: false,
					error: { code: "UNAUTHORIZED", message: "Invalid token format" },
				}),
			);
		});

		it("should accept valid dev token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_dev_test123" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should accept valid OAuth token with correct scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = `engram_oauth_${"a".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
			expect(mockState.queryCalls.length).toBe(2); // Once for validation, once for update
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should reject OAuth token not found in database", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = `engram_oauth_${"a".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock empty database response
			queryMock.mockResolvedValueOnce({ rows: [] });

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
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

			initAuth(config);

			const validToken = `engram_oauth_${"b".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with revoked token
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: new Date(),
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should reject expired OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = `engram_oauth_${"c".repeat(32)}`;
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
						access_token_expires_at: yesterday,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should accept OAuth token with future expiration", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = `engram_oauth_${"d".repeat(32)}`;
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
						access_token_expires_at: tomorrow,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
		});

		it("should reject OAuth token with insufficient scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = `engram_oauth_${"e".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response with different scopes
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:read"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
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

			initAuth(config);

			const validToken = `engram_oauth_${"f".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:read"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write", "memory:read"],
			);

			expect(result).toBe(true);
		});

		it("should handle database errors gracefully", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"3".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database error
			queryMock.mockRejectedValueOnce(new Error("Database connection failed"));

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
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

			initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"1".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			await authenticateRequest(mockReq as IncomingMessage, mockRes as ServerResponse, [
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

			initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"2".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			// Mock database response for SELECT
			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			// Mock failure for UPDATE (but should not affect the result)
			queryMock.mockRejectedValueOnce(new Error("Update failed"));

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			// Should still succeed since update is fire-and-forget
			expect(result).toBe(true);
		});

		it("should accept dev token with all default scopes", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_dev_local" };

			// Test each default scope
			const scopes = ["memory:read", "memory:write", "query:read", "ingest:write"];

			for (const scope of scopes) {
				const result = await authenticateRequest(
					mockReq as IncomingMessage,
					mockRes as ServerResponse,
					[scope],
				);

				expect(result).toBe(true);
			}
		});

		it("should accept dev token with underscores and alphanumeric chars", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_dev_test_123_ABC" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
		});

		it("should reject dev token with invalid characters", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_dev_test-invalid" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
		});

		it("should reject OAuth token with wrong length", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_oauth_abc123" }; // Too short

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should reject OAuth token with uppercase hex chars", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: `Bearer engram_oauth_${"A".repeat(32)}` };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
		});

		it("should accept OAuth token with lowercase hex chars only", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const validToken = "engram_oauth_0123456789abcdef0123456789abcdef";
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(true);
		});

		it("should log with correct prefix for OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"4".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: "prefix-123",
						scopes: ["ingest:write"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			await authenticateRequest(mockReq as IncomingMessage, mockRes as ServerResponse, [
				"ingest:write",
			]);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				{ prefix: "prefix-123", method: "oauth" },
				"Request authenticated",
			);
		});

		it("should log with correct prefix for dev token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			const devToken = "engram_dev_test123";
			mockReq.headers = { authorization: `Bearer ${devToken}` };

			await authenticateRequest(mockReq as IncomingMessage, mockRes as ServerResponse, [
				"ingest:write",
			]);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				{ prefix: devToken.slice(0, 20), method: "dev" },
				"Request authenticated",
			);
		});

		it("should handle null pool for OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);
			await closeAuth(); // Close pool

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"5".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write"],
			);

			expect(result).toBe(false);
			expect(writeHeadMock).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
		});

		it("should handle empty required scopes array", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			mockReq.headers = { authorization: "Bearer engram_dev_test" };

			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				[],
			);

			// With empty required scopes, any valid token should fail scope check
			expect(result).toBe(false);
		});

		it("should check scopes with some() - any matching scope is sufficient", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			initAuth(config);

			// Use valid hex characters (a-f, 0-9) for OAuth tokens
			const validToken = `engram_oauth_${"6".repeat(32)}`;
			mockReq.headers = { authorization: `Bearer ${validToken}` };

			queryMock.mockResolvedValueOnce({
				rows: [
					{
						id: "token-123",
						access_token_prefix: validToken.slice(0, 20),
						scopes: ["memory:write", "query:read"],
						user_id: "user-123",
						access_token_expires_at: null,
						revoked_at: null,
					},
				],
			});

			// Should succeed because query:read is in token scopes
			const result = await authenticateRequest(
				mockReq as IncomingMessage,
				mockRes as ServerResponse,
				["ingest:write", "query:read", "admin:all"],
			);

			expect(result).toBe(true);
		});
	});
});
