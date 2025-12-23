import { createHash, randomBytes } from "node:crypto";
import { apiError, apiSuccess } from "@lib/api-response";
import { auth } from "@lib/auth";
import { Pool } from "pg";

const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

function generateApiKey(): string {
	const randomPart = randomBytes(16).toString("hex");
	return `engram_live_${randomPart}`;
}

function hashApiKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

function generateId(): string {
	// Simple ULID-like ID
	const timestamp = Date.now().toString(36);
	const random = randomBytes(10).toString("hex");
	return `${timestamp}${random}`.toUpperCase().slice(0, 26);
}

/**
 * GET /api/keys - List API keys for the authenticated user
 */
export async function GET(request: Request) {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return apiError("Unauthorized", "UNAUTHORIZED", 401);
	}

	try {
		const result = await pool.query(
			`SELECT id, key_prefix, key_type, name, description, scopes,
			        rate_limit_rpm, is_active, expires_at, created_at,
			        updated_at, last_used_at
			 FROM api_keys
			 WHERE user_id = $1
			 ORDER BY created_at DESC`,
			[session.user.id],
		);

		const keys = result.rows.map((row) => ({
			id: row.id,
			keyPrefix: row.key_prefix,
			keyType: row.key_type,
			name: row.name,
			description: row.description,
			scopes: row.scopes,
			rateLimitRpm: row.rate_limit_rpm,
			isActive: row.is_active,
			expiresAt: row.expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastUsedAt: row.last_used_at,
		}));

		return apiSuccess({ keys });
	} catch (error) {
		console.error("Error listing API keys:", error);
		return apiError("Failed to list API keys", "LIST_KEYS_FAILED", 500);
	}
}

/**
 * POST /api/keys - Create a new API key
 */
export async function POST(request: Request) {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return apiError("Unauthorized", "UNAUTHORIZED", 401);
	}

	try {
		const body = await request.json();
		const { name, description, scopes, expiresInDays } = body;

		if (!name || typeof name !== "string" || name.length < 1) {
			return apiError("Name is required", "VALIDATION_ERROR", 400);
		}

		// Generate key
		const key = generateApiKey();
		const id = generateId();
		const keyHash = hashApiKey(key);
		const keyPrefix = `${key.slice(0, 20)}...`;
		const finalScopes = scopes ?? ["memory:read", "memory:write", "query:read"];

		// Calculate expiration
		const expiresAt = expiresInDays
			? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
			: null;

		await pool.query(
			`INSERT INTO api_keys (
				id, key_hash, key_prefix, key_type, user_id, name, description,
				scopes, rate_limit_rpm, expires_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			[
				id,
				keyHash,
				keyPrefix,
				"live",
				session.user.id,
				name,
				description ?? null,
				finalScopes,
				60,
				expiresAt,
			],
		);

		return apiSuccess(
			{
				id,
				key, // Only returned on creation!
				keyPrefix,
				name,
				description,
				scopes: finalScopes,
				expiresAt,
			},
			201,
			{ warning: "Save this key now - it won't be shown again!" },
		);
	} catch (error) {
		console.error("Error creating API key:", error);
		return apiError("Failed to create API key", "CREATE_KEY_FAILED", 500);
	}
}

/**
 * DELETE /api/keys - Revoke an API key
 */
export async function DELETE(request: Request) {
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		return apiError("Unauthorized", "UNAUTHORIZED", 401);
	}

	try {
		const { searchParams } = new URL(request.url);
		const keyId = searchParams.get("id");

		if (!keyId) {
			return apiError("Key ID is required", "VALIDATION_ERROR", 400);
		}

		// Verify ownership and revoke
		const result = await pool.query(
			`UPDATE api_keys
			 SET is_active = false, updated_at = NOW()
			 WHERE id = $1 AND user_id = $2
			 RETURNING id`,
			[keyId, session.user.id],
		);

		if (result.rowCount === 0) {
			return apiError("Key not found or already revoked", "NOT_FOUND", 404);
		}

		return apiSuccess({ id: keyId, revoked: true });
	} catch (error) {
		console.error("Error revoking API key:", error);
		return apiError("Failed to revoke API key", "REVOKE_KEY_FAILED", 500);
	}
}
