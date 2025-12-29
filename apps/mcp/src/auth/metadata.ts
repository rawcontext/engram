/**
 * OAuth Metadata Documents
 *
 * Generates OAuth 2.1 discovery documents required by MCP clients:
 * - Protected Resource Metadata (RFC 9728)
 * - Authorization Server Metadata (RFC 8414)
 *
 * @see https://modelcontextprotocol.io/docs/tutorials/security/authorization
 */

/**
 * MCP scopes supported by this server
 */
export const MCP_SCOPES = ["mcp:tools", "mcp:resources", "mcp:prompts"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * Protected Resource Metadata (RFC 9728)
 *
 * Describes this MCP server as an OAuth protected resource,
 * telling clients which authorization server to use.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
export interface ProtectedResourceMetadata {
	/** The resource identifier (this MCP server's URL) */
	resource: string;
	/** Authorization servers that can issue tokens for this resource */
	authorization_servers: string[];
	/** OAuth scopes supported by this resource */
	scopes_supported: string[];
	/** How bearer tokens can be sent (always "header" for MCP) */
	bearer_methods_supported: string[];
	/** Optional documentation URL */
	resource_documentation?: string;
	/** Optional name for the resource */
	resource_name?: string;
}

/**
 * Authorization Server Metadata (RFC 8414)
 *
 * Describes the OAuth authorization server's endpoints and capabilities.
 * This is served by the auth server (Observatory) but we generate it here
 * for convenience when running in standalone mode.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */
export interface AuthorizationServerMetadata {
	/** Authorization server identifier */
	issuer: string;
	/** URL of the authorization endpoint */
	authorization_endpoint: string;
	/** URL of the token endpoint */
	token_endpoint: string;
	/** URL of the dynamic client registration endpoint */
	registration_endpoint?: string;
	/** URL of the token introspection endpoint */
	introspection_endpoint?: string;
	/** URL of the token revocation endpoint */
	revocation_endpoint?: string;
	/** OAuth scopes supported */
	scopes_supported: string[];
	/** Response types supported */
	response_types_supported: string[];
	/** Grant types supported */
	grant_types_supported: string[];
	/** PKCE code challenge methods supported */
	code_challenge_methods_supported: string[];
	/** Token endpoint authentication methods */
	token_endpoint_auth_methods_supported?: string[];
	/** Service documentation URL */
	service_documentation?: string;
}

export interface MetadataOptions {
	/** This MCP server's base URL */
	serverUrl: string;
	/** Authorization server base URL */
	authServerUrl: string;
	/** Optional resource name */
	resourceName?: string;
	/** Optional documentation URL */
	documentationUrl?: string;
}

/**
 * Create Protected Resource Metadata for this MCP server
 *
 * This tells MCP clients:
 * 1. What this resource is (serverUrl)
 * 2. Which auth server can issue tokens (authServerUrl)
 * 3. What scopes are available (mcp:tools, mcp:resources, mcp:prompts)
 */
export function createProtectedResourceMetadata(
	options: MetadataOptions,
): ProtectedResourceMetadata {
	const { serverUrl, authServerUrl, resourceName, documentationUrl } = options;

	return {
		resource: serverUrl.replace(/\/$/, ""),
		authorization_servers: [authServerUrl.replace(/\/$/, "")],
		scopes_supported: [...MCP_SCOPES],
		bearer_methods_supported: ["header"],
		...(resourceName && { resource_name: resourceName }),
		...(documentationUrl && { resource_documentation: documentationUrl }),
	};
}

/**
 * Create Authorization Server Metadata
 *
 * This tells MCP clients about the auth server's endpoints.
 * In proxy mode, this should match what Observatory serves.
 */
export function createAuthorizationServerMetadata(
	options: MetadataOptions,
): AuthorizationServerMetadata {
	const { authServerUrl, documentationUrl } = options;
	const baseUrl = authServerUrl.replace(/\/$/, "");

	return {
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/api/auth/authorize`,
		token_endpoint: `${baseUrl}/api/auth/token`,
		registration_endpoint: `${baseUrl}/api/auth/register`,
		introspection_endpoint: `${baseUrl}/api/auth/introspect`,
		revocation_endpoint: `${baseUrl}/api/auth/revoke`,
		scopes_supported: [...MCP_SCOPES],
		response_types_supported: ["code"],
		grant_types_supported: [
			"authorization_code",
			"refresh_token",
			"urn:ietf:params:oauth:grant-type:device_code",
		],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
		...(documentationUrl && { service_documentation: documentationUrl }),
	};
}

/**
 * Get the URL for the protected resource metadata endpoint
 */
export function getProtectedResourceMetadataUrl(serverUrl: string): string {
	return `${serverUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}

/**
 * Get the URL for the authorization server metadata endpoint
 */
export function getAuthorizationServerMetadataUrl(authServerUrl: string): string {
	return `${authServerUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;
}
