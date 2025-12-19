import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";

// API key prefix pattern
const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;

export interface ApiKeyAuthOptions {
	logger: Logger;
}

export interface ApiKeyContext {
	keyId: string;
	keyType: "live" | "test";
	userId?: string;
	scopes: string[];
	rateLimit: number;
}

/**
 * API key authentication middleware
 *
 * Validates the Authorization header and extracts API key metadata.
 * Sets the key context on the request for downstream use.
 */
export function apiKeyAuth(options: ApiKeyAuthOptions) {
	const { logger } = options;

	return async (c: Context, next: Next) => {
		const authHeader = c.req.header("Authorization");

		if (!authHeader) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Missing Authorization header",
					},
				},
				401,
			);
		}

		if (!authHeader.startsWith("Bearer ")) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid Authorization header format. Use: Bearer <api_key>",
					},
				},
				401,
			);
		}

		const apiKey = authHeader.slice(7); // Remove "Bearer " prefix

		if (!API_KEY_PATTERN.test(apiKey)) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid API key format",
					},
				},
				401,
			);
		}

		// Extract key type from prefix
		const keyType = apiKey.startsWith("engram_live_") ? "live" : "test";

		// TODO: Validate key against database
		// For now, accept any properly formatted key
		// In production: look up key in database, check expiry, get user/scopes

		const keyContext: ApiKeyContext = {
			keyId: apiKey.slice(0, 20) + "...", // Truncated for logging
			keyType,
			scopes: ["memory:read", "memory:write", "query:read"],
			rateLimit: 60, // RPM
		};

		// Store in context for downstream use
		c.set("apiKey", keyContext);

		logger.debug({ keyId: keyContext.keyId, keyType }, "API key authenticated");

		await next();
	};
}
