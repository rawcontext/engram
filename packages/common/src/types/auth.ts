/**
 * OAuth Device Flow Types
 *
 * Types for RFC 8628 OAuth 2.0 Device Authorization Grant.
 * Used by MCP server to authenticate with Observatory.
 *
 * @see docs/design/oauth-device-flow.md
 * @module @engram/common/types/auth
 */

// =============================================================================
// Device Code Types (RFC 8628)
// =============================================================================

/**
 * Request to generate a device code for OAuth device flow.
 */
export interface DeviceCodeRequest {
	/** Client identifier, typically "mcp" for MCP server */
	client_id: string;
}

/**
 * Response containing device and user codes for OAuth device flow.
 * Follows RFC 8628 Section 3.2 response format.
 */
export interface DeviceCodeResponse {
	/** Secret code used by the client for polling */
	device_code: string;
	/** Human-readable code displayed to user (XXXX-XXXX format) */
	user_code: string;
	/** URL where user enters the code */
	verification_uri: string;
	/** URL with code pre-filled (optional convenience) */
	verification_uri_complete?: string;
	/** Seconds until codes expire (typically 900 = 15 minutes) */
	expires_in: number;
	/** Minimum polling interval in seconds */
	interval: number;
}

// =============================================================================
// Token Request/Response Types
// =============================================================================

/**
 * Request to poll for or refresh tokens.
 * Used with POST /api/auth/device/token endpoint.
 */
export interface TokenRequest {
	/** Grant type: device_code flow or refresh_token */
	grant_type: "urn:ietf:params:oauth:grant-type:device_code" | "refresh_token";
	/** Device code from initial request (for device_code grant) */
	device_code?: string;
	/** Refresh token (for refresh_token grant) */
	refresh_token?: string;
	/** Client identifier */
	client_id: string;
}

/**
 * Successful token response.
 */
export interface TokenResponse {
	/** Access token for API authentication */
	access_token: string;
	/** Token type, always "Bearer" */
	token_type: "Bearer";
	/** Seconds until access token expires */
	expires_in: number;
	/** Refresh token for obtaining new access tokens */
	refresh_token: string;
	/** Scopes granted to this token */
	scopes: string[];
	/** User information */
	user: {
		id: string;
		name: string;
		email: string;
	};
}

/**
 * Error response during token polling.
 * RFC 8628 Section 3.5 error codes.
 */
export interface TokenErrorResponse {
	/** Error code */
	error:
		| "authorization_pending"
		| "slow_down"
		| "access_denied"
		| "expired_token"
		| "invalid_grant"
		| "invalid_client";
	/** Human-readable error description */
	error_description: string;
}

// =============================================================================
// Verify Request/Response Types
// =============================================================================

/**
 * Request to verify a user code on the /activate page.
 */
export interface VerifyCodeRequest {
	/** User code entered by the user (XXXX-XXXX format) */
	user_code: string;
}

/**
 * Response after verifying a user code.
 */
export interface VerifyCodeResponse {
	/** Whether verification succeeded */
	success: boolean;
	/** Human-readable message */
	message: string;
	/** Error code if failed */
	error?: "invalid_code" | "expired_code" | "already_used";
}

// =============================================================================
// Auth Context Types
// =============================================================================

/**
 * Token types supported by the system.
 */
export type TokenType = "live" | "test" | "oauth" | "dev";

/**
 * Context for authenticated OAuth tokens.
 * Similar to ApiKeyContext but for OAuth-issued tokens.
 */
export interface OAuthTokenContext {
	/** Token ID (UUID) */
	tokenId: string;
	/** Display prefix for logging (e.g., "engram_oauth_abc...") */
	tokenPrefix: string;
	/** Token type, always "oauth" for OAuth tokens */
	tokenType: "oauth";
	/** User ID from Better Auth */
	userId: string;
	/** Granted scopes */
	scopes: string[];
	/** Rate limit (requests per minute) */
	rateLimit: number;
	/** User info from token */
	user: {
		id: string;
		name: string;
		email: string;
	};
}

/**
 * Unified auth context that works for both API keys and OAuth tokens.
 * Used by middleware to provide consistent auth info to handlers.
 */
export interface AuthContext {
	/** Unique identifier (key ID or token ID) */
	id: string;
	/** Display prefix for logging */
	prefix: string;
	/** Authentication method */
	method: "api_key" | "oauth";
	/** Token/key type */
	type: TokenType;
	/** User ID (optional for API keys, required for OAuth) */
	userId?: string;
	/** Granted scopes */
	scopes: string[];
	/** Rate limit (requests per minute) */
	rateLimit: number;
	/** User info (only for OAuth tokens) */
	user?: {
		id: string;
		name: string;
		email: string;
	};
}

// =============================================================================
// Database Entity Types
// =============================================================================

/**
 * Device code database record.
 */
export interface DeviceCodeRecord {
	id: string;
	device_code: string;
	user_code: string;
	client_id: string;
	status: "pending" | "authorized" | "denied" | "expired" | "used";
	user_id: string | null;
	expires_at: Date;
	last_polled_at: Date | null;
	authorized_at: Date | null;
	created_at: Date;
	user_agent: string | null;
	ip_address: string | null;
}

/**
 * OAuth token database record.
 */
export interface OAuthTokenRecord {
	id: string;
	access_token_hash: string;
	refresh_token_hash: string;
	access_token_prefix: string;
	user_id: string;
	scopes: string[];
	rate_limit_rpm: number;
	access_token_expires_at: Date;
	refresh_token_expires_at: Date;
	created_at: Date;
	updated_at: Date;
	last_used_at: Date | null;
	revoked_at: Date | null;
	revoked_reason: string | null;
	client_id: string;
	device_code_id: string | null;
	user_agent: string | null;
	ip_address: string | null;
}

// =============================================================================
// Token Cache Types (for MCP server)
// =============================================================================

/**
 * Cached token data stored in ~/.engram/auth.json
 */
export interface CachedTokens {
	/** Access token for API calls */
	access_token: string;
	/** Refresh token for obtaining new access tokens */
	refresh_token: string;
	/** Unix timestamp when access token expires */
	expires_at: number;
	/** User information */
	user: {
		id: string;
		name: string;
		email: string;
	};
	/** When this cache was last updated */
	cached_at: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * OAuth token configuration constants.
 */
export const OAuthConfig = {
	/** Access token lifetime in seconds (7 days) */
	ACCESS_TOKEN_EXPIRES_IN: 60 * 60 * 24 * 7, // 604800

	/** Refresh token lifetime in seconds (30 days) */
	REFRESH_TOKEN_EXPIRES_IN: 60 * 60 * 24 * 30, // 2592000

	/** Device code lifetime in seconds (15 minutes) */
	DEVICE_CODE_EXPIRES_IN: 60 * 15, // 900

	/** Minimum polling interval in seconds */
	POLLING_INTERVAL: 5,

	/** Default scopes for OAuth tokens */
	DEFAULT_SCOPES: ["memory:read", "memory:write", "query:read"] as const,

	/** Default rate limit for OAuth tokens */
	DEFAULT_RATE_LIMIT: 60,

	/** Characters excluded from user codes (ambiguous) */
	USER_CODE_EXCLUDED_CHARS: "0OI1L",

	/** Valid characters for user codes */
	USER_CODE_CHARS: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
} as const;

/**
 * Token pattern for validation.
 * Matches: engram_live_*, engram_test_*, engram_oauth_*, engram_dev_*
 */
export const TOKEN_PATTERN = /^engram_(live|test|oauth|dev)_[a-zA-Z0-9]{32}$/;

/**
 * OAuth-specific token pattern.
 */
export const OAUTH_TOKEN_PATTERN = /^engram_oauth_[a-zA-Z0-9]{32}$/;

/**
 * Refresh token pattern.
 */
export const REFRESH_TOKEN_PATTERN = /^engram_refresh_[a-zA-Z0-9]{32}$/;
