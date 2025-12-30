import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { OAuthToken, OAuthTokenRepository } from "../db/oauth-tokens";
import { type AuthContext, auth } from "./auth";

describe("OAuth Authentication Middleware", () => {
	let mockLogger: any;
	let mockOAuthTokenRepo: OAuthTokenRepository;
	let validUserToken: string;
	let validClientToken: string;

	beforeEach(() => {
		mockLogger = {
			info: mock(),
			warn: mock(),
			debug: mock(),
			error: mock(),
		};

		validUserToken = "egm_oauth_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_X7kM2p";
		validClientToken = "egm_client_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_Y8nL3q";

		// Create mock OAuth token repository
		mockOAuthTokenRepo = {
			validate: mock(async (token: string): Promise<OAuthToken | null> => {
				// Mock successful validation for valid tokens
				if (token === validUserToken) {
					return {
						id: "user-token-123",
						accessTokenPrefix: `${validUserToken.slice(0, 20)}...`,
						userId: "user-123",
						scopes: ["memory:read", "memory:write"],
						rateLimitRpm: 1000,
						grantType: "authorization_code",
						clientId: "engram-console",
						orgId: "org-123",
						orgSlug: "acme",
						user: {
							name: "Test User",
							email: "test@example.com",
						},
					} satisfies OAuthToken;
				}

				if (token === validClientToken) {
					return {
						id: "client-token-456",
						accessTokenPrefix: `${validClientToken.slice(0, 20)}...`,
						userId: "service:engram-search", // Client credentials use service identity
						scopes: ["memory:read", "query:read"],
						rateLimitRpm: 5000,
						grantType: "client_credentials",
						clientId: "engram-search",
						orgId: "org-456",
						orgSlug: "globex",
					} satisfies OAuthToken;
				}

				return null;
			}),
		} as OAuthTokenRepository;
	});

	afterEach(() => {
		mock.restore();
	});

	describe("User Token (egm_oauth_*) Validation", () => {
		it("should accept valid user token with correct scopes", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
				requiredScopes: ["memory:read"],
			});

			let authContext: AuthContext | undefined;
			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validUserToken}` : undefined,
				},
				set: (key: string, value: AuthContext) => {
					if (key === "auth") {
						authContext = value;
					}
				},
				json: mock(),
			};

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(authContext).toBeDefined();
			expect(authContext?.method).toBe("oauth");
			expect(authContext?.type).toBe("oauth");
			expect(authContext?.userId).toBe("user-123");
			expect(authContext?.scopes).toContain("memory:read");
			expect(authContext?.user?.name).toBe("Test User");
		});

		it("should reject user token with insufficient scopes", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
				requiredScopes: ["admin:write"],
			});

			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validUserToken}` : undefined,
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(403);
					expect(body.error.code).toBe("FORBIDDEN");
					expect(body.error.message).toContain("admin:write");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
			expect(mockContext.json).toHaveBeenCalled();
		});
	});

	describe("Client Token (egm_client_*) Validation", () => {
		it("should accept valid client token with correct scopes", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
				requiredScopes: ["memory:read"],
			});

			let authContext: AuthContext | undefined;
			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validClientToken}` : undefined,
				},
				set: (key: string, value: AuthContext) => {
					if (key === "auth") {
						authContext = value;
					}
				},
				json: mock(),
			};

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(authContext).toBeDefined();
			expect(authContext?.method).toBe("oauth");
			expect(authContext?.type).toBe("oauth");
			expect(authContext?.userId).toBe("service:engram-search"); // Client credentials use service identity
			expect(authContext?.clientId).toBe("engram-search");
			expect(authContext?.scopes).toContain("memory:read");
			expect(authContext?.grantType).toBe("client_credentials");
		});

		it("should accept client token with query:read scope", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
				requiredScopes: ["query:read"],
			});

			let authContext: AuthContext | undefined;
			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validClientToken}` : undefined,
				},
				set: (key: string, value: AuthContext) => {
					if (key === "auth") {
						authContext = value;
					}
				},
				json: mock(),
			};

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(authContext).toBeDefined();
			expect(authContext?.scopes).toContain("query:read");
		});

		it("should reject client token with insufficient scopes", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
				requiredScopes: ["memory:write"], // Client token doesn't have this scope
			});

			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validClientToken}` : undefined,
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(403);
					expect(body.error.code).toBe("FORBIDDEN");
					expect(body.error.message).toContain("memory:write");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
			expect(mockContext.json).toHaveBeenCalled();
		});
	});

	describe("Token Format Validation", () => {
		it("should reject invalid token format", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
			});

			const mockContext: any = {
				req: {
					header: (name: string) => (name === "Authorization" ? "Bearer invalid-token" : undefined),
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(401);
					expect(body.error.code).toBe("UNAUTHORIZED");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should reject missing Authorization header", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
			});

			const mockContext: any = {
				req: {
					header: () => undefined,
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(401);
					expect(body.error.message).toContain("Missing Authorization header");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should reject malformed Authorization header", async () => {
			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockOAuthTokenRepo,
			});

			const mockContext: any = {
				req: {
					header: (name: string) => (name === "Authorization" ? "InvalidFormat token" : undefined),
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(401);
					expect(body.error.message).toContain("Invalid Authorization header format");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
		});
	});

	describe("Token Validation Errors", () => {
		it("should handle expired tokens", async () => {
			const expiredToken = "egm_oauth_e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6_Z9oP4r";
			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => null), // Expired tokens return null
			} as OAuthTokenRepository;

			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockRepo,
			});

			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${expiredToken}` : undefined,
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(401);
					expect(body.error.message).toContain("Invalid or expired");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should handle database errors gracefully", async () => {
			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => {
					throw new Error("Database connection failed");
				}),
			} as OAuthTokenRepository;

			const middleware = auth({
				logger: mockLogger,
				oauthTokenRepo: mockRepo,
			});

			const mockContext: any = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${validUserToken}` : undefined,
				},
				set: mock(),
				json: mock((body: any, status: number) => {
					expect(status).toBe(500);
					expect(body.error.code).toBe("INTERNAL_ERROR");
					return body;
				}),
			};

			const mockNext = mock();

			await middleware(mockContext, mockNext);

			expect(mockNext).not.toHaveBeenCalled();
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
