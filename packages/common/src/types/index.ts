/**
 * Type definitions for the Engram system.
 *
 * @module @engram/common/types
 */

export type {
	AuthContext,
	// Auth token type
	AuthTokenType,
	// Cache types
	CachedTokens,
	// Dynamic Client Registration types
	ClientRegistrationError,
	ClientRegistrationRequest,
	ClientRegistrationResponse,
	// Database types
	DeviceCodeRecord,
	// Device flow types
	DeviceCodeRequest,
	DeviceCodeResponse,
	OAuthClientRecord,
	OAuthTokenContext,
	OAuthTokenRecord,
	TokenErrorResponse,
	TokenRequest,
	TokenResponse,
	VerifyCodeRequest,
	VerifyCodeResponse,
} from "./auth";

export {
	ADMIN_READ_SCOPE,
	CLIENT_TOKEN_PATTERN,
	identifyTokenType,
	OAUTH_TOKEN_PATTERN,
	OAuthConfig,
	REFRESH_TOKEN_PATTERN,
	TOKEN_PATTERNS,
} from "./auth";

export type { TenantContext } from "./tenant";

export {
	createTenantContext,
	generateOrgSlug,
	getTenantContext,
	getTenantGraphName,
	isValidOrgSlug,
	runWithTenantContext,
	TenantAccessError,
	TenantContextError,
	tryGetTenantContext,
	validateTenantAccess,
} from "./tenant";

// Audit logging types
export type {
	AuditAction,
	AuditLogEntry,
	AuditLogFilter,
	AuditResourceType,
} from "./audit";

export { createAuditEntry, getActionSeverity, isCrossTenantAction } from "./audit";
