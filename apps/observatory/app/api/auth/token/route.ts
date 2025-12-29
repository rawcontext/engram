/**
 * POST /api/auth/token - OAuth 2.0 token endpoint
 *
 * Implements RFC 6749 §4.4 Client Credentials Grant with mandatory DPoP.
 * Used for machine-to-machine authentication where the client acts on its own behalf.
 *
 * @see https://tools.ietf.org/html/rfc6749#section-4.4
 * @see https://datatracker.ietf.org/doc/html/rfc9449 (DPoP)
 */

import { validateClientCredentials } from "@lib/client-registration";
import { generateClientToken } from "@lib/device-auth";
import { validateDPoPProof } from "@lib/dpop";
import { NextResponse } from "next/server";

/**
 * Client credentials grant with DPoP.
 *
 * Request format (application/x-www-form-urlencoded):
 * {
 *   "grant_type": "client_credentials",
 *   "client_id": "engram-tuner",
 *   "client_secret": "secret123",
 *   "scope": "memory:read memory:write"
 * }
 *
 * Headers:
 * - Content-Type: application/x-www-form-urlencoded
 * - DPoP: <signed JWT proof>
 *
 * Response (success - 200):
 * {
 *   "access_token": "egm_client_...",
 *   "token_type": "DPoP",
 *   "expires_in": 3600,
 *   "scope": "memory:read memory:write"
 * }
 *
 * Error responses:
 * - 400 invalid_request: Missing required parameters or invalid DPoP
 * - 401 invalid_client: Bad client credentials
 * - 400 invalid_scope: Requested scope exceeds allowed
 */
export async function POST(request: Request) {
	try {
		// Parse form-urlencoded body
		const formData = await request.formData();
		const grantType = formData.get("grant_type");
		const clientId = formData.get("client_id");
		const clientSecret = formData.get("client_secret");
		const scope = formData.get("scope");

		// Step 1: Verify grant_type is "client_credentials"
		if (grantType !== "client_credentials") {
			return NextResponse.json(
				{
					error: "unsupported_grant_type",
					error_description: `Unsupported grant type: ${grantType}. Use 'client_credentials'.`,
				},
				{ status: 400 },
			);
		}

		// Step 2: Validate required parameters
		if (!clientId || typeof clientId !== "string") {
			return NextResponse.json(
				{
					error: "invalid_request",
					error_description: "client_id is required",
				},
				{ status: 400 },
			);
		}

		if (!clientSecret || typeof clientSecret !== "string") {
			return NextResponse.json(
				{
					error: "invalid_request",
					error_description: "client_secret is required",
				},
				{ status: 400 },
			);
		}

		// Step 3: Validate DPoP header (REQUIRED)
		const dpopHeader = request.headers.get("DPoP");
		if (!dpopHeader) {
			return NextResponse.json(
				{
					error: "invalid_request",
					error_description: "DPoP header is required for client credentials grant",
				},
				{ status: 400 },
			);
		}

		// Step 4: Validate DPoP proof
		const url = new URL(request.url);
		const dpopResult = await validateDPoPProof(dpopHeader, "POST", url.toString());

		if (!dpopResult.valid) {
			return NextResponse.json(
				{
					error: "invalid_dpop_proof",
					error_description: dpopResult.error || "Invalid DPoP proof",
				},
				{ status: 400 },
			);
		}

		// Extract JWK thumbprint for token binding
		if (!dpopResult.jwkThumbprint) {
			return NextResponse.json(
				{
					error: "invalid_dpop_proof",
					error_description: "Missing JWK thumbprint in DPoP proof",
				},
				{ status: 400 },
			);
		}
		const jwkThumbprint = dpopResult.jwkThumbprint;

		// Step 5: Verify client_id exists and validate client_secret
		const clientValidation = await validateClientCredentials(clientId, clientSecret);

		if (!clientValidation.valid || !clientValidation.client) {
			return NextResponse.json(
				{
					error: "invalid_client",
					error_description: clientValidation.error || "Invalid client credentials",
				},
				{ status: 401 },
			);
		}

		const client = clientValidation.client;

		// Step 6: Validate requested scopes against client's allowed scopes
		const requestedScopes = scope
			? String(scope)
					.split(" ")
					.filter((s) => s.length > 0)
			: [];
		const allowedScopes = client.scope.split(" ").filter((s) => s.length > 0);

		// Check if all requested scopes are allowed
		for (const requestedScope of requestedScopes) {
			if (!allowedScopes.includes(requestedScope)) {
				return NextResponse.json(
					{
						error: "invalid_scope",
						error_description: `Scope '${requestedScope}' exceeds client's allowed scopes: ${client.scope}`,
					},
					{ status: 400 },
				);
			}
		}

		// Use requested scopes if provided, otherwise use all allowed scopes
		const grantedScopes = requestedScopes.length > 0 ? requestedScopes : allowedScopes;

		// Step 7: Generate client credentials token with DPoP binding
		const tokenData = await generateClientToken(client.id, grantedScopes, jwkThumbprint);

		// Step 8: Return token response
		return NextResponse.json(
			{
				access_token: tokenData.accessToken,
				token_type: tokenData.tokenType,
				expires_in: tokenData.expiresIn,
				scope: tokenData.scope,
			},
			{ status: 200 },
		);
	} catch (error) {
		console.error("Error processing client credentials grant:", error);
		return NextResponse.json(
			{
				error: "server_error",
				error_description: "Failed to process token request",
			},
			{ status: 500 },
		);
	}
}
