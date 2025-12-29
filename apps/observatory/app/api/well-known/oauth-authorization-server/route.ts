/**
 * GET /.well-known/oauth-authorization-server - OAuth Authorization Server Metadata (RFC 8414)
 *
 * Provides discovery document for OAuth clients to find authorization endpoints.
 * Used by MCP clients to discover how to authenticate with this server.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 * @see docs/plans/mcp-oauth-implementation.md
 */

import { OAuthConfig } from "@engram/common/types";
import { NextResponse } from "next/server";

/**
 * Authorization Server Metadata (RFC 8414)
 */
interface AuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	introspection_endpoint?: string;
	revocation_endpoint?: string;
	scopes_supported: string[];
	response_types_supported: string[];
	grant_types_supported: string[];
	code_challenge_methods_supported: string[];
	token_endpoint_auth_methods_supported: string[];
	service_documentation?: string;
}

/**
 * Serve OAuth authorization server metadata.
 *
 * Response (200):
 * {
 *   "issuer": "https://observatory.engram.rawcontext.com",
 *   "authorization_endpoint": "https://observatory.engram.rawcontext.com/api/auth/authorize",
 *   "token_endpoint": "https://observatory.engram.rawcontext.com/api/auth/device/token",
 *   ...
 * }
 */
export async function GET() {
	const baseUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:6178").replace(/\/$/, "");

	const metadata: AuthorizationServerMetadata = {
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/api/auth/authorize`,
		token_endpoint: `${baseUrl}/api/auth/device/token`,
		registration_endpoint: `${baseUrl}/api/auth/register`,
		introspection_endpoint: `${baseUrl}/api/auth/introspect`,
		revocation_endpoint: `${baseUrl}/api/auth/revoke`,
		scopes_supported: [...OAuthConfig.DEFAULT_SCOPES, "mcp:tools", "mcp:resources", "mcp:prompts"],
		response_types_supported: ["code"],
		grant_types_supported: [
			"authorization_code",
			"refresh_token",
			"urn:ietf:params:oauth:grant-type:device_code",
		],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
		service_documentation: "https://github.com/rawcontext/engram",
	};

	return NextResponse.json(metadata, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
