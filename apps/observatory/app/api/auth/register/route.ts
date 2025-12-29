/**
 * OAuth Dynamic Client Registration Endpoint (RFC 7591)
 *
 * POST /api/auth/register
 *
 * Allows clients to dynamically register and obtain client credentials.
 * Returns client_id and optionally client_secret for confidential clients.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7591.html
 */

import type { ClientRegistrationRequest } from "@engram/common/types";
import { registerClient } from "@lib/client-registration";
import { NextResponse } from "next/server";

/**
 * Check if response is an error response
 */
function isError(response: object): response is { error: string; error_description?: string } {
	return "error" in response;
}

export async function POST(request: Request): Promise<NextResponse> {
	try {
		// Parse request body
		let body: ClientRegistrationRequest;
		try {
			body = await request.json();
		} catch {
			return NextResponse.json(
				{
					error: "invalid_client_metadata",
					error_description: "Invalid JSON in request body",
				},
				{ status: 400 },
			);
		}

		// Validate required field
		if (!body.redirect_uris) {
			return NextResponse.json(
				{
					error: "invalid_client_metadata",
					error_description: "redirect_uris is required",
				},
				{ status: 400 },
			);
		}

		// Register the client
		const result = await registerClient(body);

		// Check for errors
		if (isError(result)) {
			const status = result.error === "invalid_redirect_uri" ? 400 : 400;
			return NextResponse.json(result, { status });
		}

		// Success - return 201 Created with client info
		return NextResponse.json(result, {
			status: 201,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		console.error("Client registration error:", error);

		return NextResponse.json(
			{
				error: "invalid_client_metadata",
				error_description: "An unexpected error occurred during registration",
			},
			{ status: 500 },
		);
	}
}
