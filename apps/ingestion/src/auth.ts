import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@engram/logger";
import pg from "pg";

const { Pool } = pg;

const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;

interface AuthConfig {
	enabled: boolean;
	postgresUrl: string;
	logger: Logger;
}

interface ApiKeyRow {
	id: string;
	key_prefix: string;
	scopes: string[];
	is_active: boolean;
	expires_at: Date | null;
}

let pool: InstanceType<typeof Pool> | null = null;
let authConfig: AuthConfig | null = null;

export function initAuth(config: AuthConfig): void {
	authConfig = config;
	if (config.enabled) {
		pool = new Pool({
			connectionString: config.postgresUrl,
			max: 5,
			idleTimeoutMillis: 30000,
		});
		config.logger.info("API key authentication enabled");
	} else {
		config.logger.warn("API key authentication DISABLED (AUTH_ENABLED=false)");
	}
}

export async function closeAuth(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

async function validateApiKey(apiKey: string): Promise<ApiKeyRow | null> {
	if (!pool) return null;

	const keyHash = createHash("sha256").update(apiKey).digest("hex");

	const result = await pool.query<ApiKeyRow>(
		`SELECT id, key_prefix, scopes, is_active, expires_at
		 FROM api_keys
		 WHERE key_hash = $1`,
		[keyHash],
	);

	if (result.rows.length === 0) return null;

	const key = result.rows[0];
	if (!key.is_active) return null;
	if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

	// Update last_used_at (fire and forget)
	pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [key.id]).catch(() => {});

	return key;
}

function sendUnauthorized(res: ServerResponse, message: string): void {
	res.writeHead(401, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			success: false,
			error: { code: "UNAUTHORIZED", message },
		}),
	);
}

function sendForbidden(res: ServerResponse, message: string): void {
	res.writeHead(403, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			success: false,
			error: { code: "FORBIDDEN", message },
		}),
	);
}

/**
 * Authenticate incoming request. Returns true if authorized, false if rejected.
 * When false, response has already been sent.
 */
export async function authenticateRequest(
	req: IncomingMessage,
	res: ServerResponse,
	requiredScopes: string[],
): Promise<boolean> {
	// Skip auth if disabled
	if (!authConfig?.enabled) {
		return true;
	}

	const authHeader = req.headers.authorization;

	if (!authHeader) {
		sendUnauthorized(res, "Missing Authorization header");
		return false;
	}

	if (!authHeader.startsWith("Bearer ")) {
		sendUnauthorized(res, "Invalid Authorization header format. Use: Bearer <api_key>");
		return false;
	}

	const apiKey = authHeader.slice(7);

	if (!API_KEY_PATTERN.test(apiKey)) {
		sendUnauthorized(res, "Invalid API key format");
		return false;
	}

	try {
		const validatedKey = await validateApiKey(apiKey);

		if (!validatedKey) {
			sendUnauthorized(res, "Invalid or expired API key");
			return false;
		}

		// Check scopes
		const hasScope = requiredScopes.some((scope) => validatedKey.scopes.includes(scope));
		if (!hasScope) {
			sendForbidden(res, `Missing required scope. Need one of: ${requiredScopes.join(", ")}`);
			return false;
		}

		authConfig.logger.debug({ keyPrefix: validatedKey.key_prefix }, "API key authenticated");
		return true;
	} catch (error) {
		authConfig.logger.error({ error }, "Failed to validate API key");
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				success: false,
				error: { code: "INTERNAL_ERROR", message: "Failed to validate API key" },
			}),
		);
		return false;
	}
}
