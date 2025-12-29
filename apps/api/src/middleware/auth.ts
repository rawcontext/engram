import { TOKEN_PATTERNS } from "@engram/common";
import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { GrantType, OAuthToken, OAuthTokenRepository } from "../db/oauth-tokens";

export interface AuthOptions {
	logger: Logger;
	oauthTokenRepo: OAuthTokenRepository;
	requiredScopes?: string[];
}

/**
 * Auth context for OAuth tokens.
 * Includes grant type and client ID for comprehensive authentication metadata.
 */
export interface AuthContext {
	/** Unique token ID */
	id: string;
	/** Display prefix for logging */
	prefix: string;
	/** Authentication method (always oauth) */
	method: "oauth";
	/** Token type (always oauth) */
	type: "oauth";
	/** User ID (nullable for client_credentials) */
	userId: string | null;
	/** Granted scopes */
	scopes: string[];
	/** Rate limit (requests per minute) */
	rateLimit: number;
	/** Grant type (authorization_code, client_credentials, refresh_token, device_code) */
	grantType: GrantType;
	/** Client ID from oauth_tokens.client_id */
	clientId: string;
	/** User info (only for user tokens, not client_credentials) */
	user?: {
		name: string;
		email: string;
	};
}

/**
 * OAuth 2.1 authentication middleware
 *
 * Validates Bearer tokens (egm_oauth_* and egm_client_*) against OAuth tokens table.
 * Enforces scope requirements and sets auth context for downstream handlers.
 *
 * @see https://oauth.net/2/bearer-tokens/ (RFC 6750)
 */
export function auth(options: AuthOptions) {
	const { logger, oauthTokenRepo, requiredScopes = [] } = options;

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

		// Validate token format (egm_oauth_* or egm_client_*)
		const isUserToken = TOKEN_PATTERNS.user.test(token);
		const isClientToken = TOKEN_PATTERNS.client.test(token);

		if (!isUserToken && !isClientToken) {
			return c.json(
				{
					success: false,
					error: {
						code: "UNAUTHORIZED",
						message: "Invalid token format. Expected OAuth bearer token.",
					},
				},
				401,
			);
		}

		// Validate OAuth token against database
		const result = await validateOAuthToken(token, oauthTokenRepo, logger);
		if (!result.success) {
			return c.json(result.error, result.status ?? 401);
		}

		// Check scope requirements (AND semantics - all required scopes must be present)
		if (requiredScopes.length > 0 && result.context) {
			const missingScopes = requiredScopes.filter(
				(scope) => !result.context?.scopes.includes(scope),
			);
			if (missingScopes.length > 0) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: `Insufficient scopes. Missing: ${missingScopes.join(", ")}`,
							required_scopes: requiredScopes,
							granted_scopes: result.context.scopes,
						},
					},
					403,
				);
			}
		}

		// Set auth context for downstream handlers
		c.set("auth", result.context);
		await next();
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

/**
 * Validate OAuth token against database.
 * Checks token hash, expiration, and revocation status.
 * Updates last_used_at timestamp in fire-and-forget manner.
 */
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
		grantType: validatedToken.grantType,
		clientId: validatedToken.clientId,
		user: validatedToken.user,
	};

	logger.debug(
		{
			tokenId: context.id,
			prefix: context.prefix,
			userId: context.userId,
			grantType: context.grantType,
			clientId: context.clientId,
		},
		"OAuth token authenticated",
	);

	return { success: true, context };
}
