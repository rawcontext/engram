import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { OAuthToken, OAuthTokenRepository } from "../db/oauth-tokens";

// Token patterns
const OAUTH_TOKEN_PATTERN = /^engram_oauth_[a-zA-Z0-9]{32}$/;
const DEV_TOKEN_PATTERN = /^engram_dev_[a-zA-Z0-9_]+$/;
const SERVICE_TOKEN_PATTERN = /^engram_live_[a-zA-Z0-9]+$/;

export interface AuthOptions {
	logger: Logger;
	oauthTokenRepo: OAuthTokenRepository;
}

/**
 * Auth context for OAuth tokens.
 */
export interface AuthContext {
	/** Unique token ID */
	id: string;
	/** Display prefix for logging */
	prefix: string;
	/** Authentication method */
	method: "oauth" | "dev";
	/** Token type */
	type: "oauth" | "dev";
	/** User ID */
	userId: string;
	/** Granted scopes */
	scopes: string[];
	/** Rate limit (requests per minute) */
	rateLimit: number;
	/** User info */
	user?: {
		name: string;
		email: string;
	};
}

/**
 * OAuth authentication middleware
 *
 * Validates Bearer tokens against OAuth tokens.
 * Sets the auth context on the request for downstream use.
 */
export function auth(options: AuthOptions) {
	const { logger, oauthTokenRepo } = options;

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

		// Handle dev tokens for local development
		if (DEV_TOKEN_PATTERN.test(token)) {
			const devContext: AuthContext = {
				id: "dev",
				prefix: token.slice(0, 20),
				method: "dev",
				type: "dev",
				userId: "dev",
				scopes: ["memory:read", "memory:write", "query:read", "state:write"],
				rateLimit: 1000,
			};
			c.set("auth", devContext);
			await next();
			return;
		}

		// Handle service tokens for production services (console, etc.)
		if (SERVICE_TOKEN_PATTERN.test(token)) {
			const serviceContext: AuthContext = {
				id: "service",
				prefix: token.slice(0, 20),
				method: "dev",
				type: "dev",
				userId: "service",
				scopes: ["memory:read", "memory:write", "query:read", "state:write"],
				rateLimit: 1000,
			};
			c.set("auth", serviceContext);
			await next();
			return;
		}

		// Validate OAuth token
		if (OAUTH_TOKEN_PATTERN.test(token)) {
			const result = await validateOAuthToken(token, oauthTokenRepo, logger);
			if (result.success) {
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
	};

	logger.debug(
		{ tokenId: context.id, prefix: context.prefix, userId: context.userId },
		"OAuth token authenticated",
	);

	return { success: true, context };
}
