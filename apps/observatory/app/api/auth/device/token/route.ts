/**
 * POST /api/auth/device/token - Token endpoint for OAuth device flow
 *
 * Implements RFC 8628 Section 3.4 - Device Access Token Request
 * Called by MCP server to poll for tokens after user authorizes.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { pollForToken, refreshAccessToken } from "@lib/device-auth";
import { NextResponse } from "next/server";

/**
 * Poll for tokens or refresh an existing token.
 *
 * Request body (device_code grant):
 * {
 *   "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
 *   "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNh",
 *   "client_id": "mcp"
 * }
 *
 * Request body (refresh_token grant):
 * {
 *   "grant_type": "refresh_token",
 *   "refresh_token": "engram_refresh_...",
 *   "client_id": "mcp"
 * }
 *
 * Response (pending - 400):
 * {
 *   "error": "authorization_pending",
 *   "error_description": "The authorization request is still pending."
 * }
 *
 * Response (success - 200):
 * {
 *   "access_token": "engram_oauth_...",
 *   "token_type": "Bearer",
 *   "expires_in": 604800,
 *   "refresh_token": "engram_refresh_...",
 *   "user": { "id": "...", "name": "...", "email": "..." },
 *   "scopes": ["memory:read", "memory:write", "query:read"]
 * }
 */
export async function POST(request: Request) {
	try {
		const body = await request.json();
		const { grant_type, device_code, refresh_token, client_id } = body;

		// Validate client_id
		if (!client_id || typeof client_id !== "string") {
			return NextResponse.json(
				{
					error: "invalid_request",
					error_description: "client_id is required",
				},
				{ status: 400 },
			);
		}

		// Handle device_code grant type
		if (grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
			if (!device_code || typeof device_code !== "string") {
				return NextResponse.json(
					{
						error: "invalid_request",
						error_description: "device_code is required for device_code grant",
					},
					{ status: 400 },
				);
			}

			const result = await pollForToken(device_code, client_id);

			// Check if it's an error response
			if ("error" in result) {
				// RFC 8628 specifies 400 for all error responses
				return NextResponse.json(result, { status: 400 });
			}

			// Success - return tokens
			return NextResponse.json(result, { status: 200 });
		}

		// Handle refresh_token grant type
		if (grant_type === "refresh_token") {
			if (!refresh_token || typeof refresh_token !== "string") {
				return NextResponse.json(
					{
						error: "invalid_request",
						error_description: "refresh_token is required for refresh_token grant",
					},
					{ status: 400 },
				);
			}

			const result = await refreshAccessToken(refresh_token, client_id);

			// Check if it's an error response
			if ("error" in result) {
				return NextResponse.json(result, { status: 400 });
			}

			// Success - return new tokens
			return NextResponse.json(result, { status: 200 });
		}

		// Unsupported grant type
		return NextResponse.json(
			{
				error: "unsupported_grant_type",
				error_description: `Unsupported grant type: ${grant_type}. Use 'urn:ietf:params:oauth:grant-type:device_code' or 'refresh_token'.`,
			},
			{ status: 400 },
		);
	} catch (error) {
		console.error("Error processing token request:", error);
		return NextResponse.json(
			{
				error: "server_error",
				error_description: "Failed to process token request",
			},
			{ status: 500 },
		);
	}
}
