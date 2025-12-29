import { describe, expect, it, mock } from "bun:test";
import type { Context } from "hono";
import type { OAuthTokenRepository } from "../db/oauth-tokens";
import { auth } from "./auth";

/**
 * Tests for OAuth token expiration handling.
 *
 * Client credentials grant does NOT issue refresh tokens (RFC 6749 Section 4.4.3).
 * Services must request new access tokens when current token expires.
 *
 * ACCESS_TOKEN_EXPIRES_IN = 7 days (604800 seconds)
 */
describe("Auth Middleware - Token Expiration", () => {
	describe("expired token rejection", () => {
		it("should reject request with expired access token (401 invalid_token)", async () => {
			// Create token with access_token_expires_at in the past
			const expiredToken = {
				id: "token-123",
				accessTokenHash: "hash",
				accessTokenPrefix: "egm_oauth_abc...",
				userId: "user-123",
				scopes: ["memory:read", "memory:write"],
				rateLimitRpm: 60,
				accessTokenExpiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
				refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days from now
				createdAt: new Date(),
				updatedAt: new Date(),
				clientId: "test-client",
				grantType: "device_code" as const,
				user: {
					name: "Test User",
					email: "test@example.com",
				},
			};

			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => null), // Expired tokens return null
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			// Verify middleware rejects expired token with 401
			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid or expired OAuth token",
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
						message: "Invalid or expired OAuth token",
					},
				},
				status: 401,
			});
		});

		it("should accept request with valid non-expired token", async () => {
			const validToken = {
				id: "token-123",
				accessTokenHash: "hash",
				accessTokenPrefix: "egm_oauth_abc...",
				userId: "user-123",
				scopes: ["memory:read", "memory:write"],
				rateLimitRpm: 60,
				accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days from now
				refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days from now
				createdAt: new Date(),
				updatedAt: new Date(),
				clientId: "test-client",
				grantType: "device_code" as const,
				user: {
					name: "Test User",
					email: "test@example.com",
				},
			};

			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => validToken),
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
				set: mock(() => {}),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			// Verify middleware accepts valid token
			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});

		it("should reject token that expires exactly now", async () => {
			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => null), // Token expiring now returns null
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid or expired OAuth token",
					},
				},
				401,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});
	});

	describe("client credentials token expiration (no refresh tokens)", () => {
		it("should reject expired client credentials token", async () => {
			// Client credentials tokens have no refresh tokens per RFC 6749 Section 4.4.3
			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => null), // Expired
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							// Client credentials token format
							return "Bearer egm_client_abcdef1234567890abcdef1234567890_Y8nL3q";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			const result = await middleware(mockContext, mockNext);

			// Client must request new token (no refresh token available)
			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid or expired OAuth token",
					},
				},
				401,
			);
			expect(mockNext).not.toHaveBeenCalled();
		});

		it("should accept valid client credentials token", async () => {
			const validClientToken = {
				id: "token-456",
				accessTokenHash: "hash",
				accessTokenPrefix: "egm_client_abc...",
				userId: null, // Client credentials have no user
				scopes: ["memory:read", "query:read"],
				rateLimitRpm: 1000,
				accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
				refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // Not used for client credentials
				createdAt: new Date(),
				updatedAt: new Date(),
				clientId: "engram-search",
				grantType: "client_credentials" as const,
			};

			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => validClientToken),
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_client_abcdef1234567890abcdef1234567890_Y8nL3q";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
				set: mock(() => {}),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).not.toHaveBeenCalled();
			expect(mockNext).toHaveBeenCalledTimes(1);
		});
	});

	describe("token lifetime validation", () => {
		it("should reject token expired by 1 millisecond", async () => {
			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => null), // Expired by 1ms
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p";
						}
						return undefined;
					}),
				},
				json: mock((data, status) => ({ data, status })),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockContext.json).toHaveBeenCalledWith(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid or expired OAuth token",
					},
				},
				401,
			);
		});

		it("should accept token with 1 millisecond remaining", async () => {
			const almostExpiredToken = {
				id: "token-123",
				accessTokenHash: "hash",
				accessTokenPrefix: "egm_oauth_abc...",
				userId: "user-123",
				scopes: ["memory:read"],
				rateLimitRpm: 60,
				accessTokenExpiresAt: new Date(Date.now() + 1), // 1ms from now
				refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
				createdAt: new Date(),
				updatedAt: new Date(),
				clientId: "test-client",
				grantType: "device_code" as const,
				user: {
					name: "Test User",
					email: "test@example.com",
				},
			};

			const mockRepo: OAuthTokenRepository = {
				validate: mock(async () => almostExpiredToken),
			} as unknown as OAuthTokenRepository;

			const mockLogger = {
				debug: mock(() => {}),
				error: mock(() => {}),
				info: mock(() => {}),
				warn: mock(() => {}),
			};

			const middleware = auth({
				logger: mockLogger as any,
				oauthTokenRepo: mockRepo,
			});

			const mockContext = {
				req: {
					header: mock((name: string) => {
						if (name === "Authorization") {
							return "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p";
						}
						return undefined;
					}),
				},
				json: mock(() => {}),
				set: mock(() => {}),
			} as unknown as Context;

			const mockNext = mock(async () => {});

			await middleware(mockContext, mockNext);

			expect(mockNext).toHaveBeenCalledTimes(1);
		});
	});
});
