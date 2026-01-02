import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createTestLogger } from "@engram/common/testing";
import { createTokenVerifier, IntrospectionTokenVerifier } from "./token-verifier";

// Skip timing-sensitive tests when running from root - parallel test execution
// can cause timing interference. Run from apps/mcp for full test suite.
const isMcpRoot = process.cwd().includes("apps/mcp");
const describeOrSkip = isMcpRoot ? describe : describe.skip;

describeOrSkip("IntrospectionTokenVerifier", () => {
	let verifier: IntrospectionTokenVerifier;
	let logger: ReturnType<typeof createTestLogger>;
	let fetchSpy: ReturnType<typeof spyOn>;

	const defaultOptions = {
		introspectionEndpoint: "https://auth.example.com/api/auth/introspect",
		clientId: "mcp-server",
		clientSecret: "secret123",
		resourceServerUrl: "https://mcp.example.com",
		cacheTtlMs: 100,
	};

	beforeEach(() => {
		logger = createTestLogger();
		verifier = new IntrospectionTokenVerifier({
			...defaultOptions,
			logger,
		});

		// Mock fetch
		fetchSpy = spyOn(global, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		verifier.clearCache();
	});

	describe("verify", () => {
		it("should return valid token info for active token", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					scope: "mcp:tools mcp:resources",
					client_id: "test-client",
					sub: "user-123",
					email: "user@example.com",
					exp: Math.floor(Date.now() / 1000) + 3600,
					iat: Math.floor(Date.now() / 1000) - 100,
					aud: "https://mcp.example.com",
				}),
			} as Response);

			const result = await verifier.verify("test-token");

			expect(result).not.toBeNull();
			expect(result?.token).toBe("test-token");
			expect(result?.clientId).toBe("test-client");
			expect(result?.userId).toBe("user-123");
			expect(result?.email).toBe("user@example.com");
			expect(result?.scopes).toContain("mcp:tools");
			expect(result?.scopes).toContain("mcp:resources");
		});

		it("should return null for inactive token", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: false,
				}),
			} as Response);

			const result = await verifier.verify("inactive-token");

			expect(result).toBeNull();
			expect(logger.debug).toHaveBeenCalled();
		});

		it("should return null when introspection fails", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: false,
				status: 500,
			} as Response);

			const result = await verifier.verify("error-token");

			expect(result).toBeNull();
			expect(logger.warn).toHaveBeenCalled();
		});

		it("should return null when fetch throws", async () => {
			fetchSpy.mockRejectedValueOnce(new Error("Network error"));

			const result = await verifier.verify("network-error-token");

			expect(result).toBeNull();
			expect(logger.error).toHaveBeenCalled();
		});

		it("should return null for expired token", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					exp: Math.floor(Date.now() / 1000) - 100, // Expired
					aud: "https://mcp.example.com",
				}),
			} as Response);

			const result = await verifier.verify("expired-token");

			expect(result).toBeNull();
			expect(logger.debug).toHaveBeenCalled();
		});

		it("should reject token with invalid audience", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					exp: Math.floor(Date.now() / 1000) + 3600,
					aud: "https://other-server.com", // Wrong audience
				}),
			} as Response);

			const result = await verifier.verify("wrong-audience-token");

			expect(result).toBeNull();
			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ audiences: "https://other-server.com" }),
				"Token audience mismatch - possible token passthrough attack",
			);
		});

		it("should accept token with matching audience in array", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					exp: Math.floor(Date.now() / 1000) + 3600,
					aud: ["https://api.example.com", "https://mcp.example.com"],
				}),
			} as Response);

			const result = await verifier.verify("array-audience-token");

			expect(result).not.toBeNull();
		});

		it("should accept token with /mcp suffix in audience", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					exp: Math.floor(Date.now() / 1000) + 3600,
					aud: "https://mcp.example.com/mcp",
				}),
			} as Response);

			const result = await verifier.verify("mcp-suffix-token");

			expect(result).not.toBeNull();
		});

		it("should accept token without audience when not required", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					exp: Math.floor(Date.now() / 1000) + 3600,
					// No aud field
				}),
			} as Response);

			const result = await verifier.verify("no-audience-token");

			expect(result).not.toBeNull();
		});

		it("should use Basic auth with client credentials", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					aud: "https://mcp.example.com",
				}),
			} as Response);

			await verifier.verify("any-token");

			expect(fetchSpy).toHaveBeenCalledWith(
				"https://auth.example.com/api/auth/introspect",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/x-www-form-urlencoded",
						Authorization: expect.stringMatching(/^Basic /),
					}),
				}),
			);

			// Verify credentials encoding
			const expectedCredentials = Buffer.from("mcp-server:secret123").toString("base64");
			expect(fetchSpy).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: `Basic ${expectedCredentials}`,
					}),
				}),
			);
		});

		it("should cache valid tokens", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					aud: "https://mcp.example.com",
				}),
			} as Response);

			// First call - should hit the endpoint
			await verifier.verify("cached-token");
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			// Second call - should use cache
			await verifier.verify("cached-token");
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			expect(logger.debug).toHaveBeenCalledWith("Token found in cache");
		});

		it("should remove expired cache entries", async () => {
			fetchSpy
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client",
						aud: "https://mcp.example.com",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client-2",
						aud: "https://mcp.example.com",
					}),
				} as Response);

			// First call
			await verifier.verify("expires-token");
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			// Wait for cache to expire (cacheTtlMs is 100ms)
			// Use 500ms to reliably ensure expiration even under parallel test load
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Second call - should hit the endpoint again
			await verifier.verify("expires-token");
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});

		it("should capture additional claims", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					aud: "https://mcp.example.com",
					custom_claim: "custom-value",
					another_claim: 42,
				}),
			} as Response);

			const result = await verifier.verify("claims-token");

			expect(result?.claims).toEqual({
				custom_claim: "custom-value",
				another_claim: 42,
			});
		});

		it("should handle empty scopes", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					aud: "https://mcp.example.com",
					// No scope field
				}),
			} as Response);

			const result = await verifier.verify("no-scopes-token");

			expect(result?.scopes).toEqual([]);
		});

		it("should default clientId to unknown", async () => {
			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					aud: "https://mcp.example.com",
					// No client_id field
				}),
			} as Response);

			const result = await verifier.verify("no-client-token");

			expect(result?.clientId).toBe("unknown");
		});
	});

	describe("skipAudienceValidation", () => {
		it("should skip audience check when configured", async () => {
			const skipVerifier = new IntrospectionTokenVerifier({
				...defaultOptions,
				logger,
				skipAudienceValidation: true,
			});

			fetchSpy.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					active: true,
					client_id: "test-client",
					aud: "https://completely-different-server.com",
				}),
			} as Response);

			const result = await skipVerifier.verify("any-audience-token");

			expect(result).not.toBeNull();
		});
	});

	describe("clearCache", () => {
		it("should clear all cached tokens", async () => {
			fetchSpy
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client",
						aud: "https://mcp.example.com",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client-2",
						aud: "https://mcp.example.com",
					}),
				} as Response);

			await verifier.verify("token-1");
			verifier.clearCache();
			await verifier.verify("token-1");

			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("invalidateToken", () => {
		it("should remove specific token from cache", async () => {
			fetchSpy
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client",
						aud: "https://mcp.example.com",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client-2",
						aud: "https://mcp.example.com",
					}),
				} as Response);

			await verifier.verify("revoked-token");
			verifier.invalidateToken("revoked-token");
			await verifier.verify("revoked-token");

			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});

		it("should not affect other cached tokens", async () => {
			fetchSpy
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client",
						aud: "https://mcp.example.com",
					}),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						active: true,
						client_id: "test-client",
						aud: "https://mcp.example.com",
					}),
				} as Response);

			await verifier.verify("token-a");
			await verifier.verify("token-b");

			verifier.invalidateToken("token-a");

			// token-b should still be cached
			await verifier.verify("token-b");
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});
});

describe("createTokenVerifier", () => {
	it("should create an IntrospectionTokenVerifier instance", () => {
		const logger = createTestLogger();
		const verifier = createTokenVerifier({
			introspectionEndpoint: "https://auth.example.com/api/auth/introspect",
			clientId: "mcp-server",
			clientSecret: "secret",
			resourceServerUrl: "https://mcp.example.com",
			logger,
		});

		expect(verifier).toBeInstanceOf(IntrospectionTokenVerifier);
	});
});
