/**
 * OAuth Device Flow Authentication Library
 *
 * Implements RFC 8628 OAuth 2.0 Device Authorization Grant for MCP authentication.
 * Users authenticate via Observatory, tokens are issued for MCP server use.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { createHash, randomBytes } from "node:crypto";
import type {
	DeviceCodeRecord,
	DeviceCodeResponse,
	OAuthTokenRecord,
	TokenErrorResponse,
	TokenResponse,
} from "@engram/common/types";
import { OAuthConfig } from "@engram/common/types";
import { Pool } from "pg";

// =============================================================================
// Database Client
// =============================================================================

const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Generate a cryptographically secure device code (32 hex chars).
 */
export function generateDeviceCode(): string {
	return randomBytes(16).toString("hex");
}

/**
 * Generate a human-readable user code (XXXX-XXXX format).
 * Excludes ambiguous characters: 0, O, I, 1, L
 */
export function generateUserCode(): string {
	const chars = OAuthConfig.USER_CODE_CHARS;
	let code = "";

	const bytes = randomBytes(8);
	for (let i = 0; i < 8; i++) {
		code += chars[bytes[i] % chars.length];
		if (i === 3) code += "-";
	}

	return code;
}

/**
 * Normalize a user code for comparison (uppercase, remove dashes/spaces).
 */
export function normalizeUserCode(code: string): string {
	return code.toUpperCase().replace(/[-\s]/g, "");
}

/**
 * Generate an OAuth access token.
 */
export function generateAccessToken(): string {
	return `engram_oauth_${randomBytes(16).toString("hex")}`;
}

/**
 * Generate an OAuth refresh token.
 */
export function generateRefreshToken(): string {
	return `engram_refresh_${randomBytes(16).toString("hex")}`;
}

/**
 * Hash a token using SHA-256 (same as API keys).
 */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

// =============================================================================
// Device Code Operations
// =============================================================================

/**
 * Create a new device code for the device flow.
 */
export async function createDeviceCode(options: {
	clientId?: string;
	userAgent?: string;
	ipAddress?: string;
}): Promise<DeviceCodeResponse> {
	const deviceCode = generateDeviceCode();
	const userCode = generateUserCode();
	const expiresAt = new Date(Date.now() + OAuthConfig.DEVICE_CODE_EXPIRES_IN * 1000);

	const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:6178";

	await pool.query(
		`INSERT INTO device_codes (device_code, user_code, client_id, expires_at, user_agent, ip_address)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[
			deviceCode,
			userCode,
			options.clientId || "mcp",
			expiresAt,
			options.userAgent,
			options.ipAddress,
		],
	);

	return {
		device_code: deviceCode,
		user_code: userCode,
		verification_uri: `${baseUrl}/activate`,
		verification_uri_complete: `${baseUrl}/activate?code=${userCode}`,
		expires_in: OAuthConfig.DEVICE_CODE_EXPIRES_IN,
		interval: OAuthConfig.POLLING_INTERVAL,
	};
}

/**
 * Find a device code by user code.
 */
export async function findDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRecord | null> {
	const normalizedCode = normalizeUserCode(userCode);

	const result = await pool.query<DeviceCodeRecord>(
		`SELECT id, device_code, user_code, client_id, status, user_id,
		        expires_at, last_polled_at, authorized_at, created_at, user_agent, ip_address
		 FROM device_codes
		 WHERE REPLACE(user_code, '-', '') = $1`,
		[normalizedCode],
	);

	return result.rows[0] || null;
}

/**
 * Find a device code by device code.
 */
export async function findDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | null> {
	const result = await pool.query<DeviceCodeRecord>(
		`SELECT id, device_code, user_code, client_id, status, user_id,
		        expires_at, last_polled_at, authorized_at, created_at, user_agent, ip_address
		 FROM device_codes
		 WHERE device_code = $1`,
		[deviceCode],
	);

	return result.rows[0] || null;
}

/**
 * Authorize a device code (called when user approves on /activate page).
 */
export async function authorizeDeviceCode(userCode: string, userId: string): Promise<boolean> {
	const normalizedCode = normalizeUserCode(userCode);

	const result = await pool.query(
		`UPDATE device_codes
		 SET status = 'authorized', user_id = $1, authorized_at = NOW()
		 WHERE REPLACE(user_code, '-', '') = $2
		   AND status = 'pending'
		   AND expires_at > NOW()`,
		[userId, normalizedCode],
	);

	return result.rowCount === 1;
}

/**
 * Deny a device code (called if user denies on /activate page).
 */
export async function denyDeviceCode(userCode: string): Promise<boolean> {
	const normalizedCode = normalizeUserCode(userCode);

	const result = await pool.query(
		`UPDATE device_codes
		 SET status = 'denied'
		 WHERE REPLACE(user_code, '-', '') = $1
		   AND status = 'pending'`,
		[normalizedCode],
	);

	return result.rowCount === 1;
}

/**
 * Update last polled timestamp and check for rate limiting.
 */
export async function updatePollTimestamp(
	deviceCode: string,
): Promise<{ shouldSlowDown: boolean }> {
	const record = await findDeviceCode(deviceCode);

	if (!record) {
		return { shouldSlowDown: false };
	}

	const lastPolled = record.last_polled_at;
	const minInterval = OAuthConfig.POLLING_INTERVAL * 1000; // Convert to ms

	const shouldSlowDown = lastPolled && Date.now() - new Date(lastPolled).getTime() < minInterval;

	await pool.query(`UPDATE device_codes SET last_polled_at = NOW() WHERE device_code = $1`, [
		deviceCode,
	]);

	return { shouldSlowDown };
}

// =============================================================================
// Token Operations
// =============================================================================

interface UserInfo {
	id: string;
	name: string;
	email: string;
}

/**
 * Poll for tokens using a device code.
 * Returns tokens if authorized, or an error response if pending/denied/expired.
 */
export async function pollForToken(
	deviceCode: string,
	clientId: string,
): Promise<TokenResponse | TokenErrorResponse> {
	const record = await findDeviceCode(deviceCode);

	if (!record) {
		return {
			error: "invalid_grant",
			error_description: "Device code not found.",
		};
	}

	// Check client_id matches
	if (record.client_id !== clientId) {
		return {
			error: "invalid_client",
			error_description: "Client ID mismatch.",
		};
	}

	// Check rate limiting
	const { shouldSlowDown } = await updatePollTimestamp(deviceCode);
	if (shouldSlowDown) {
		return {
			error: "slow_down",
			error_description: `Polling too frequently. Wait ${OAuthConfig.POLLING_INTERVAL} seconds.`,
		};
	}

	// Check expiration
	if (new Date(record.expires_at) < new Date()) {
		await pool.query(`UPDATE device_codes SET status = 'expired' WHERE device_code = $1`, [
			deviceCode,
		]);
		return {
			error: "expired_token",
			error_description: "The device code has expired.",
		};
	}

	// Check status
	switch (record.status) {
		case "pending":
			return {
				error: "authorization_pending",
				error_description: "The authorization request is still pending.",
			};

		case "denied":
			return {
				error: "access_denied",
				error_description: "The user denied the authorization request.",
			};

		case "expired":
			return {
				error: "expired_token",
				error_description: "The device code has expired.",
			};

		case "used":
			return {
				error: "invalid_grant",
				error_description: "The device code has already been used.",
			};

		case "authorized":
			// Issue tokens!
			break;

		default:
			return {
				error: "invalid_grant",
				error_description: "Unknown device code status.",
			};
	}

	// Get user info
	const userResult = await pool.query<UserInfo>(
		`SELECT id, name, email FROM "user" WHERE id = $1`,
		[record.user_id],
	);

	const user = userResult.rows[0];
	if (!user) {
		return {
			error: "invalid_grant",
			error_description: "User not found.",
		};
	}

	// Generate tokens
	const tokens = await issueTokens({
		userId: user.id,
		user,
		deviceCodeId: record.id,
		clientId: record.client_id,
		userAgent: record.user_agent || undefined,
		ipAddress: record.ip_address || undefined,
	});

	// Mark device code as used
	await pool.query(`UPDATE device_codes SET status = 'used' WHERE device_code = $1`, [deviceCode]);

	return tokens;
}

/**
 * Issue new access and refresh tokens.
 */
export async function issueTokens(options: {
	userId: string;
	user: UserInfo;
	deviceCodeId?: string;
	clientId?: string;
	userAgent?: string;
	ipAddress?: string;
	scopes?: string[];
}): Promise<TokenResponse> {
	const accessToken = generateAccessToken();
	const refreshToken = generateRefreshToken();

	const accessTokenHash = hashToken(accessToken);
	const refreshTokenHash = hashToken(refreshToken);
	const accessTokenPrefix = `${accessToken.slice(0, 20)}...`;

	const scopes = options.scopes || [...OAuthConfig.DEFAULT_SCOPES];
	const accessTokenExpiresAt = new Date(Date.now() + OAuthConfig.ACCESS_TOKEN_EXPIRES_IN * 1000);
	const refreshTokenExpiresAt = new Date(Date.now() + OAuthConfig.REFRESH_TOKEN_EXPIRES_IN * 1000);

	await pool.query(
		`INSERT INTO oauth_tokens (
			access_token_hash, refresh_token_hash, access_token_prefix,
			user_id, scopes, access_token_expires_at, refresh_token_expires_at,
			client_id, device_code_id, user_agent, ip_address
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			accessTokenHash,
			refreshTokenHash,
			accessTokenPrefix,
			options.userId,
			scopes,
			accessTokenExpiresAt,
			refreshTokenExpiresAt,
			options.clientId || "mcp",
			options.deviceCodeId,
			options.userAgent,
			options.ipAddress,
		],
	);

	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: OAuthConfig.ACCESS_TOKEN_EXPIRES_IN,
		refresh_token: refreshToken,
		scopes,
		user: options.user,
	};
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
	refreshToken: string,
	clientId: string,
): Promise<TokenResponse | TokenErrorResponse> {
	const refreshTokenHash = hashToken(refreshToken);

	// Find the token record
	const result = await pool.query<OAuthTokenRecord & { user_name: string; user_email: string }>(
		`SELECT t.*, u.name as user_name, u.email as user_email
		 FROM oauth_tokens t
		 JOIN "user" u ON t.user_id = u.id
		 WHERE t.refresh_token_hash = $1`,
		[refreshTokenHash],
	);

	const record = result.rows[0];

	if (!record) {
		return {
			error: "invalid_grant",
			error_description: "Refresh token not found.",
		};
	}

	// Check client_id
	if (record.client_id !== clientId) {
		return {
			error: "invalid_client",
			error_description: "Client ID mismatch.",
		};
	}

	// Check if revoked
	if (record.revoked_at) {
		return {
			error: "invalid_grant",
			error_description: "Token has been revoked.",
		};
	}

	// Check if refresh token expired
	if (new Date(record.refresh_token_expires_at) < new Date()) {
		return {
			error: "invalid_grant",
			error_description: "Refresh token has expired.",
		};
	}

	// Generate new tokens (rotate refresh token for security)
	const newAccessToken = generateAccessToken();
	const newRefreshToken = generateRefreshToken();

	const newAccessTokenHash = hashToken(newAccessToken);
	const newRefreshTokenHash = hashToken(newRefreshToken);
	const newAccessTokenPrefix = `${newAccessToken.slice(0, 20)}...`;

	const accessTokenExpiresAt = new Date(Date.now() + OAuthConfig.ACCESS_TOKEN_EXPIRES_IN * 1000);
	const refreshTokenExpiresAt = new Date(Date.now() + OAuthConfig.REFRESH_TOKEN_EXPIRES_IN * 1000);

	// Update token record with new tokens
	await pool.query(
		`UPDATE oauth_tokens
		 SET access_token_hash = $1,
		     refresh_token_hash = $2,
		     access_token_prefix = $3,
		     access_token_expires_at = $4,
		     refresh_token_expires_at = $5,
		     updated_at = NOW()
		 WHERE id = $6`,
		[
			newAccessTokenHash,
			newRefreshTokenHash,
			newAccessTokenPrefix,
			accessTokenExpiresAt,
			refreshTokenExpiresAt,
			record.id,
		],
	);

	return {
		access_token: newAccessToken,
		token_type: "Bearer",
		expires_in: OAuthConfig.ACCESS_TOKEN_EXPIRES_IN,
		refresh_token: newRefreshToken,
		scopes: record.scopes,
		user: {
			id: record.user_id,
			name: record.user_name,
			email: record.user_email,
		},
	};
}

// =============================================================================
// Token Validation
// =============================================================================

/**
 * Validate an OAuth access token and return the token record.
 */
export async function validateAccessToken(accessToken: string): Promise<OAuthTokenRecord | null> {
	const accessTokenHash = hashToken(accessToken);

	const result = await pool.query<OAuthTokenRecord>(
		`SELECT *
		 FROM oauth_tokens
		 WHERE access_token_hash = $1
		   AND revoked_at IS NULL
		   AND access_token_expires_at > NOW()`,
		[accessTokenHash],
	);

	const record = result.rows[0];

	if (!record) {
		return null;
	}

	// Update last used timestamp (fire and forget)
	pool
		.query(`UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1`, [record.id])
		.catch(() => {});

	return record;
}

/**
 * Revoke an OAuth token.
 */
export async function revokeToken(tokenId: string, reason?: string): Promise<boolean> {
	const result = await pool.query(
		`UPDATE oauth_tokens
		 SET revoked_at = NOW(), revoked_reason = $2
		 WHERE id = $1`,
		[tokenId, reason],
	);

	return result.rowCount === 1;
}

/**
 * List tokens for a user.
 */
export async function listUserTokens(userId: string): Promise<OAuthTokenRecord[]> {
	const result = await pool.query<OAuthTokenRecord>(
		`SELECT *
		 FROM oauth_tokens
		 WHERE user_id = $1
		   AND revoked_at IS NULL
		 ORDER BY created_at DESC`,
		[userId],
	);

	return result.rows;
}
