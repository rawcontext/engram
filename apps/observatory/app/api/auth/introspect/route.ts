/**
 * POST /api/auth/introspect - Token Introspection Endpoint (RFC 7662)
 *
 * Allows resource servers (like the MCP server) to validate OAuth access tokens.
 * Returns token metadata including active status, scopes, expiration, and user info.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7662
 * @see docs/plans/mcp-oauth-implementation.md
 */

import { validateClientCredentials } from "@lib/client-registration";
import { hashToken } from "@lib/device-auth";
import { NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({
	connectionString: process.env.AUTH_DATABASE_URL,
});

/**
 * Token introspection response (RFC 7662)
 */
interface IntrospectionResponse {
	/** Whether the token is active (valid and not expired/revoked) */
	active: boolean;
	/** Scopes granted to this token (space-separated) */
	scope?: string;
	/** Client ID that obtained this token */
	client_id?: string;
	/** User ID (subject) this token represents */
	sub?: string;
	/** User email */
	email?: string;
	/** User name */
	name?: string;
	/** Token expiration time (Unix epoch seconds) */
	exp?: number;
	/** Token issued at time (Unix epoch seconds) */
	iat?: number;
	/** Token issuer */
	iss?: string;
	/** Token audience (resource servers this token is valid for) */
	aud?: string | string[];
	/** Token type */
	token_type?: string;
}

/**
 * Introspect an OAuth access token.
 *
 * Request (application/x-www-form-urlencoded):
 *   token=engram_oauth_...
 *   token_type_hint=access_token (optional)
 *
 * Authentication:
 *   Basic auth with client credentials OR
 *   No auth for localhost development
 *
 * Response (200):
 *   { "active": true, "sub": "user-id", "scope": "memory:read memory:write", ... }
 *   { "active": false }
 */
export async function POST(request: Request) {
	try {
		// Parse form data or JSON
		const contentType = request.headers.get("content-type") ?? "";
		let token: string | undefined;
		let _tokenTypeHint: string | undefined;

		if (contentType.includes("application/x-www-form-urlencoded")) {
			const formData = await request.formData();
			token = formData.get("token")?.toString();
			_tokenTypeHint = formData.get("token_type_hint")?.toString();
		} else if (contentType.includes("application/json")) {
			const body = await request.json();
			token = body.token;
			_tokenTypeHint = body.token_type_hint;
		} else {
			// Try to parse as form data by default
			const text = await request.text();
			const params = new URLSearchParams(text);
			token = params.get("token") ?? undefined;
			_tokenTypeHint = params.get("token_type_hint") ?? undefined;
		}

		// Validate token parameter
		if (!token) {
			// RFC 7662: Return inactive for missing token (not an error)
			return NextResponse.json({ active: false }, { status: 200 });
		}

		// Validate client credentials (Basic auth or POST body)
		// In production, verify the client is authorized to introspect
		const authHeader = request.headers.get("authorization");
		if (authHeader?.startsWith("Basic ")) {
			const credentials = Buffer.from(authHeader.slice(6), "base64").toString();
			const [clientId, clientSecret] = credentials.split(":");

			// First check hardcoded MCP server credentials (for backwards compatibility)
			const expectedClientId = process.env.ENGRAM_MCP_CLIENT_ID ?? "mcp-server";
			const expectedClientSecret = process.env.ENGRAM_MCP_CLIENT_SECRET;

			const isHardcodedClient =
				clientId === expectedClientId &&
				(!expectedClientSecret || clientSecret === expectedClientSecret);

			if (!isHardcodedClient) {
				// Try to validate against dynamically registered clients
				const validation = await validateClientCredentials(clientId, clientSecret);
				if (!validation.valid) {
					return NextResponse.json(
						{ error: "invalid_client", error_description: validation.error },
						{ status: 401, headers: { "WWW-Authenticate": 'Basic realm="introspection"' } },
					);
				}
			}
		}

		// Hash the token for lookup
		const tokenHash = hashToken(token);

		// Look up the token in the database
		const result = await pool.query<{
			id: string;
			user_id: string;
			scopes: string[];
			client_id: string;
			access_token_expires_at: Date;
			created_at: Date;
			revoked_at: Date | null;
			user_name: string;
			user_email: string;
		}>(
			`SELECT t.id, t.user_id, t.scopes, t.client_id,
			        t.access_token_expires_at, t.created_at, t.revoked_at,
			        u.name as user_name, u.email as user_email
			 FROM oauth_tokens t
			 JOIN "user" u ON t.user_id = u.id
			 WHERE t.access_token_hash = $1`,
			[tokenHash],
		);

		const record = result.rows[0];

		// Token not found
		if (!record) {
			return NextResponse.json({ active: false }, { status: 200 });
		}

		// Token revoked
		if (record.revoked_at) {
			return NextResponse.json({ active: false }, { status: 200 });
		}

		// Token expired
		const now = new Date();
		if (new Date(record.access_token_expires_at) < now) {
			return NextResponse.json({ active: false }, { status: 200 });
		}

		// Update last used timestamp (fire and forget)
		pool
			.query(`UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1`, [record.id])
			.catch(() => {});

		// Build the introspection response
		const issuer = process.env.BETTER_AUTH_URL ?? "http://localhost:6178";
		const mcpServerUrl = process.env.ENGRAM_MCP_SERVER_URL ?? "http://localhost:3010";

		const response: IntrospectionResponse = {
			active: true,
			sub: record.user_id,
			client_id: record.client_id,
			scope: record.scopes.join(" "),
			email: record.user_email,
			name: record.user_name,
			exp: Math.floor(new Date(record.access_token_expires_at).getTime() / 1000),
			iat: Math.floor(new Date(record.created_at).getTime() / 1000),
			iss: issuer,
			aud: mcpServerUrl,
			token_type: "Bearer",
		};

		return NextResponse.json(response, { status: 200 });
	} catch (error) {
		console.error("Error introspecting token:", error);
		// RFC 7662: Server errors should return inactive, not 500
		return NextResponse.json({ active: false }, { status: 200 });
	}
}
