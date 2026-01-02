/**
 * Authentication middleware for Ingestion service.
 *
 * Supports OAuth tokens:
 * - User tokens: egm_oauth_{random32}_{crc6}
 * - Client tokens: egm_client_{random32}_{crc6}
 */

import { TOKEN_PATTERNS } from "@engram/common";
import type { Logger } from "@engram/logger";
import pg from "pg";

const { Pool } = pg;

interface AuthConfig {
	enabled: boolean;
	postgresUrl: string;
	logger: Logger;
}

interface OAuthTokenRow {
	id: string;
	access_token_prefix: string;
	scopes: string[];
	user_id: string;
	org_id: string;
	org_slug: string;
	access_token_expires_at: Date | null;
	revoked_at: Date | null;
}

interface AuthContext {
	id: string;
	prefix: string;
	method: "oauth";
	scopes: string[];
	userId: string;
	orgId: string;
	orgSlug: string;
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
		config.logger.info("OAuth authentication enabled");
	} else {
		config.logger.warn("OAuth authentication DISABLED (AUTH_ENABLED=false)");
	}
}

export async function closeAuth(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

async function validateOAuthToken(token: string): Promise<AuthContext | null> {
	if (!pool) return null;

	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	const tokenHash = hasher.digest("hex");

	const result = await pool.query<OAuthTokenRow>(
		`SELECT id, access_token_prefix, scopes, user_id, org_id, org_slug, access_token_expires_at, revoked_at
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
		userId: row.user_id,
		orgId: row.org_id,
		orgSlug: row.org_slug,
	};
}

async function validateToken(token: string): Promise<AuthContext | null> {
	// Validate token format (user or client credentials token)
	if (!TOKEN_PATTERNS.user.test(token) && !TOKEN_PATTERNS.client.test(token)) {
		return null;
	}

	// Validate OAuth token via database
	return validateOAuthToken(token);
}

function createUnauthorizedResponse(message: string): Response {
	return new Response(
		JSON.stringify({
			success: false,
			error: { code: "UNAUTHORIZED", message },
		}),
		{
			status: 401,
			headers: { "Content-Type": "application/json" },
		},
	);
}

function createForbiddenResponse(message: string): Response {
	return new Response(
		JSON.stringify({
			success: false,
			error: { code: "FORBIDDEN", message },
		}),
		{
			status: 403,
			headers: { "Content-Type": "application/json" },
		},
	);
}

/**
 * Authenticate incoming request. Returns AuthContext if authorized, Response if rejected.
 * When Response is returned, it should be sent to the client.
 *
 * Supports OAuth tokens only.
 */
export async function authenticateRequest(
	req: Request,
	requiredScopes: string[],
): Promise<AuthContext | Response> {
	// Skip auth if disabled (return minimal context)
	if (!authConfig?.enabled) {
		return {
			id: "dev",
			prefix: "dev",
			method: "oauth",
			scopes: [],
			userId: "dev-user",
			orgId: "dev-org",
			orgSlug: "dev",
		};
	}

	const authHeader = req.headers.get("authorization");

	if (!authHeader) {
		return createUnauthorizedResponse("Missing Authorization header");
	}

	if (!authHeader.startsWith("Bearer ")) {
		return createUnauthorizedResponse("Invalid Authorization header format. Use: Bearer <token>");
	}

	const token = authHeader.slice(7);

	try {
		const authContext = await validateToken(token);

		if (!authContext) {
			return createUnauthorizedResponse("Invalid or expired token");
		}

		// Check scopes
		const hasScope = requiredScopes.some((scope) => authContext.scopes.includes(scope));
		if (!hasScope) {
			return createForbiddenResponse(
				`Missing required scope. Need one of: ${requiredScopes.join(", ")}`,
			);
		}

		authConfig.logger.debug(
			{ prefix: authContext.prefix, method: authContext.method },
			"Request authenticated",
		);
		return authContext;
	} catch (error) {
		authConfig.logger.error({ error }, "Failed to validate token");
		return new Response(
			JSON.stringify({
				success: false,
				error: { code: "INTERNAL_ERROR", message: "Failed to validate token" },
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}
