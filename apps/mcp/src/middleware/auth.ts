import { createHash } from "node:crypto";
import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import pg from "pg";

const { Pool } = pg;

// API key prefix pattern
const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;

export interface ApiKeyAuthOptions {
	logger: Logger;
	postgresUrl: string;
}

export interface ApiKeyContext {
	keyId: string;
	keyPrefix: string;
	keyType: "live" | "test";
	userId?: string;
	scopes: string[];
	rateLimit: number;
}

interface ApiKeyRow {
	id: string;
	key_prefix: string;
	key_type: "live" | "test";
	user_id: string | null;
	scopes: string[];
	rate_limit_rpm: number;
	is_active: boolean;
	expires_at: Date | null;
}

/**
 * Create API key authentication middleware for Hono
 */
export function createApiKeyAuth(options: ApiKeyAuthOptions) {
	const { logger, postgresUrl } = options;

	const pool = new Pool({
		connectionString: postgresUrl,
		max: 5,
		idleTimeoutMillis: 30000,
	});

	async function validateKey(apiKey: string): Promise<ApiKeyRow | null> {
		const keyHash = createHash("sha256").update(apiKey).digest("hex");

		const result = await pool.query<ApiKeyRow>(
			`SELECT id, key_prefix, key_type, user_id, scopes, rate_limit_rpm, is_active, expires_at
			 FROM api_keys
			 WHERE key_hash = $1`,
			[keyHash],
		);

		if (result.rows.length === 0) {
			return null;
		}

		const key = result.rows[0];

		if (!key.is_active) {
			return null;
		}

		if (key.expires_at && new Date(key.expires_at) < new Date()) {
			return null;
		}

		// Update last_used_at (fire and forget)
		pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [key.id]).catch((err) => {
			logger.warn({ error: err }, "Failed to update last_used_at");
		});

		return key;
	}

	const middleware = async (c: Context, next: Next) => {
		const authHeader = c.req.header("Authorization");

		if (!authHeader) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Missing Authorization header",
					},
				},
				401,
			);
		}

		if (!authHeader.startsWith("Bearer ")) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid Authorization header format. Use: Bearer <api_key>",
					},
				},
				401,
			);
		}

		const apiKey = authHeader.slice(7);

		if (!API_KEY_PATTERN.test(apiKey)) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid API key format",
					},
				},
				401,
			);
		}

		try {
			const validatedKey = await validateKey(apiKey);

			if (!validatedKey) {
				return c.json(
					{
						success: false,
						error: {
							code: "UNAUTHORIZED",
							message: "Invalid or expired API key",
						},
					},
					401,
				);
			}

			const keyContext: ApiKeyContext = {
				keyId: validatedKey.id,
				keyPrefix: validatedKey.key_prefix,
				keyType: validatedKey.key_type,
				userId: validatedKey.user_id ?? undefined,
				scopes: validatedKey.scopes,
				rateLimit: validatedKey.rate_limit_rpm,
			};

			c.set("apiKey", keyContext);

			logger.debug(
				{ keyId: keyContext.keyId, keyPrefix: keyContext.keyPrefix },
				"API key authenticated",
			);

			await next();
		} catch (error) {
			logger.error({ error }, "Failed to validate API key");
			return c.json(
				{
					success: false,
					error: {
						code: "INTERNAL_ERROR",
						message: "Failed to validate API key",
					},
				},
				500,
			);
		}
	};

	const close = async () => {
		await pool.end();
	};

	return { middleware, close };
}

/**
 * Middleware to require specific scopes
 */
export function requireScopes(...requiredScopes: string[]) {
	return async (c: Context, next: Next) => {
		const apiKey = c.get("apiKey") as ApiKeyContext | undefined;

		if (!apiKey) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "No API key context",
					},
				},
				401,
			);
		}

		const hasScope = requiredScopes.some((scope) => apiKey.scopes.includes(scope));

		if (!hasScope) {
			return c.json(
				{
					success: false,
					error: {
						code: "FORBIDDEN",
						message: `Missing required scope. Need one of: ${requiredScopes.join(", ")}`,
					},
				},
				403,
			);
		}

		await next();
	};
}
