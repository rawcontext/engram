/**
 * Token Verifier
 *
 * Validates OAuth access tokens via introspection endpoint.
 * Follows RFC 7662 (OAuth 2.0 Token Introspection) and MCP security best practices.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7662
 * @see https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
 */

import type { Logger } from "@engram/logger";

/**
 * Validated access token information
 *
 * This matches the `authInfo` type expected by MCP SDK request handlers.
 */
export interface AccessToken {
	/** The raw token string */
	token: string;
	/** OAuth client ID that obtained this token */
	clientId: string;
	/** Scopes granted to this token */
	scopes: string[];
	/** Token expiration timestamp (Unix epoch seconds) */
	expiresAt?: number;
	/** User ID (subject) this token represents */
	userId?: string;
	/** User email (if available) */
	email?: string;
	/** Additional claims from the token */
	claims?: Record<string, unknown>;
}

/**
 * Token introspection response (RFC 7662)
 */
interface IntrospectionResponse {
	/** Whether the token is active */
	active: boolean;
	/** Scopes (space-separated string) */
	scope?: string;
	/** Client ID */
	client_id?: string;
	/** Token subject (user ID) */
	sub?: string;
	/** Expiration time (Unix epoch seconds) */
	exp?: number;
	/** Issued at time (Unix epoch seconds) */
	iat?: number;
	/** Audience (can be string or array) */
	aud?: string | string[];
	/** Token issuer */
	iss?: string;
	/** User email */
	email?: string;
	/** Additional claims */
	[key: string]: unknown;
}

export interface TokenVerifierOptions {
	/** Token introspection endpoint URL */
	introspectionEndpoint: string;
	/** Client ID for authenticating to the introspection endpoint */
	clientId: string;
	/** Client secret for authenticating to the introspection endpoint */
	clientSecret: string;
	/** This resource server's URL (for audience validation) */
	resourceServerUrl: string;
	/** Logger instance */
	logger: Logger;
	/** Cache TTL in milliseconds (default: 60000 = 1 minute) */
	cacheTtlMs?: number;
	/** Whether to skip audience validation (for testing only) */
	skipAudienceValidation?: boolean;
}

/**
 * Token verifier using OAuth 2.0 Token Introspection
 *
 * Validates tokens by calling the authorization server's introspection endpoint.
 * Includes caching to reduce latency and load on the auth server.
 *
 * Security features:
 * - Validates token is active
 * - Validates audience matches this resource server
 * - Validates token hasn't expired
 * - Caches results with short TTL
 */
export class IntrospectionTokenVerifier {
	private readonly introspectionEndpoint: string;
	private readonly clientId: string;
	private readonly clientSecret: string;
	private readonly resourceServerUrl: string;
	private readonly logger: Logger;
	private readonly cacheTtlMs: number;
	private readonly skipAudienceValidation: boolean;

	// Simple in-memory cache
	private readonly cache: Map<string, { token: AccessToken; expiresAt: number }> = new Map();

	constructor(options: TokenVerifierOptions) {
		this.introspectionEndpoint = options.introspectionEndpoint;
		this.clientId = options.clientId;
		this.clientSecret = options.clientSecret;
		this.resourceServerUrl = options.resourceServerUrl.replace(/\/$/, "");
		this.logger = options.logger;
		this.cacheTtlMs = options.cacheTtlMs ?? 60000; // 1 minute default
		this.skipAudienceValidation = options.skipAudienceValidation ?? false;
	}

	/**
	 * Verify an access token
	 *
	 * @param token - The bearer token to verify
	 * @returns The validated token info, or null if invalid
	 */
	async verify(token: string): Promise<AccessToken | null> {
		// Check cache first
		const cached = this.cache.get(token);
		if (cached && cached.expiresAt > Date.now()) {
			this.logger.debug("Token found in cache");
			return cached.token;
		}

		// Remove expired cache entry
		if (cached) {
			this.cache.delete(token);
		}

		try {
			const result = await this.introspect(token);

			if (result) {
				// Cache the result
				const cacheExpiresAt = Date.now() + this.cacheTtlMs;
				this.cache.set(token, { token: result, expiresAt: cacheExpiresAt });
			}

			return result;
		} catch (error) {
			this.logger.error({ error }, "Token introspection failed");
			return null;
		}
	}

	/**
	 * Call the introspection endpoint
	 */
	private async introspect(token: string): Promise<AccessToken | null> {
		const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

		const response = await fetch(this.introspectionEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${credentials}`,
			},
			body: new URLSearchParams({
				token,
				token_type_hint: "access_token",
			}),
		});

		if (!response.ok) {
			this.logger.warn(
				{ status: response.status, endpoint: this.introspectionEndpoint },
				"Introspection endpoint returned error",
			);
			return null;
		}

		const data = (await response.json()) as IntrospectionResponse;

		// Token must be active
		if (!data.active) {
			this.logger.debug("Token is not active");
			return null;
		}

		// Validate audience (resource indicator)
		if (!this.skipAudienceValidation) {
			if (!this.validateAudience(data.aud)) {
				this.logger.warn(
					{ audiences: data.aud, expected: this.resourceServerUrl },
					"Token audience mismatch - possible token passthrough attack",
				);
				return null;
			}
		}

		// Check expiration
		if (data.exp && data.exp * 1000 < Date.now()) {
			this.logger.debug({ exp: data.exp }, "Token has expired");
			return null;
		}

		// Build AccessToken
		const accessToken: AccessToken = {
			token,
			clientId: data.client_id ?? "unknown",
			scopes: data.scope?.split(" ") ?? [],
			expiresAt: data.exp,
			userId: data.sub,
			email: data.email,
		};

		// Collect additional claims
		const knownKeys = new Set([
			"active",
			"scope",
			"client_id",
			"sub",
			"exp",
			"iat",
			"aud",
			"iss",
			"email",
		]);
		const claims: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			if (!knownKeys.has(key)) {
				claims[key] = value;
			}
		}
		if (Object.keys(claims).length > 0) {
			accessToken.claims = claims;
		}

		this.logger.debug(
			{ clientId: accessToken.clientId, userId: accessToken.userId, scopes: accessToken.scopes },
			"Token verified successfully",
		);

		return accessToken;
	}

	/**
	 * Validate the token audience matches this resource server
	 */
	private validateAudience(aud: string | string[] | undefined): boolean {
		if (!aud) {
			// No audience claim - depends on auth server configuration
			// Some auth servers don't include aud for access tokens
			return true;
		}

		const audiences = Array.isArray(aud) ? aud : [aud];

		return audiences.some((audience) => {
			const normalizedAudience = audience.replace(/\/$/, "");
			return (
				normalizedAudience === this.resourceServerUrl ||
				normalizedAudience === `${this.resourceServerUrl}/` ||
				// Also accept the MCP endpoint as audience
				normalizedAudience === `${this.resourceServerUrl}/mcp`
			);
		});
	}

	/**
	 * Clear the token cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Remove a specific token from the cache (e.g., on revocation)
	 */
	invalidateToken(token: string): void {
		this.cache.delete(token);
	}
}

/**
 * Create a token verifier from configuration
 */
export function createTokenVerifier(options: TokenVerifierOptions): IntrospectionTokenVerifier {
	return new IntrospectionTokenVerifier(options);
}
