/**
 * OAuth Token Repository
 *
 * Validates OAuth tokens issued via device flow.
 * Tokens are stored with SHA-256 hashes (same as API keys).
 */

import type { PostgresClient } from "@engram/storage";

export type GrantType = "device_code" | "client_credentials" | "refresh_token";

export interface OAuthToken {
	id: string;
	accessTokenHash: string;
	accessTokenPrefix: string;
	userId: string;
	scopes: string[];
	rateLimitRpm: number;
	accessTokenExpiresAt: Date;
	refreshTokenExpiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
	lastUsedAt?: Date;
	revokedAt?: Date;
	clientId: string;
	grantType: GrantType;
	clientIdRef?: string;
	orgId: string;
	orgSlug: string;
	user?: {
		name: string;
		email: string;
	};
}

interface DbOAuthToken {
	id: string;
	access_token_hash: string;
	access_token_prefix: string;
	user_id: string;
	scopes: string[];
	rate_limit_rpm: number;
	access_token_expires_at: Date;
	refresh_token_expires_at: Date;
	created_at: Date;
	updated_at: Date;
	last_used_at?: Date;
	revoked_at?: Date;
	client_id: string;
	grant_type: GrantType;
	client_id_ref?: string;
	org_id: string;
	org_slug: string;
	user_name?: string;
	user_email?: string;
}

/**
 * Hash a token using SHA-256
 */
export function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

/**
 * Repository for OAuth token operations
 */
export class OAuthTokenRepository {
	constructor(private readonly db: PostgresClient) {}

	/**
	 * Validate an OAuth access token and return its metadata.
	 * Returns null if token is invalid, revoked, or expired.
	 */
	async validate(accessToken: string): Promise<OAuthToken | null> {
		const tokenHash = hashToken(accessToken);

		const row = await this.db.queryOne<DbOAuthToken>(
			`SELECT t.id, t.access_token_hash, t.access_token_prefix, t.user_id,
			        t.scopes, t.rate_limit_rpm, t.access_token_expires_at,
			        t.refresh_token_expires_at, t.created_at, t.updated_at,
			        t.last_used_at, t.revoked_at, t.client_id, t.grant_type,
			        t.client_id_ref, t.org_id, t.org_slug,
			        u.name as user_name, u.email as user_email
			 FROM oauth_tokens t
			 JOIN "user" u ON t.user_id = u.id
			 WHERE t.access_token_hash = $1`,
			[tokenHash],
		);

		if (!row) {
			return null;
		}

		// Check if revoked
		if (row.revoked_at) {
			return null;
		}

		// Check if expired
		if (new Date(row.access_token_expires_at) < new Date()) {
			return null;
		}

		// Update last used timestamp (fire and forget)
		this.updateLastUsed(row.id).catch(() => {});

		return this.mapFromDb(row);
	}

	/**
	 * Update the last_used_at timestamp for a token
	 */
	private async updateLastUsed(id: string): Promise<void> {
		await this.db.query(`UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1`, [id]);
	}

	/**
	 * Map database row to OAuthToken
	 */
	private mapFromDb(row: DbOAuthToken): OAuthToken {
		return {
			id: row.id,
			accessTokenHash: row.access_token_hash,
			accessTokenPrefix: row.access_token_prefix,
			userId: row.user_id,
			scopes: row.scopes,
			rateLimitRpm: row.rate_limit_rpm,
			accessTokenExpiresAt: row.access_token_expires_at,
			refreshTokenExpiresAt: row.refresh_token_expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastUsedAt: row.last_used_at,
			revokedAt: row.revoked_at,
			clientId: row.client_id,
			grantType: row.grant_type,
			clientIdRef: row.client_id_ref,
			orgId: row.org_id,
			orgSlug: row.org_slug,
			user: row.user_name
				? {
						name: row.user_name,
						email: row.user_email || "",
					}
				: undefined,
		};
	}
}
