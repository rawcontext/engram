/**
 * POST /api/auth/revoke - OAuth 2.0 Token Revocation
 *
 * Implements RFC 7009 OAuth 2.0 Token Revocation for revoking access and refresh tokens.
 * This endpoint allows clients to notify the authorization server that a previously
 * obtained token is no longer needed.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7009
 */

import { revokeTokenByValue } from "@lib/device-auth";
import { NextResponse } from "next/server";

/**
 * Revoke an OAuth token.
 *
 * Request format (application/x-www-form-urlencoded):
 * {
 *   "token": "egm_oauth_...",           // Required: The token to revoke
 *   "token_type_hint": "access_token"   // Optional: "access_token" or "refresh_token"
 * }
 *
 * Response (success - 200):
 * Empty body per RFC 7009 §2.1
 *
 * Response (error - 400):
 * {
 *   "error": "invalid_request",
 *   "error_description": "token parameter is required"
 * }
 *
 * Security considerations (RFC 7009 §2.1):
 * - Returns 200 OK even for invalid/unknown/expired tokens to prevent token enumeration
 * - The endpoint does NOT require authentication per RFC 7009 (public clients support)
 * - Invalid tokens are simply ignored
 */
export async function POST(request: Request) {
	try {
		// Parse form-urlencoded body
		const formData = await request.formData();
		const token = formData.get("token");
		const tokenTypeHint = formData.get("token_type_hint");

		// Validate required parameter
		if (!token || typeof token !== "string") {
			return NextResponse.json(
				{
					error: "invalid_request",
					error_description: "token parameter is required",
				},
				{ status: 400 },
			);
		}

		// Validate token_type_hint if provided
		if (tokenTypeHint && tokenTypeHint !== "access_token" && tokenTypeHint !== "refresh_token") {
			// Per RFC 7009, unsupported token types should be ignored, not rejected
			// The server will attempt to identify the token type automatically
		}

		// Attempt to revoke the token
		// Per RFC 7009 §2.1: "The authorization server responds with HTTP status code 200
		// if the token has been revoked successfully or if the client submitted an
		// invalid token."
		await revokeTokenByValue(
			token,
			tokenTypeHint === "access_token" || tokenTypeHint === "refresh_token"
				? tokenTypeHint
				: undefined,
		);

		// Return empty 200 OK per RFC 7009 §2.1
		return new NextResponse(null, { status: 200 });
	} catch (error) {
		console.error("Error processing token revocation:", error);
		// Per RFC 7009, even on error we should return 200 to prevent enumeration
		// However, for genuine server errors, we return 503
		return NextResponse.json(
			{
				error: "server_error",
				error_description: "Failed to process revocation request",
			},
			{ status: 503 },
		);
	}
}
