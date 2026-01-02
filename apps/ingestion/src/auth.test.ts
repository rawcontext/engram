import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

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
	});

	describe("authenticateRequest", () => {
		// Helper to create mock Request objects
		const createRequest = (authHeader?: string): Request => {
			const headers = new Headers();
			if (authHeader) {
				headers.set("authorization", authHeader);
			}
			return new Request("http://localhost:6175/ingest", {
				method: "POST",
				headers,
			});
		};

		it("should allow request when auth is disabled", async () => {
			const config = {
				enabled: false,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const req = createRequest();
			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			// Returns dev context object when auth is disabled
			expect(result).not.toBeInstanceOf(Response);
			if (!(result instanceof Response)) {
				expect(result.userId).toBe("dev-user");
				expect(result.orgId).toBe("dev-org");
				expect(result.orgSlug).toBe("dev");
			}
		});

		it("should reject request with missing Authorization header", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const req = createRequest();
			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(401);
				const body = await result.json();
				expect(body.error.message).toBe("Missing Authorization header");
			}
		});

		it("should reject request with invalid Authorization header format", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const req = createRequest("InvalidFormat token");
			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(401);
				const body = await result.json();
				expect(body.error.message).toBe("Invalid Authorization header format. Use: Bearer <token>");
			}
		});

		it("should accept valid OAuth user token with correct scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_X7kM2p`;
			const req = createRequest(`Bearer ${validToken}`);

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

			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).not.toBeInstanceOf(Response);
			if (!(result instanceof Response)) {
				expect(result.userId).toBe("user-123");
				expect(result.orgId).toBe("org-123");
				expect(result.orgSlug).toBe("acme");
			}
			expect(mockState.queryCalls.length).toBe(2); // Once for validation, once for update
			expect(mockLogger.debug).toHaveBeenCalled();
		});

		it("should reject OAuth token with insufficient scope", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee_B1sT6t`;
			const req = createRequest(`Bearer ${validToken}`);

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

			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(403);
				const body = await result.json();
				expect(body.error.code).toBe("FORBIDDEN");
			}
		});

		it("should handle database errors gracefully", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_33333333333333333333333333333333_D3wX8v`;
			const req = createRequest(`Bearer ${validToken}`);

			// Mock database error
			queryMock.mockRejectedValueOnce(new Error("Database connection failed"));

			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(500);
				const body = await result.json();
				expect(body.error.code).toBe("INTERNAL_ERROR");
			}
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should reject expired OAuth token", async () => {
			const config = {
				enabled: true,
				postgresUrl: "postgresql://localhost/test",
				logger: mockLogger,
			};

			auth.initAuth(config);

			const validToken = `egm_oauth_cccccccccccccccccccccccccccccccc_Z9oP4r`;
			const req = createRequest(`Bearer ${validToken}`);

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

			const result = await auth.authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(401);
			}
		});
	});
});
