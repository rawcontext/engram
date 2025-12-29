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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OAuthConfig } from "@engram/common/types";
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
async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

/**
 * Send JSON response.
 */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(data));
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
async function handleTokenEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

			sendJson(res, 200, response);
			return;
		}

		// Device Code Grant (RFC 8628)
		if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
			const deviceCode = body.device_code as string;
			const clientId = (body.client_id as string) || "mcp";

			if (!deviceCode) {
				sendJson(res, 400, {
					error: "invalid_request",
					error_description: "device_code is required",
				});
				return;
			}

			const device = deviceCodeStore.get(deviceCode);

			// For mock server, auto-authorize after 1 second for testing
			if (!device) {
				sendJson(res, 400, {
					error: "authorization_pending",
					error_description: "The authorization request is still pending.",
				});
				return;
			}

			if (device.status === "pending") {
				// Auto-authorize if more than 1 second has passed
				const elapsed = Date.now() - device.createdAt;
				if (elapsed < 1000) {
					sendJson(res, 400, {
						error: "authorization_pending",
						error_description: "The authorization request is still pending.",
					});
					return;
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

			sendJson(res, 200, response);
			return;
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

			sendJson(res, 200, response);
			return;
		}

		sendJson(res, 400, {
			error: "unsupported_grant_type",
			error_description: `Grant type "${grantType}" not supported`,
		});
	} catch (err) {
		console.error("Error in /token:", err);
		sendJson(res, 500, { error: "server_error" });
	}
}

/**
 * POST /device - Device authorization endpoint (RFC 8628)
 */
async function handleDeviceEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

		sendJson(res, 200, response);
	} catch (err) {
		console.error("Error in /device:", err);
		sendJson(res, 500, { error: "server_error" });
	}
}

/**
 * POST /introspect - Token introspection endpoint (RFC 7662)
 */
async function handleIntrospectEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
	try {
		const body = await parseBody(req);
		const token = body.token as string;

		if (!token) {
			sendJson(res, 200, { active: false });
			return;
		}

		const hash = hashToken(token);
		const metadata = tokenStore.get(hash);

		if (!metadata) {
			sendJson(res, 200, { active: false });
			return;
		}

		// Check expiration
		if (metadata.exp < Math.floor(Date.now() / 1000)) {
			tokenStore.delete(hash);
			sendJson(res, 200, { active: false });
			return;
		}

		sendJson(res, 200, metadata);
	} catch (err) {
		console.error("Error in /introspect:", err);
		sendJson(res, 500, { error: "server_error" });
	}
}

/**
 * GET /.well-known/oauth-authorization-server - Server metadata (RFC 8414)
 */
function handleMetadataEndpoint(_req: IncomingMessage, res: ServerResponse): void {
	const baseUrl = process.env.MOCK_AUTH_BASE_URL || "http://localhost:3010";

	sendJson(res, 200, {
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
export function createMockAuthServer(port = 3010): ReturnType<typeof createServer> {
	const server = createServer((req, res) => {
		const url = req.url || "/";
		const method = req.method || "GET";

		// CORS headers for browser testing
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

		if (method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}

		// Route handling
		if (url === "/token" && method === "POST") {
			handleTokenEndpoint(req, res);
		} else if (url === "/device" && method === "POST") {
			handleDeviceEndpoint(req, res);
		} else if (url === "/introspect" && method === "POST") {
			handleIntrospectEndpoint(req, res);
		} else if (url === "/.well-known/oauth-authorization-server" && method === "GET") {
			handleMetadataEndpoint(req, res);
		} else if (url === "/health" && method === "GET") {
			sendJson(res, 200, { status: "ok" });
		} else {
			res.statusCode = 404;
			res.end("Not Found");
		}
	});

	server.listen(port, () => {
		console.log(`Mock OAuth server listening on http://localhost:${port}`);
		console.log(`Metadata: http://localhost:${port}/.well-known/oauth-authorization-server`);
	});

	return server;
}
