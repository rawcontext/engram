/**
 * Authentication Middleware
 *
 * Express middleware for OAuth 2.1 bearer token authentication.
 * Validates tokens and enforces scope requirements.
 *
 * @see https://modelcontextprotocol.io/docs/tutorials/security/authorization
 */

import type { Logger } from "@engram/logger";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getProtectedResourceMetadataUrl } from "./metadata";
import type { AccessToken, IntrospectionTokenVerifier } from "./token-verifier";

/**
 * Extend Express Request to include auth info
 */
declare global {
	namespace Express {
		interface Request {
			auth?: AccessToken;
		}
	}
}

export interface BearerAuthOptions {
	/** Token verifier instance */
	verifier: IntrospectionTokenVerifier;
	/** This server's base URL (for resource metadata URL) */
	serverUrl: string;
	/** Required scopes (all must be present) */
	requiredScopes?: string[];
	/** Logger instance */
	logger: Logger;
	/** Skip auth for these paths (e.g., health checks, metadata endpoints) */
	skipPaths?: string[];
}

/**
 * Create bearer token authentication middleware
 *
 * This middleware:
 * 1. Extracts the bearer token from the Authorization header
 * 2. Validates the token via introspection
 * 3. Checks required scopes
 * 4. Attaches auth info to the request
 *
 * On failure, returns proper 401/403 responses with WWW-Authenticate header
 * per RFC 6750 and MCP specification.
 */
export function requireBearerAuth(options: BearerAuthOptions): RequestHandler {
	const { verifier, serverUrl, requiredScopes = [], logger, skipPaths = [] } = options;

	const resourceMetadataUrl = getProtectedResourceMetadataUrl(serverUrl);

	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		// Skip auth for certain paths
		if (skipPaths.some((path) => req.path === path || req.path.startsWith(path))) {
			next();
			return;
		}

		const authHeader = req.headers.authorization;

		// No auth header - require authentication
		if (!authHeader) {
			logger.debug({ path: req.path }, "No Authorization header");
			res
				.status(401)
				.set({
					"WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${resourceMetadataUrl}"`,
				})
				.json({
					jsonrpc: "2.0",
					error: { code: -32001, message: "Authentication required" },
					id: null,
				});
			return;
		}

		// Must be Bearer token
		if (!authHeader.startsWith("Bearer ")) {
			logger.debug({ path: req.path }, "Invalid Authorization header format");
			res
				.status(401)
				.set({
					"WWW-Authenticate": `Bearer realm="mcp", error="invalid_request", error_description="Bearer token required", resource_metadata="${resourceMetadataUrl}"`,
				})
				.json({
					jsonrpc: "2.0",
					error: { code: -32001, message: "Bearer token required" },
					id: null,
				});
			return;
		}

		const token = authHeader.slice(7); // Remove "Bearer " prefix

		if (!token) {
			logger.debug({ path: req.path }, "Empty token");
			res
				.status(401)
				.set({
					"WWW-Authenticate": `Bearer realm="mcp", error="invalid_request", error_description="Token required", resource_metadata="${resourceMetadataUrl}"`,
				})
				.json({
					jsonrpc: "2.0",
					error: { code: -32001, message: "Token required" },
					id: null,
				});
			return;
		}

		// Verify the token
		const accessToken = await verifier.verify(token);

		if (!accessToken) {
			logger.debug({ path: req.path }, "Token verification failed");
			res
				.status(401)
				.set({
					"WWW-Authenticate": `Bearer realm="mcp", error="invalid_token", error_description="Token is invalid or expired", resource_metadata="${resourceMetadataUrl}"`,
				})
				.json({
					jsonrpc: "2.0",
					error: { code: -32001, message: "Invalid or expired token" },
					id: null,
				});
			return;
		}

		// Check required scopes
		if (requiredScopes.length > 0) {
			const hasAllScopes = requiredScopes.every((scope) => accessToken.scopes.includes(scope));

			if (!hasAllScopes) {
				const missingScopes = requiredScopes.filter((scope) => !accessToken.scopes.includes(scope));
				logger.debug(
					{ path: req.path, requiredScopes, tokenScopes: accessToken.scopes, missingScopes },
					"Insufficient scopes",
				);
				res
					.status(403)
					.set({
						"WWW-Authenticate": `Bearer realm="mcp", error="insufficient_scope", scope="${requiredScopes.join(" ")}", resource_metadata="${resourceMetadataUrl}"`,
					})
					.json({
						jsonrpc: "2.0",
						error: {
							code: -32003,
							message: `Insufficient scope. Required: ${requiredScopes.join(", ")}`,
						},
						id: null,
					});
				return;
			}
		}

		// Attach auth info to request
		req.auth = accessToken;

		logger.debug(
			{ path: req.path, clientId: accessToken.clientId, userId: accessToken.userId },
			"Request authenticated",
		);

		next();
	};
}

/**
 * Create optional bearer auth middleware
 *
 * Like requireBearerAuth, but doesn't fail if no token is provided.
 * Useful for endpoints that have different behavior for authenticated vs anonymous users.
 */
export function optionalBearerAuth(
	options: Omit<BearerAuthOptions, "requiredScopes">,
): RequestHandler {
	const { verifier, logger, skipPaths = [] } = options;

	return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
		// Skip for certain paths
		if (skipPaths.some((path) => req.path === path || req.path.startsWith(path))) {
			next();
			return;
		}

		const authHeader = req.headers.authorization;

		// No auth header - continue without auth
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			next();
			return;
		}

		const token = authHeader.slice(7);

		if (!token) {
			next();
			return;
		}

		// Try to verify the token
		const accessToken = await verifier.verify(token);

		if (accessToken) {
			req.auth = accessToken;
			logger.debug(
				{ path: req.path, clientId: accessToken.clientId, userId: accessToken.userId },
				"Request authenticated (optional)",
			);
		}

		next();
	};
}

/**
 * Middleware to skip auth for localhost connections
 *
 * For local development, allow unauthenticated requests from localhost.
 * In production, this should be disabled or used with caution.
 */
export function skipAuthForLocalhost(logger: Logger): RequestHandler {
	return (req: Request, _res: Response, next: NextFunction): void => {
		const host = req.hostname || req.headers.host?.split(":")[0];
		const isLocalhost =
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "::1" ||
			host?.endsWith(".localhost");

		if (isLocalhost) {
			logger.debug({ host, path: req.path }, "Skipping auth for localhost");
			// Set a synthetic auth for localhost
			req.auth = {
				token: "localhost",
				clientId: "localhost",
				scopes: ["mcp:tools", "mcp:resources", "mcp:prompts"],
				userId: "localhost",
			};
		}

		next();
	};
}
