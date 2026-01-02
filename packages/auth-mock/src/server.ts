/**
 * Mock OAuth Server
 *
 * Minimal HTTP server for CI testing without database dependencies.
 * Implements OAuth endpoints that return valid tokens without persistence.
 *
 * Endpoints:
 * - POST /token - Client credentials & device code grants
 * - POST /introspect - RFC 7662 token introspection
 * - GET /.well-known/oauth-authorization-server - RFC 8414 metadata
 *
 * @module @engram/auth-mock/server
 */

import { OAuthConfig } from "@engram/common/types";
import type { Server } from "bun";
import {
	buildMockClientTokenResponse,
	buildMockDeviceCodeResponse,
	buildMockTokenResponse,
	hashToken,
	MOCK_USER,
} from "./tokens";

// =============================================================================
// In-Memory State
// =============================================================================

/**
 * In-memory token store for introspection validation.
 * Maps token hash → token metadata.
 */
const tokenStore = new Map<
	string,
	{
		active: boolean;
		scope: string;
		client_id: string;
		token_type: string;
		exp: number;
		sub: string;
	}
>();

/**
 * In-memory device code store.
 * Maps device_code → { status, user_code }
 */
const deviceCodeStore = new Map<
	string,
	{
		status: "pending" | "authorized";
		userCode: string;
		clientId: string;
		createdAt: number;
	}
>();

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse JSON request body.
 */
async function parseBody(req: Request): Promise<Record<string, unknown>> {
	try {
		const text = await req.text();
		return text ? JSON.parse(text) : {};
	} catch {
		return {};
	}
}

/**
 * Create JSON response.
 */
function jsonResponse(status: number, data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}

/**
 * Store a token in the in-memory store for introspection.
 */
function storeToken(
	token: string,
	metadata: {
		scope: string;
		client_id: string;
		token_type: string;
		exp: number;
		sub: string;
	},
): void {
	const hash = hashToken(token);
	tokenStore.set(hash, { active: true, ...metadata });
}

// =============================================================================
// Endpoint Handlers
// =============================================================================

/**
 * POST /token - Token endpoint (RFC 6749)
 * Handles client_credentials and device_code grants.
 */
async function handleTokenEndpoint(req: Request): Promise<Response> {
	try {
		const body = await parseBody(req);
		const grantType = body.grant_type as string;

		// Client Credentials Grant (RFC 6749 §4.4)
		if (grantType === "client_credentials") {
			const clientId = (body.client_id as string) || "mock-client";
			const scope = (body.scope as string) || OAuthConfig.DEFAULT_SCOPES.join(" ");
			const scopes = scope.split(" ");

			const response = buildMockClientTokenResponse(scopes);

			// Store token for introspection
			storeToken(response.access_token, {
				scope,
				client_id: clientId,
				token_type: "DPoP",
				exp: Math.floor(Date.now() / 1000) + response.expires_in,
				sub: clientId,
			});

			return jsonResponse(200, response);
		}

		// Device Code Grant (RFC 8628)
		if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
			const deviceCode = body.device_code as string;
			const clientId = (body.client_id as string) || "mcp";

			if (!deviceCode) {
				return jsonResponse(400, {
					error: "invalid_request",
					error_description: "device_code is required",
				});
			}

			const device = deviceCodeStore.get(deviceCode);

			// For mock server, auto-authorize after 1 second for testing
			if (!device) {
				return jsonResponse(400, {
					error: "authorization_pending",
					error_description: "The authorization request is still pending.",
				});
			}

			if (device.status === "pending") {
				// Auto-authorize if more than 1 second has passed
				const elapsed = Date.now() - device.createdAt;
				if (elapsed < 1000) {
					return jsonResponse(400, {
						error: "authorization_pending",
						error_description: "The authorization request is still pending.",
					});
				}
				device.status = "authorized";
			}

			const response = buildMockTokenResponse();

			// Store tokens for introspection
			storeToken(response.access_token, {
				scope: response.scopes.join(" "),
				client_id: clientId,
				token_type: "Bearer",
				exp: Math.floor(Date.now() / 1000) + response.expires_in,
				sub: MOCK_USER.id,
			});

			// Remove device code (one-time use)
			deviceCodeStore.delete(deviceCode);

			return jsonResponse(200, response);
		}

		// Refresh Token Grant (RFC 6749 §6)
		if (grantType === "refresh_token") {
			const response = buildMockTokenResponse();

			storeToken(response.access_token, {
				scope: response.scopes.join(" "),
				client_id: "mcp",
				token_type: "Bearer",
				exp: Math.floor(Date.now() / 1000) + response.expires_in,
				sub: MOCK_USER.id,
			});

			return jsonResponse(200, response);
		}

		return jsonResponse(400, {
			error: "unsupported_grant_type",
			error_description: `Grant type "${grantType}" not supported`,
		});
	} catch (err) {
		console.error("Error in /token:", err);
		return jsonResponse(500, { error: "server_error" });
	}
}

/**
 * POST /device - Device authorization endpoint (RFC 8628)
 */
async function handleDeviceEndpoint(req: Request): Promise<Response> {
	try {
		const body = await parseBody(req);
		const clientId = (body.client_id as string) || "mcp";
		const baseUrl = process.env.MOCK_AUTH_BASE_URL || "http://localhost:6178";

		const response = buildMockDeviceCodeResponse(baseUrl);

		// Store device code for polling
		deviceCodeStore.set(response.device_code, {
			status: "pending",
			userCode: response.user_code,
			clientId,
			createdAt: Date.now(),
		});

		return jsonResponse(200, response);
	} catch (err) {
		console.error("Error in /device:", err);
		return jsonResponse(500, { error: "server_error" });
	}
}

/**
 * POST /introspect - Token introspection endpoint (RFC 7662)
 */
async function handleIntrospectEndpoint(req: Request): Promise<Response> {
	try {
		const body = await parseBody(req);
		const token = body.token as string;

		if (!token) {
			return jsonResponse(200, { active: false });
		}

		const hash = hashToken(token);
		const metadata = tokenStore.get(hash);

		if (!metadata) {
			return jsonResponse(200, { active: false });
		}

		// Check expiration
		if (metadata.exp < Math.floor(Date.now() / 1000)) {
			tokenStore.delete(hash);
			return jsonResponse(200, { active: false });
		}

		return jsonResponse(200, metadata);
	} catch (err) {
		console.error("Error in /introspect:", err);
		return jsonResponse(500, { error: "server_error" });
	}
}

/**
 * GET /.well-known/oauth-authorization-server - Server metadata (RFC 8414)
 */
function handleMetadataEndpoint(): Response {
	const baseUrl = process.env.MOCK_AUTH_BASE_URL || "http://localhost:3010";

	return jsonResponse(200, {
		issuer: baseUrl,
		token_endpoint: `${baseUrl}/token`,
		device_authorization_endpoint: `${baseUrl}/device`,
		introspection_endpoint: `${baseUrl}/introspect`,
		grant_types_supported: [
			"client_credentials",
			"refresh_token",
			"urn:ietf:params:oauth:grant-type:device_code",
		],
		token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
		introspection_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
		scopes_supported: OAuthConfig.DEFAULT_SCOPES,
	});
}

// =============================================================================
// Server
// =============================================================================

/**
 * Create and start the mock OAuth server.
 */
export function createMockAuthServer(port = 3010): Server<undefined> {
	const server = Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			const method = req.method;

			// Handle CORS preflight
			if (method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
					},
				});
			}

			// Route handling
			if (url.pathname === "/token" && method === "POST") {
				return handleTokenEndpoint(req);
			}

			if (url.pathname === "/device" && method === "POST") {
				return handleDeviceEndpoint(req);
			}

			if (url.pathname === "/introspect" && method === "POST") {
				return handleIntrospectEndpoint(req);
			}

			if (url.pathname === "/.well-known/oauth-authorization-server" && method === "GET") {
				return handleMetadataEndpoint();
			}

			if (url.pathname === "/health" && method === "GET") {
				return jsonResponse(200, { status: "ok" });
			}

			return new Response("Not Found", {
				status: 404,
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				},
			});
		},
	});

	console.log(`Mock OAuth server listening on http://localhost:${port}`);
	console.log(`Metadata: http://localhost:${port}/.well-known/oauth-authorization-server`);

	return server;
}
