import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiKey, ApiKeyRepository } from "../db/api-keys";
import type { OAuthToken, OAuthTokenRepository } from "../db/oauth-tokens";

// Token patterns
const API_KEY_PATTERN = /^engram_(live|test)_[a-zA-Z0-9]{32}$/;
const OAUTH_TOKEN_PATTERN = /^engram_oauth_[a-zA-Z0-9]{32}$/;
const DEV_TOKEN_PATTERN = /^engram_dev_[a-zA-Z0-9_]+$/;

export interface AuthOptions {
	logger: Logger;
	apiKeyRepo: ApiKeyRepository;
	oauthTokenRepo?: OAuthTokenRepository;
}

/**
 * Unified auth context that works for both API keys and OAuth tokens.
 */
export interface AuthContext {
	/** Unique identifier (key ID or token ID) */
	id: string;
	/** Display prefix for logging */
	prefix: string;
	/** Authentication method */
	method: "api_key" | "oauth";
	/** Token/key type */
	type: "live" | "test" | "oauth" | "dev";
	/** User ID (optional for API keys, required for OAuth) */
	userId?: string;
	/** Granted scopes */
	scopes: string[];
	/** Rate limit (requests per minute) */
	rateLimit: number;
	/** User info (only for OAuth tokens) */
	user?: {
		name: string;
		email: string;
	};

	// Backward compatibility aliases
	/** @deprecated Use `id` instead */
	keyId: string;
	/** @deprecated Use `prefix` instead */
	keyPrefix: string;
	/** @deprecated Use `type` instead */
	keyType: "live" | "test" | "oauth" | "dev";
}

// Keep backward compatibility
export type ApiKeyContext = AuthContext;

export interface ApiKeyAuthOptions {
	logger: Logger;
	apiKeyRepo: ApiKeyRepository;
}

/**
 * Unified authentication middleware
 *
 * Validates Bearer tokens against both API keys and OAuth tokens.
 * Sets the auth context on the request for downstream use.
 */
export function auth(options: AuthOptions) {
	const { logger, apiKeyRepo, oauthTokenRepo } = options;

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
						message: "Invalid Authorization header format. Use: Bearer <token>",
					},
				},
				401,
			);
		}

		const token = authHeader.slice(7); // Remove "Bearer " prefix

		// Try OAuth token first if it matches the pattern
		if (OAUTH_TOKEN_PATTERN.test(token) && oauthTokenRepo) {
			const result = await validateOAuthToken(token, oauthTokenRepo, logger);
			if (result.success) {
				c.set("apiKey", result.context);
				c.set("auth", result.context);
				await next();
				return;
			}
			if (result.error) {
				return c.json(result.error, result.status ?? 401);
			}
		}

		// Try API key
		if (API_KEY_PATTERN.test(token) || DEV_TOKEN_PATTERN.test(token)) {
			const result = await validateApiKey(token, apiKeyRepo, logger);
			if (result.success) {
				c.set("apiKey", result.context);
				c.set("auth", result.context);
				await next();
				return;
			}
			if (result.error) {
				return c.json(result.error, result.status ?? 401);
			}
		}

		// Invalid token format
		return c.json(
			{
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Invalid token format",
				},
			},
			401,
		);
	};
}

/**
 * Legacy API key authentication middleware (for backward compatibility)
 */
export function apiKeyAuth(options: ApiKeyAuthOptions) {
	return auth({
		logger: options.logger,
		apiKeyRepo: options.apiKeyRepo,
	});
}

// =============================================================================
// Validation Helpers
// =============================================================================

interface ValidationResult {
	success: boolean;
	context?: AuthContext;
	error?: { success: false; error: { code: string; message: string } };
	status?: ContentfulStatusCode;
}

async function validateOAuthToken(
	token: string,
	repo: OAuthTokenRepository,
	logger: Logger,
): Promise<ValidationResult> {
	let validatedToken: OAuthToken | null;

	try {
		validatedToken = await repo.validate(token);
	} catch (error) {
		logger.error({ error }, "Failed to validate OAuth token");
		return {
			success: false,
			error: {
				success: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "Failed to validate token",
				},
			},
			status: 500,
		};
	}

	if (!validatedToken) {
		return {
			success: false,
			error: {
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Invalid or expired OAuth token",
				},
			},
			status: 401,
		};
	}

	const context: AuthContext = {
		id: validatedToken.id,
		prefix: validatedToken.accessTokenPrefix,
		method: "oauth",
		type: "oauth",
		userId: validatedToken.userId,
		scopes: validatedToken.scopes,
		rateLimit: validatedToken.rateLimitRpm,
		user: validatedToken.user,
		// Backward compatibility
		keyId: validatedToken.id,
		keyPrefix: validatedToken.accessTokenPrefix,
		keyType: "oauth",
	};

	logger.debug(
		{ tokenId: context.id, prefix: context.prefix, userId: context.userId },
		"OAuth token authenticated",
	);

	return { success: true, context };
}

async function validateApiKey(
	key: string,
	repo: ApiKeyRepository,
	logger: Logger,
): Promise<ValidationResult> {
	let validatedKey: ApiKey | null;

	try {
		validatedKey = await repo.validate(key);
	} catch (error) {
		logger.error({ error }, "Failed to validate API key");
		return {
			success: false,
			error: {
				success: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "Failed to validate API key",
				},
			},
			status: 500,
		};
	}

	if (!validatedKey) {
		return {
			success: false,
			error: {
				success: false,
				error: {
					code: "UNAUTHORIZED",
					message: "Invalid or expired API key",
				},
			},
			status: 401,
		};
	}

	const context: AuthContext = {
		id: validatedKey.id,
		prefix: validatedKey.keyPrefix,
		method: "api_key",
		type: validatedKey.keyType,
		userId: validatedKey.userId,
		scopes: validatedKey.scopes,
		rateLimit: validatedKey.rateLimitRpm,
		// Backward compatibility
		keyId: validatedKey.id,
		keyPrefix: validatedKey.keyPrefix,
		keyType: validatedKey.keyType,
	};

	logger.debug(
		{ keyId: context.id, prefix: context.prefix, type: context.type },
		"API key authenticated",
	);

	return { success: true, context };
}
