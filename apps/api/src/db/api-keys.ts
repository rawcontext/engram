import { createHash } from "node:crypto";
import type { PostgresClient } from "@engram/storage";

export interface ApiKey {
	id: string;
	keyHash: string;
	keyPrefix: string;
	keyType: "live" | "test";
	userId?: string;
	name: string;
	description?: string;
	scopes: string[];
	rateLimitRpm: number;
	isActive: boolean;
	expiresAt?: Date;
	createdAt: Date;
	updatedAt: Date;
	lastUsedAt?: Date;
	metadata: Record<string, unknown>;
}

interface DbApiKey {
	id: string;
	key_hash: string;
	key_prefix: string;
	key_type: "live" | "test";
	user_id?: string;
	name: string;
	description?: string;
	scopes: string[];
	rate_limit_rpm: number;
	is_active: boolean;
	expires_at?: Date;
	created_at: Date;
	updated_at: Date;
	last_used_at?: Date;
	metadata: Record<string, unknown>;
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/**
 * Repository for API key operations
 */
export class ApiKeyRepository {
	constructor(private readonly db: PostgresClient) {}

	/**
	 * Find an API key by its hash
	 */
	async findByHash(keyHash: string): Promise<ApiKey | null> {
		const row = await this.db.queryOne<DbApiKey>(
			`
			SELECT
				id, key_hash, key_prefix, key_type, user_id, name, description,
				scopes, rate_limit_rpm, is_active, expires_at,
				created_at, updated_at, last_used_at, metadata
			FROM api_keys
			WHERE key_hash = $1
			`,
			[keyHash],
		);

		if (!row) {
			return null;
		}

		return this.mapFromDb(row);
	}

	/**
	 * Validate an API key and return its metadata
	 * Returns null if key is invalid, inactive, or expired
	 */
	async validate(key: string): Promise<ApiKey | null> {
		const keyHash = hashApiKey(key);
		const apiKey = await this.findByHash(keyHash);

		if (!apiKey) {
			return null;
		}

		// Check if key is active
		if (!apiKey.isActive) {
			return null;
		}

		// Check if key is expired
		if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
			return null;
		}

		// Update last used timestamp (fire and forget)
		this.updateLastUsed(apiKey.id).catch(() => {
			// Ignore errors - this is a non-critical operation
		});

		return apiKey;
	}

	/**
	 * Update the last_used_at timestamp for a key
	 */
	private async updateLastUsed(id: string): Promise<void> {
		await this.db.query(
			`
			UPDATE api_keys
			SET last_used_at = NOW()
			WHERE id = $1
			`,
			[id],
		);
	}

	/**
	 * Create a new API key
	 */
	async create(params: {
		id: string;
		key: string;
		keyType: "live" | "test";
		name: string;
		description?: string;
		userId?: string;
		scopes?: string[];
		rateLimitRpm?: number;
		expiresAt?: Date;
		metadata?: Record<string, unknown>;
	}): Promise<ApiKey> {
		const keyHash = hashApiKey(params.key);
		const keyPrefix = `${params.key.slice(0, 20)}...`;
		const scopes = params.scopes ?? ["memory:read", "memory:write", "query:read"];
		const rateLimitRpm = params.rateLimitRpm ?? 60;
		const metadata = params.metadata ?? {};

		const row = await this.db.queryOne<DbApiKey>(
			`
			INSERT INTO api_keys (
				id, key_hash, key_prefix, key_type, user_id, name, description,
				scopes, rate_limit_rpm, expires_at, metadata
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING
				id, key_hash, key_prefix, key_type, user_id, name, description,
				scopes, rate_limit_rpm, is_active, expires_at,
				created_at, updated_at, last_used_at, metadata
			`,
			[
				params.id,
				keyHash,
				keyPrefix,
				params.keyType,
				params.userId,
				params.name,
				params.description,
				scopes,
				rateLimitRpm,
				params.expiresAt,
				JSON.stringify(metadata),
			],
		);

		if (!row) {
			throw new Error("Failed to create API key");
		}

		return this.mapFromDb(row);
	}

	/**
	 * Revoke (deactivate) an API key
	 */
	async revoke(id: string): Promise<void> {
		await this.db.query(
			`
			UPDATE api_keys
			SET is_active = false
			WHERE id = $1
			`,
			[id],
		);
	}

	/**
	 * Rotate an API key atomically - revokes old key and creates new one in a transaction
	 * This ensures either both operations succeed or both fail, preventing orphaned states.
	 *
	 * @example
	 * const newKey = await repo.rotate(oldKeyId, {
	 *   id: ulid(),
	 *   key: generateNewKey(),
	 *   keyType: "live",
	 *   name: "Rotated API Key"
	 * });
	 */
	async rotate(
		oldKeyId: string,
		newKeyParams: {
			id: string;
			key: string;
			keyType: "live" | "test";
			name: string;
			description?: string;
			userId?: string;
			scopes?: string[];
			rateLimitRpm?: number;
			expiresAt?: Date;
			metadata?: Record<string, unknown>;
		},
	): Promise<ApiKey> {
		return this.db.transaction(async (client) => {
			// 1. Revoke old key
			await client.query(
				`
				UPDATE api_keys
				SET is_active = false, updated_at = NOW()
				WHERE id = $1
				`,
				[oldKeyId],
			);

			// 2. Create new key
			const keyHash = hashApiKey(newKeyParams.key);
			const keyPrefix = `${newKeyParams.key.slice(0, 20)}...`;
			const scopes = newKeyParams.scopes ?? ["memory:read", "memory:write", "query:read"];
			const rateLimitRpm = newKeyParams.rateLimitRpm ?? 60;
			const metadata = newKeyParams.metadata ?? {};

			const result = await client.query<DbApiKey>(
				`
				INSERT INTO api_keys (
					id, key_hash, key_prefix, key_type, user_id, name, description,
					scopes, rate_limit_rpm, expires_at, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				RETURNING
					id, key_hash, key_prefix, key_type, user_id, name, description,
					scopes, rate_limit_rpm, is_active, expires_at,
					created_at, updated_at, last_used_at, metadata
				`,
				[
					newKeyParams.id,
					keyHash,
					keyPrefix,
					newKeyParams.keyType,
					newKeyParams.userId,
					newKeyParams.name,
					newKeyParams.description,
					scopes,
					rateLimitRpm,
					newKeyParams.expiresAt,
					JSON.stringify(metadata),
				],
			);

			if (!result.rows[0]) {
				throw new Error("Failed to create new API key during rotation");
			}

			return this.mapFromDb(result.rows[0]);
		});
	}

	/**
	 * List API keys for a user
	 */
	async listByUser(userId: string): Promise<ApiKey[]> {
		const rows = await this.db.queryMany<DbApiKey>(
			`
			SELECT
				id, key_hash, key_prefix, key_type, user_id, name, description,
				scopes, rate_limit_rpm, is_active, expires_at,
				created_at, updated_at, last_used_at, metadata
			FROM api_keys
			WHERE user_id = $1
			ORDER BY created_at DESC
			`,
			[userId],
		);

		return rows.map((row) => this.mapFromDb(row));
	}

	/**
	 * Map database row to ApiKey
	 */
	private mapFromDb(row: DbApiKey): ApiKey {
		return {
			id: row.id,
			keyHash: row.key_hash,
			keyPrefix: row.key_prefix,
			keyType: row.key_type,
			userId: row.user_id,
			name: row.name,
			description: row.description,
			scopes: row.scopes,
			rateLimitRpm: row.rate_limit_rpm,
			isActive: row.is_active,
			expiresAt: row.expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastUsedAt: row.last_used_at,
			metadata: row.metadata,
		};
	}
}
