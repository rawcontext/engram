/**
 * OAuth Authentication
 *
 * Exports authentication utilities for the MCP server:
 * - Device flow: Outbound auth (MCP server → Engram API)
 * - Token verifier: Inbound auth (MCP client → MCP server)
 * - Session store: Secure session management
 *
 * @module @engram/mcp/auth
 */

// Outbound OAuth (device flow for authenticating with Engram API)
export type { DeviceFlowOptions, DeviceFlowResult } from "./device-flow";
export { DeviceFlowClient, hasValidCredentials } from "./device-flow";
// OAuth metadata
export type {
	AuthorizationServerMetadata,
	McpScope,
	MetadataOptions,
	ProtectedResourceMetadata,
} from "./metadata";
export {
	createAuthorizationServerMetadata,
	createProtectedResourceMetadata,
	getAuthorizationServerMetadataUrl,
	getProtectedResourceMetadataUrl,
	MCP_SCOPES,
} from "./metadata";
export type { BearerAuthOptions } from "./middleware";
export { optionalBearerAuth, requireBearerAuth, skipAuthForLocalhost } from "./middleware";
export type { AuthRouterOptions } from "./router";
export { createAuthRouter, mountAuthRouter } from "./router";
export type { SessionRecord, SessionStoreOptions } from "./session-store";
export { createSessionStore, generateSecureSessionId, SessionStore } from "./session-store";
export type { TokenCacheOptions } from "./token-cache";
export { getTokenCachePath, TokenCache } from "./token-cache";
// Inbound OAuth (authenticating MCP clients)
export type { AccessToken, TokenVerifierOptions } from "./token-verifier";
export { createTokenVerifier, IntrospectionTokenVerifier } from "./token-verifier";
