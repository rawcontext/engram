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
 * Token types supported by the system for API keys and OAuth.
 */
export type AuthTokenType = "live" | "test" | "oauth" | "dev";

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
	type: AuthTokenType;
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
// Dynamic Client Registration Types (RFC 7591)
// =============================================================================

/**
 * Client registration request (RFC 7591 Section 2).
 */
export interface ClientRegistrationRequest {
	/** Array of redirect URIs for authorization code flow */
	redirect_uris: string[];
	/** Human-readable client name */
	client_name?: string;
	/** Token endpoint authentication method */
	token_endpoint_auth_method?: "none" | "client_secret_basic" | "client_secret_post";
	/** Grant types the client will use */
	grant_types?: string[];
	/** Response types the client will use */
	response_types?: string[];
	/** Space-separated list of scopes */
	scope?: string;
	/** Array of contact email addresses */
	contacts?: string[];
	/** URL of client logo */
	logo_uri?: string;
	/** URL of client homepage */
	client_uri?: string;
	/** URL of privacy policy */
	policy_uri?: string;
	/** URL of terms of service */
	tos_uri?: string;
	/** Identifier for client software */
	software_id?: string;
	/** Version of client software */
	software_version?: string;
}

/**
 * Successful client registration response (RFC 7591 Section 3.2.1).
 */
export interface ClientRegistrationResponse {
	/** Unique client identifier */
	client_id: string;
	/** Client secret (only for confidential clients) */
	client_secret?: string;
	/** When client_id was issued (Unix timestamp) */
	client_id_issued_at: number;
	/** When client_secret expires (Unix timestamp, 0 = never) */
	client_secret_expires_at: number;
	/** All registered metadata echoed back */
	redirect_uris: string[];
	client_name: string;
	token_endpoint_auth_method: string;
	grant_types: string[];
	response_types: string[];
	scope: string;
	contacts?: string[];
	logo_uri?: string;
	client_uri?: string;
	policy_uri?: string;
	tos_uri?: string;
	software_id?: string;
	software_version?: string;
}

/**
 * Client registration error response (RFC 7591 Section 3.2.2).
 */
export interface ClientRegistrationError {
	/** Error code */
	error:
		| "invalid_redirect_uri"
		| "invalid_client_metadata"
		| "invalid_software_statement"
		| "unapproved_software_statement";
	/** Human-readable error description */
	error_description?: string;
}

/**
 * OAuth client database record.
 */
export interface OAuthClientRecord {
	id: string;
	client_id: string;
	client_secret_hash: string | null;
	client_id_issued_at: Date;
	client_secret_expires_at: Date | null;
	client_name: string;
	redirect_uris: string[];
	grant_types: string[];
	response_types: string[];
	token_endpoint_auth_method: string;
	scope: string;
	contacts: string[] | null;
	logo_uri: string | null;
	client_uri: string | null;
	policy_uri: string | null;
	tos_uri: string | null;
	software_id: string | null;
	software_version: string | null;
	created_at: Date;
	updated_at: Date;
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
 * Unified token patterns for all OAuth token types.
 * Single source of truth for token validation across all services.
 *
 * Format: egm_{type}_{random32}_{crc6}
 * - egm: Engram company identifier
 * - type: user/client/refresh
 * - random32: 32 hex characters (a-f0-9)
 * - crc6: 6 Base62 characters (CRC32 checksum)
 *
 * @see https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
 */
export const TOKEN_PATTERNS = {
	/** User access token (egm_oauth_*) */
	user: /^egm_oauth_[a-f0-9]{32}_[a-zA-Z0-9]{6}$/,
	/** Client credentials token (egm_client_*) for M2M authentication */
	client: /^egm_client_[a-f0-9]{32}_[a-zA-Z0-9]{6}$/,
	/** Refresh token (egm_refresh_*) for obtaining new access tokens */
	refresh: /^egm_refresh_[a-f0-9]{32}_[a-zA-Z0-9]{6}$/,
} as const;

/**
 * Identify the token type from a token string.
 *
 * @param token - Token string to identify
 * @returns Token type ('user' | 'client' | 'refresh') or null if invalid
 *
 * @example
 * ```ts
 * const type = identifyTokenType("egm_oauth_abc123...");
 * // => "user"
 *
 * const type = identifyTokenType("egm_client_def456...");
 * // => "client"
 *
 * const type = identifyTokenType("invalid_token");
 * // => null
 * ```
 */
export function identifyTokenType(token: string): keyof typeof TOKEN_PATTERNS | null {
	for (const [type, pattern] of Object.entries(TOKEN_PATTERNS)) {
		if (pattern.test(token)) {
			return type as keyof typeof TOKEN_PATTERNS;
		}
	}
	return null;
}

/**
 * OAuth-specific token pattern.
 *
 * Format: egm_oauth_{random32}_{crc6}
 * - egm: Engram company identifier
 * - oauth: Token type
 * - random32: 32 hex characters (a-f0-9)
 * - crc6: 6 Base62 characters (CRC32 checksum)
 *
 * @deprecated Use TOKEN_PATTERNS.user instead for consistency
 * @see https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
 */
export const OAUTH_TOKEN_PATTERN = TOKEN_PATTERNS.user;

/**
 * Refresh token pattern.
 *
 * Format: egm_refresh_{random32}_{crc6}
 * - egm: Engram company identifier
 * - refresh: Token type
 * - random32: 32 hex characters (a-f0-9)
 * - crc6: 6 Base62 characters (CRC32 checksum)
 *
 * @deprecated Use TOKEN_PATTERNS.refresh instead for consistency
 */
export const REFRESH_TOKEN_PATTERN = TOKEN_PATTERNS.refresh;

/**
 * Client credentials token pattern for M2M/service authentication.
 *
 * Format: egm_client_{random32}_{crc6}
 * - egm: Engram company identifier
 * - client: Token type for machine-to-machine authentication
 * - random32: 32 hex characters (a-f0-9)
 * - crc6: 6 Base62 characters (CRC32 checksum)
 *
 * @deprecated Use TOKEN_PATTERNS.client instead for consistency
 * @see https://oauth.net/2/grant-types/client-credentials/
 * @see https://tools.ietf.org/html/rfc6749#section-4.4
 */
export const CLIENT_TOKEN_PATTERN = TOKEN_PATTERNS.client;
