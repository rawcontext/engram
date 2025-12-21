import { describe, expect, it, vi } from "vitest";
import { ApiKeyRepository, hashApiKey } from "./api-keys";

describe("hashApiKey", () => {
	it("should return a consistent hash for the same input", () => {
		const key = "engram_live_abcdefghijklmnopqrstuvwxyz123456";
		const hash1 = hashApiKey(key);
		const hash2 = hashApiKey(key);

		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64); // SHA-256 hex length
	});

	it("should return different hashes for different inputs", () => {
		const hash1 = hashApiKey("key1");
		const hash2 = hashApiKey("key2");

		expect(hash1).not.toBe(hash2);
	});
});

describe("ApiKeyRepository", () => {
	const createMockDb = () => ({
		query: vi.fn(),
		queryOne: vi.fn(),
		queryMany: vi.fn(),
		transaction: vi.fn(),
	});

	const sampleDbRow = {
		id: "key-uuid-123",
		key_hash: "abc123hash",
		key_prefix: "engram_live_abcdefghij...",
		key_type: "live" as const,
		user_id: "user-123",
		name: "Test Key",
		description: "A test key",
		scopes: ["memory:read", "memory:write"],
		rate_limit_rpm: 60,
		is_active: true,
		expires_at: null,
		created_at: new Date("2024-01-01"),
		updated_at: new Date("2024-01-01"),
		last_used_at: null,
		metadata: {},
	};

	describe("findByHash", () => {
		it("should return null when key not found", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(null);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.findByHash("nonexistent");

			expect(result).toBeNull();
			expect(mockDb.queryOne).toHaveBeenCalledWith(expect.stringContaining("WHERE key_hash = $1"), [
				"nonexistent",
			]);
		});

		it("should return mapped API key when found", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(sampleDbRow);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.findByHash("abc123hash");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("key-uuid-123");
			expect(result?.keyHash).toBe("abc123hash");
			expect(result?.keyPrefix).toBe("engram_live_abcdefghij...");
			expect(result?.keyType).toBe("live");
			expect(result?.userId).toBe("user-123");
			expect(result?.scopes).toEqual(["memory:read", "memory:write"]);
			expect(result?.rateLimitRpm).toBe(60);
			expect(result?.isActive).toBe(true);
		});
	});

	describe("validate", () => {
		it("should return null when key not found", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(null);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.validate("engram_live_abcdefghijklmnopqrstuvwxyz123456");

			expect(result).toBeNull();
		});

		it("should return null when key is inactive", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue({ ...sampleDbRow, is_active: false });

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.validate("engram_live_abcdefghijklmnopqrstuvwxyz123456");

			expect(result).toBeNull();
		});

		it("should return null when key is expired", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue({
				...sampleDbRow,
				expires_at: new Date("2020-01-01"), // Past date
			});

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.validate("engram_live_abcdefghijklmnopqrstuvwxyz123456");

			expect(result).toBeNull();
		});

		it("should return key and update last used on valid key", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(sampleDbRow);
			mockDb.query.mockResolvedValue(undefined);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.validate("engram_live_abcdefghijklmnopqrstuvwxyz123456");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("key-uuid-123");

			// Should fire-and-forget update last_used_at
			await new Promise((r) => setTimeout(r, 10));
			expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE api_keys"), [
				"key-uuid-123",
			]);
		});

		it("should allow non-expired keys with future expiration", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue({
				...sampleDbRow,
				expires_at: new Date(Date.now() + 86400000), // Tomorrow
			});

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.validate("engram_live_abcdefghijklmnopqrstuvwxyz123456");

			expect(result).not.toBeNull();
		});
	});

	describe("create", () => {
		it("should create a new API key with defaults", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(sampleDbRow);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.create({
				id: "new-key-id",
				key: "engram_live_abcdefghijklmnopqrstuvwxyz123456",
				keyType: "live",
				name: "New Key",
			});

			expect(mockDb.queryOne).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO api_keys"),
				expect.arrayContaining([
					"new-key-id",
					expect.any(String), // hash
					expect.stringContaining("..."), // prefix
					"live",
					undefined, // userId
					"New Key",
					undefined, // description
					["memory:read", "memory:write", "query:read"], // default scopes
					60, // default rate limit
					undefined, // expiresAt
					"{}", // empty metadata
				]),
			);

			expect(result.id).toBe("key-uuid-123");
		});

		it("should throw when insert fails", async () => {
			const mockDb = createMockDb();
			mockDb.queryOne.mockResolvedValue(null);

			const repo = new ApiKeyRepository(mockDb as any);

			await expect(
				repo.create({
					id: "new-key-id",
					key: "engram_live_abcdefghijklmnopqrstuvwxyz123456",
					keyType: "live",
					name: "New Key",
				}),
			).rejects.toThrow("Failed to create API key");
		});
	});

	describe("revoke", () => {
		it("should update key to inactive", async () => {
			const mockDb = createMockDb();
			mockDb.query.mockResolvedValue(undefined);

			const repo = new ApiKeyRepository(mockDb as any);
			await repo.revoke("key-uuid-123");

			expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("SET is_active = false"), [
				"key-uuid-123",
			]);
		});
	});

	describe("listByUser", () => {
		it("should return all keys for user", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([sampleDbRow, { ...sampleDbRow, id: "key-2" }]);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.listByUser("user-123");

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("key-uuid-123");
			expect(result[1].id).toBe("key-2");
			expect(mockDb.queryMany).toHaveBeenCalledWith(expect.stringContaining("WHERE user_id = $1"), [
				"user-123",
			]);
		});

		it("should return empty array when no keys found", async () => {
			const mockDb = createMockDb();
			mockDb.queryMany.mockResolvedValue([]);

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.listByUser("nonexistent-user");

			expect(result).toEqual([]);
		});
	});

	describe("rotate", () => {
		it("should revoke old key and create new one in transaction", async () => {
			const mockDb = createMockDb();
			const mockClient = {
				query: vi.fn().mockResolvedValue({ rows: [sampleDbRow] }),
			};
			mockDb.transaction.mockImplementation(async (fn) => fn(mockClient));

			const repo = new ApiKeyRepository(mockDb as any);
			const result = await repo.rotate("old-key-id", {
				id: "new-key-id",
				key: "engram_live_newkeyabcdefghijklmnop123456",
				keyType: "live",
				name: "Rotated Key",
			});

			expect(mockDb.transaction).toHaveBeenCalled();
			expect(mockClient.query).toHaveBeenCalledTimes(2);

			// First call should revoke old key
			expect(mockClient.query).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("SET is_active = false"),
				["old-key-id"],
			);

			// Second call should insert new key
			expect(mockClient.query).toHaveBeenNthCalledWith(
				2,
				expect.stringContaining("INSERT INTO api_keys"),
				expect.any(Array),
			);

			expect(result.id).toBe("key-uuid-123");
		});
	});
});
