/**
 * GET /.well-known/oauth-protected-resource - Protected Resource Metadata (RFC 9728)
 *
 * Provides discovery document for OAuth clients to find the authorization server
 * and understand what scopes are available for this protected resource.
 *
 * Note: This endpoint is primarily served by the MCP server itself, but we provide
 * it here as well for clients that discover resources through the auth server.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 * @see docs/plans/mcp-oauth-implementation.md
 */

import { OAuthConfig } from "@engram/common/types";
import { NextResponse } from "next/server";

/**
 * Protected Resource Metadata (RFC 9728)
 */
interface ProtectedResourceMetadata {
	resource: string;
	authorization_servers: string[];
	scopes_supported: string[];
	bearer_methods_supported: string[];
	resource_documentation?: string;
	resource_name?: string;
}

/**
 * Serve OAuth protected resource metadata.
 *
 * Response (200):
 * {
 *   "resource": "https://mcp.engram.rawcontext.com",
 *   "authorization_servers": ["https://observatory.engram.rawcontext.com"],
 *   "scopes_supported": ["mcp:tools", "mcp:resources", "mcp:prompts"],
 *   ...
 * }
 */
export async function GET() {
	const authServerUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:6178").replace(/\/$/, "");
	const mcpServerUrl = (process.env.ENGRAM_MCP_SERVER_URL ?? "http://localhost:3010").replace(
		/\/$/,
		"",
	);

	const metadata: ProtectedResourceMetadata = {
		resource: mcpServerUrl,
		authorization_servers: [authServerUrl],
		scopes_supported: [...OAuthConfig.DEFAULT_SCOPES, "mcp:tools", "mcp:resources", "mcp:prompts"],
		bearer_methods_supported: ["header"],
		resource_documentation: "https://github.com/rawcontext/engram/tree/main/apps/mcp",
		resource_name: "Engram MCP Server",
	};

	return NextResponse.json(metadata, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
