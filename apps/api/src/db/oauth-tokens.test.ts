import { describe, expect, it, mock } from "bun:test";
import { hashToken, OAuthTokenRepository } from "./oauth-tokens";

describe("hashToken", () => {
	it("should hash token using SHA-256", () => {
		const token = "test-token-12345";
		const hash = hashToken(token);

		// SHA-256 produces 64 character hex string
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[a-f0-9]+$/);
	});

	it("should produce consistent hashes for same input", () => {
		const token = "consistent-token";
		const hash1 = hashToken(token);
		const hash2 = hashToken(token);

		expect(hash1).toBe(hash2);
	});

	it("should produce different hashes for different inputs", () => {
		const hash1 = hashToken("token-a");
		const hash2 = hashToken("token-b");

		expect(hash1).not.toBe(hash2);
	});
});

describe("OAuthTokenRepository", () => {
	describe("validate", () => {
		it("should return null for non-existent token", async () => {
			const mockDb = {
				queryOne: mock(() => Promise.resolve(null)),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			const result = await repo.validate("non-existent-token");

			expect(result).toBeNull();
			expect(mockDb.queryOne).toHaveBeenCalled();
		});

		it("should return null for revoked token", async () => {
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "token-1",
						access_token_hash: hashToken("test-token"),
						access_token_prefix: "egm_oauth",
						user_id: "user-1",
						scopes: ["memory:read"],
						rate_limit_rpm: 100,
						access_token_expires_at: new Date(Date.now() + 86400000),
						refresh_token_expires_at: new Date(Date.now() + 86400000 * 30),
						created_at: new Date(),
						updated_at: new Date(),
						revoked_at: new Date(), // Token is revoked
						client_id: "client-1",
						grant_type: "device_code",
						org_id: "org-1",
						org_slug: "test-org",
					}),
				),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			const result = await repo.validate("test-token");

			expect(result).toBeNull();
		});

		it("should return null for expired token", async () => {
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "token-1",
						access_token_hash: hashToken("test-token"),
						access_token_prefix: "egm_oauth",
						user_id: "user-1",
						scopes: ["memory:read"],
						rate_limit_rpm: 100,
						access_token_expires_at: new Date(Date.now() - 86400000), // Expired
						refresh_token_expires_at: new Date(Date.now() - 86400000),
						created_at: new Date(),
						updated_at: new Date(),
						client_id: "client-1",
						grant_type: "device_code",
						org_id: "org-1",
						org_slug: "test-org",
					}),
				),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			const result = await repo.validate("test-token");

			expect(result).toBeNull();
		});

		it("should return token for valid non-expired token", async () => {
			const now = new Date();
			const expiresAt = new Date(Date.now() + 86400000);

			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "token-1",
						access_token_hash: hashToken("test-token"),
						access_token_prefix: "egm_oauth",
						user_id: "user-1",
						scopes: ["memory:read", "memory:write"],
						rate_limit_rpm: 100,
						access_token_expires_at: expiresAt,
						refresh_token_expires_at: new Date(Date.now() + 86400000 * 30),
						created_at: now,
						updated_at: now,
						client_id: "client-1",
						grant_type: "device_code" as const,
						org_id: "org-1",
						org_slug: "test-org",
						user_name: "Test User",
						user_email: "test@example.com",
					}),
				),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			const result = await repo.validate("test-token");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("token-1");
			expect(result?.userId).toBe("user-1");
			expect(result?.scopes).toEqual(["memory:read", "memory:write"]);
			expect(result?.rateLimitRpm).toBe(100);
			expect(result?.grantType).toBe("device_code");
			expect(result?.orgId).toBe("org-1");
			expect(result?.orgSlug).toBe("test-org");
			expect(result?.user?.name).toBe("Test User");
			expect(result?.user?.email).toBe("test@example.com");
		});

		it("should update last_used_at for valid token", async () => {
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "token-1",
						access_token_hash: hashToken("test-token"),
						access_token_prefix: "egm_oauth",
						user_id: "user-1",
						scopes: ["memory:read"],
						rate_limit_rpm: 100,
						access_token_expires_at: new Date(Date.now() + 86400000),
						refresh_token_expires_at: new Date(Date.now() + 86400000 * 30),
						created_at: new Date(),
						updated_at: new Date(),
						client_id: "client-1",
						grant_type: "device_code" as const,
						org_id: "org-1",
						org_slug: "test-org",
					}),
				),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			await repo.validate("test-token");

			// Give async update time to fire
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockDb.query).toHaveBeenCalled();
		});

		it("should handle missing user information", async () => {
			const mockDb = {
				queryOne: mock(() =>
					Promise.resolve({
						id: "token-1",
						access_token_hash: hashToken("test-token"),
						access_token_prefix: "egm_oauth",
						user_id: "user-1",
						scopes: ["memory:read"],
						rate_limit_rpm: 100,
						access_token_expires_at: new Date(Date.now() + 86400000),
						refresh_token_expires_at: new Date(Date.now() + 86400000 * 30),
						created_at: new Date(),
						updated_at: new Date(),
						client_id: "client-1",
						grant_type: "client_credentials" as const,
						org_id: "org-1",
						org_slug: "test-org",
						// No user_name or user_email
					}),
				),
				query: mock(() => Promise.resolve([])),
			};

			const repo = new OAuthTokenRepository(mockDb as any);
			const result = await repo.validate("test-token");

			expect(result).not.toBeNull();
			expect(result?.user).toBeUndefined();
		});
	});
});
