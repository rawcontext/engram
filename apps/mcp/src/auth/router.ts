/**
 * OAuth Authentication Router
 *
 * Express router providing OAuth 2.1 endpoints for MCP authentication:
 * - /.well-known/oauth-protected-resource - Resource metadata (RFC 9728)
 * - /.well-known/oauth-authorization-server - Auth server metadata (RFC 8414)
 *
 * @see https://modelcontextprotocol.io/docs/tutorials/security/authorization
 */

import type { Logger } from "@engram/logger";
import type { Request, Response, Router } from "express";
import {
	createAuthorizationServerMetadata,
	createProtectedResourceMetadata,
	type MetadataOptions,
} from "./metadata";

export interface AuthRouterOptions extends MetadataOptions {
	logger: Logger;
}

/**
 * Create an Express router for OAuth metadata endpoints
 *
 * Serves:
 * - GET /.well-known/oauth-protected-resource
 * - GET /.well-known/oauth-authorization-server
 */
export async function createAuthRouter(options: AuthRouterOptions): Promise<Router> {
	const { logger, ...metadataOptions } = options;

	// Dynamic import to avoid requiring express for stdio transport
	const express = (await import("express")).default;
	const router = express.Router();

	// Cache metadata (regenerated on each request in dev, cached in prod)
	const isDev = process.env.NODE_ENV !== "production";
	let cachedResourceMetadata: ReturnType<typeof createProtectedResourceMetadata> | null = null;
	let cachedAuthServerMetadata: ReturnType<typeof createAuthorizationServerMetadata> | null = null;

	/**
	 * Protected Resource Metadata (RFC 9728)
	 *
	 * Tells clients:
	 * - What this resource is
	 * - Which auth server can issue tokens
	 * - What scopes are supported
	 */
	router.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
		logger.debug("Serving protected resource metadata");

		if (isDev || !cachedResourceMetadata) {
			cachedResourceMetadata = createProtectedResourceMetadata(metadataOptions);
		}

		res.set({
			"Content-Type": "application/json",
			"Cache-Control": isDev ? "no-cache" : "public, max-age=3600",
		});
		res.json(cachedResourceMetadata);
	});

	/**
	 * Authorization Server Metadata (RFC 8414)
	 *
	 * In proxy mode, this proxies to the actual auth server.
	 * In standalone mode, this serves local metadata.
	 *
	 * Note: Clients should fetch this from the auth server directly,
	 * but we provide it here for convenience and testing.
	 */
	router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
		logger.debug("Serving authorization server metadata");

		if (isDev || !cachedAuthServerMetadata) {
			cachedAuthServerMetadata = createAuthorizationServerMetadata(metadataOptions);
		}

		res.set({
			"Content-Type": "application/json",
			"Cache-Control": isDev ? "no-cache" : "public, max-age=3600",
		});
		res.json(cachedAuthServerMetadata);
	});

	return router;
}

/**
 * Mount auth router on an Express app
 *
 * Usage:
 * ```typescript
 * const app = express();
 * await mountAuthRouter(app, { serverUrl, authServerUrl, logger });
 * ```
 */
export async function mountAuthRouter(
	app: { use: (router: Router) => void },
	options: AuthRouterOptions,
): Promise<void> {
	const router = await createAuthRouter(options);
	app.use(router);
}
