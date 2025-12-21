import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import type { ApiKey, ApiKeyRepository } from "../db/api-keys";

// API key prefix pattern
const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;

export interface ApiKeyAuthOptions {
	logger: Logger;
	apiKeyRepo: ApiKeyRepository;
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
 * Validates the Authorization header against the database and extracts API key metadata.
 * Sets the key context on the request for downstream use.
 */
export function apiKeyAuth(options: ApiKeyAuthOptions) {
	const { logger, apiKeyRepo } = options;

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

		// Validate key against database
		let validatedKey: ApiKey | null;
		try {
			validatedKey = await apiKeyRepo.validate(apiKey);
		} catch (error) {
			logger.error({ error }, "Failed to validate API key");
			return c.json(
				{
					success: false,
					error: {
						code: "INTERNAL_ERROR",
						message: "Failed to validate API key",
					},
				},
				500,
			);
		}

		if (!validatedKey) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid or expired API key",
					},
				},
				401,
			);
		}

		const keyContext: ApiKeyContext = {
			keyId: validatedKey.keyPrefix,
			keyType: validatedKey.keyType,
			userId: validatedKey.userId,
			scopes: validatedKey.scopes,
			rateLimit: validatedKey.rateLimitRpm,
		};

		// Store in context for downstream use
		c.set("apiKey", keyContext);

		logger.debug({ keyId: keyContext.keyId, keyType: keyContext.keyType }, "API key authenticated");

		await next();
	};
}
