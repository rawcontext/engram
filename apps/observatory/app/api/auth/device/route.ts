/**
 * POST /api/auth/device - Generate device code for OAuth device flow
 *
 * Implements RFC 8628 Section 3.1 - Device Authorization Request
 * Called by MCP server to initiate authentication.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { createDeviceCode } from "@lib/device-auth";
import { NextResponse } from "next/server";

/**
 * Generate a new device code for the device authorization flow.
 *
 * Request body:
 * {
 *   "client_id": "mcp"  // Optional, defaults to "mcp"
 * }
 *
 * Response (RFC 8628 compliant):
 * {
 *   "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNh",
 *   "user_code": "WDJB-MJHT",
 *   "verification_uri": "https://observatory.engram.rawcontext.com/activate",
 *   "verification_uri_complete": "https://observatory.engram.rawcontext.com/activate?code=WDJB-MJHT",
 *   "expires_in": 900,
 *   "interval": 5
 * }
 */
export async function POST(request: Request) {
	try {
		// Parse request body (optional)
		let clientId = "mcp";
		try {
			const body = await request.json();
			if (body.client_id && typeof body.client_id === "string") {
				clientId = body.client_id;
			}
		} catch {
			// Empty body is fine, use defaults
		}

		// Extract client info for auditing
		const userAgent = request.headers.get("user-agent") || undefined;
		const forwardedFor = request.headers.get("x-forwarded-for");
		const ipAddress = forwardedFor?.split(",")[0]?.trim() || undefined;

		// Generate device code
		const response = await createDeviceCode({
			clientId,
			userAgent,
			ipAddress,
		});

		// Return RFC 8628 compliant response
		return NextResponse.json(response, { status: 200 });
	} catch (error) {
		console.error("Error generating device code:", error);
		return NextResponse.json(
			{
				error: "server_error",
				error_description: "Failed to generate device code",
			},
			{ status: 500 },
		);
	}
}
