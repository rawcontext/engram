import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenCache } from "./token-cache";

describe("TokenCache", () => {
	let testDir: string;
	let cachePath: string;
	let mockLogger: any;
	let cache: TokenCache;

	beforeEach(() => {
		// Create temp directory for tests
		testDir = join(tmpdir(), `engram-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
		cachePath = join(testDir, "auth.json");

		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		cache = new TokenCache({ logger: mockLogger, cachePath });
	});

	afterEach(() => {
		// Clean up temp directory
		try {
			if (existsSync(testDir)) {
				rmSync(testDir, { recursive: true });
			}
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("getPath", () => {
		it("should return the configured cache path", () => {
			expect(cache.getPath()).toBe(cachePath);
		});
	});

	describe("load", () => {
		it("should return null when cache file does not exist", () => {
			const result = cache.load();
			expect(result).toBeNull();
		});

		it("should load tokens from cache file", () => {
			const tokens = {
				access_token: "test-access-token",
				refresh_token: "test-refresh-token",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			writeFileSync(cachePath, JSON.stringify(tokens));

			const result = cache.load();

			expect(result).not.toBeNull();
			expect(result?.access_token).toBe("test-access-token");
			expect(result?.user.email).toBe("test@example.com");
		});

		it("should return null for invalid JSON", () => {
			writeFileSync(cachePath, "invalid json");

			const result = cache.load();

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it("should return null for missing required fields", () => {
			const tokens = {
				access_token: "test-token",
				// Missing expires_at and user
			};

			writeFileSync(cachePath, JSON.stringify(tokens));

			const result = cache.load();

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe("save", () => {
		it("should save tokens to cache file", () => {
			const tokens = {
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			expect(existsSync(cachePath)).toBe(true);
			const loaded = cache.load();
			expect(loaded?.access_token).toBe("new-access-token");
		});

		it("should create directory if it does not exist", () => {
			const nestedPath = join(testDir, "nested", "dir", "auth.json");
			const nestedCache = new TokenCache({ logger: mockLogger, cachePath: nestedPath });

			const tokens = {
				access_token: "test-token",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			nestedCache.save(tokens);

			expect(existsSync(nestedPath)).toBe(true);
		});
	});

	describe("clear", () => {
		it("should clear the token cache", () => {
			const tokens = {
				access_token: "test-token",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);
			cache.clear();

			const result = cache.load();
			expect(result).toBeNull();
		});

		it("should not throw if cache file does not exist", () => {
			expect(() => cache.clear()).not.toThrow();
		});
	});

	describe("getAccessToken", () => {
		it("should return null when no tokens cached", () => {
			const token = cache.getAccessToken();
			expect(token).toBeNull();
		});

		it("should return access token when valid", () => {
			const tokens = {
				access_token: "valid-access-token",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 3600000, // 1 hour from now
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);
			// Clear internal cache to force reload
			cache.clear();
			cache.save(tokens);

			const token = cache.getAccessToken();
			expect(token).toBe("valid-access-token");
		});

		it("should return null when access token is expired", () => {
			const tokens = {
				access_token: "expired-token",
				refresh_token: "test-refresh",
				expires_at: Date.now() - 1000, // Already expired
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now() - 3600000,
			};

			cache.save(tokens);

			const token = cache.getAccessToken();
			expect(token).toBeNull();
		});

		it("should return null when within refresh buffer", () => {
			const tokens = {
				access_token: "about-to-expire",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 60000, // 1 minute from now (within 5 min buffer)
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			const token = cache.getAccessToken();
			expect(token).toBeNull();
		});
	});

	describe("getRefreshToken", () => {
		it("should return null when no tokens cached", () => {
			const token = cache.getRefreshToken();
			expect(token).toBeNull();
		});

		it("should return refresh token when present", () => {
			const tokens = {
				access_token: "test-access",
				refresh_token: "my-refresh-token",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			const token = cache.getRefreshToken();
			expect(token).toBe("my-refresh-token");
		});
	});

	describe("getUser", () => {
		it("should return null when no tokens cached", () => {
			const user = cache.getUser();
			expect(user).toBeNull();
		});

		it("should return user info when tokens cached", () => {
			const tokens = {
				access_token: "test-access",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-123", email: "user@test.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			const user = cache.getUser();
			expect(user?.id).toBe("user-123");
			expect(user?.email).toBe("user@test.com");
		});
	});

	describe("isAccessTokenExpired", () => {
		it("should return true when no tokens", () => {
			expect(cache.isAccessTokenExpired()).toBe(true);
		});

		it("should return false when token is valid", () => {
			const tokens = {
				access_token: "test-access",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 600000, // 10 minutes from now
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			expect(cache.isAccessTokenExpired()).toBe(false);
		});

		it("should return true when token is expired", () => {
			const tokens = {
				access_token: "test-access",
				refresh_token: "test-refresh",
				expires_at: Date.now() - 1000, // Already expired
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now() - 3600000,
			};

			cache.save(tokens);

			expect(cache.isAccessTokenExpired()).toBe(true);
		});
	});

	describe("needsRefresh", () => {
		it("should return false when no tokens", () => {
			expect(cache.needsRefresh()).toBe(false);
		});

		it("should return true when expired and has refresh token", () => {
			const tokens = {
				access_token: "test-access",
				refresh_token: "valid-refresh-token",
				expires_at: Date.now() - 1000, // Expired
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now() - 3600000,
			};

			cache.save(tokens);

			expect(cache.needsRefresh()).toBe(true);
		});

		it("should return false when expired but no refresh token", () => {
			const tokens = {
				access_token: "test-access",
				expires_at: Date.now() - 1000, // Expired
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now() - 3600000,
			};

			writeFileSync(cachePath, JSON.stringify(tokens));

			// Force reload with invalid tokens
			expect(cache.needsRefresh()).toBe(false);
		});
	});

	describe("hasValidTokens", () => {
		it("should return false when no valid tokens", () => {
			expect(cache.hasValidTokens()).toBe(false);
		});

		it("should return true when valid tokens exist", () => {
			const tokens = {
				access_token: "valid-token",
				refresh_token: "test-refresh",
				expires_at: Date.now() + 600000, // 10 minutes from now
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};

			cache.save(tokens);

			expect(cache.hasValidTokens()).toBe(true);
		});
	});

	describe("updateTokens", () => {
		it("should update tokens with new values", () => {
			// First set up initial tokens
			const initialTokens = {
				access_token: "old-token",
				refresh_token: "old-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};
			cache.save(initialTokens);

			// Update tokens
			cache.updateTokens("new-access-token", "new-refresh-token", 7200);

			const updated = cache.load();
			expect(updated?.access_token).toBe("new-access-token");
			expect(updated?.refresh_token).toBe("new-refresh-token");
		});

		it("should preserve user info from existing tokens", () => {
			const initialTokens = {
				access_token: "old-token",
				refresh_token: "old-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "test@example.com" },
				cached_at: Date.now(),
			};
			cache.save(initialTokens);

			cache.updateTokens("new-token", "new-refresh", 3600);

			const updated = cache.load();
			expect(updated?.user.email).toBe("test@example.com");
		});

		it("should use provided user info", () => {
			const initialTokens = {
				access_token: "old-token",
				refresh_token: "old-refresh",
				expires_at: Date.now() + 3600000,
				user: { id: "user-1", email: "old@example.com" },
				cached_at: Date.now(),
			};
			cache.save(initialTokens);

			cache.updateTokens("new-token", "new-refresh", 3600, {
				id: "user-2",
				email: "new@example.com",
			});

			const updated = cache.load();
			expect(updated?.user.email).toBe("new@example.com");
		});

		it("should throw when no user info available", () => {
			expect(() => cache.updateTokens("token", "refresh", 3600)).toThrow(
				"No user info available for token update",
			);
		});
	});
});
