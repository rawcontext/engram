/**
 * Authentication middleware for Ingestion service.
 *
 * Supports both API keys and OAuth tokens:
 * - API keys: engram_live_<32 chars> or engram_test_<32 chars>
 * - OAuth tokens: engram_oauth_<32 hex chars>
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@engram/logger";
import pg from "pg";

const { Pool } = pg;

const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;
const OAUTH_TOKEN_PATTERN = /^engram_oauth_[a-f0-9]{32}$/;

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

interface OAuthTokenRow {
	id: string;
	access_token_prefix: string;
	scopes: string[];
	user_id: string;
	access_token_expires_at: Date | null;
	revoked_at: Date | null;
}

interface AuthContext {
	id: string;
	prefix: string;
	method: "api_key" | "oauth";
	scopes: string[];
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

async function validateApiKey(apiKey: string): Promise<AuthContext | null> {
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

	return {
		id: key.id,
		prefix: key.key_prefix,
		method: "api_key",
		scopes: key.scopes,
	};
}

async function validateOAuthToken(token: string): Promise<AuthContext | null> {
	if (!pool) return null;

	const tokenHash = createHash("sha256").update(token).digest("hex");

	const result = await pool.query<OAuthTokenRow>(
		`SELECT id, access_token_prefix, scopes, user_id, access_token_expires_at, revoked_at
		 FROM oauth_tokens
		 WHERE access_token_hash = $1`,
		[tokenHash],
	);

	if (result.rows.length === 0) return null;

	const row = result.rows[0];
	if (row.revoked_at) return null;
	if (row.access_token_expires_at && new Date(row.access_token_expires_at) < new Date())
		return null;

	// Update last_used_at (fire and forget)
	pool
		.query("UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1", [row.id])
		.catch(() => {});

	return {
		id: row.id,
		prefix: row.access_token_prefix,
		method: "oauth",
		scopes: row.scopes,
	};
}

async function validateToken(token: string): Promise<AuthContext | null> {
	// Try OAuth token first
	if (OAUTH_TOKEN_PATTERN.test(token)) {
		return validateOAuthToken(token);
	}

	// Try API key
	if (API_KEY_PATTERN.test(token)) {
		return validateApiKey(token);
	}

	return null;
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
 *
 * Supports both API keys and OAuth tokens.
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
		sendUnauthorized(res, "Invalid Authorization header format. Use: Bearer <token>");
		return false;
	}

	const token = authHeader.slice(7);

	// Check if token matches any valid format
	if (!API_KEY_PATTERN.test(token) && !OAUTH_TOKEN_PATTERN.test(token)) {
		sendUnauthorized(res, "Invalid token format");
		return false;
	}

	try {
		const authContext = await validateToken(token);

		if (!authContext) {
			sendUnauthorized(res, "Invalid or expired token");
			return false;
		}

		// Check scopes
		const hasScope = requiredScopes.some((scope) => authContext.scopes.includes(scope));
		if (!hasScope) {
			sendForbidden(res, `Missing required scope. Need one of: ${requiredScopes.join(", ")}`);
			return false;
		}

		authConfig.logger.debug(
			{ prefix: authContext.prefix, method: authContext.method },
			"Request authenticated",
		);
		return true;
	} catch (error) {
		authConfig.logger.error({ error }, "Failed to validate token");
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				success: false,
				error: { code: "INTERNAL_ERROR", message: "Failed to validate token" },
			}),
		);
		return false;
	}
}
