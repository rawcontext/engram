/**
 * OAuth Token Cache
 *
 * Stores and retrieves OAuth tokens from ~/.engram/auth.json.
 * Handles token expiration checking and automatic refresh.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CachedTokens } from "@engram/common/types";
import type { Logger } from "@engram/logger";

/**
 * Buffer time before token expiration to trigger refresh (5 minutes)
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Path to the token cache file
 */
export function getTokenCachePath(): string {
	return join(homedir(), ".engram", "auth.json");
}

export interface TokenCacheOptions {
	logger: Logger;
	cachePath?: string;
}

export class TokenCache {
	private readonly cachePath: string;
	private readonly logger: Logger;
	private tokens: CachedTokens | null = null;

	constructor(options: TokenCacheOptions) {
		this.logger = options.logger;
		this.cachePath = options.cachePath ?? getTokenCachePath();
	}

	/**
	 * Load tokens from cache file
	 */
	load(): CachedTokens | null {
		try {
			if (!existsSync(this.cachePath)) {
				this.logger.debug({ path: this.cachePath }, "Token cache file not found");
				return null;
			}

			const content = readFileSync(this.cachePath, "utf-8");
			this.tokens = JSON.parse(content) as CachedTokens;

			// Validate required fields
			if (!this.tokens.access_token || !this.tokens.expires_at || !this.tokens.user) {
				this.logger.warn({ path: this.cachePath }, "Token cache missing required fields");
				return null;
			}

			const expiresIn = Math.round((this.tokens.expires_at - Date.now()) / 1000 / 60);
			this.logger.debug(
				{ user: this.tokens.user.email, expiresInMinutes: expiresIn },
				"Loaded tokens from cache",
			);
			return this.tokens;
		} catch (error) {
			this.logger.warn({ error, path: this.cachePath }, "Failed to load token cache");
			return null;
		}
	}

	/**
	 * Save tokens to cache file
	 */
	save(tokens: CachedTokens): void {
		try {
			// Ensure directory exists
			const dir = dirname(this.cachePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true, mode: 0o700 });
			}

			// Write with restrictive permissions
			writeFileSync(this.cachePath, JSON.stringify(tokens, null, 2), {
				mode: 0o600,
			});

			this.tokens = tokens;
			this.logger.debug({ user: tokens.user.email }, "Saved tokens to cache");
		} catch (error) {
			this.logger.error({ error, path: this.cachePath }, "Failed to save token cache");
			throw error;
		}
	}

	/**
	 * Clear the token cache
	 */
	clear(): void {
		try {
			if (existsSync(this.cachePath)) {
				writeFileSync(this.cachePath, "{}", { mode: 0o600 });
			}
			this.tokens = null;
			this.logger.debug("Cleared token cache");
		} catch (error) {
			this.logger.warn({ error }, "Failed to clear token cache");
		}
	}

	/**
	 * Get the current access token if valid
	 */
	getAccessToken(): string | null {
		if (!this.tokens) {
			this.tokens = this.load();
		}

		if (!this.tokens) {
			return null;
		}

		// Check if expired (with buffer)
		if (this.isAccessTokenExpired()) {
			return null;
		}

		return this.tokens.access_token;
	}

	/**
	 * Get the refresh token
	 */
	getRefreshToken(): string | null {
		if (!this.tokens) {
			this.tokens = this.load();
		}

		return this.tokens?.refresh_token ?? null;
	}

	/**
	 * Get user info from cached tokens
	 */
	getUser(): CachedTokens["user"] | null {
		if (!this.tokens) {
			this.tokens = this.load();
		}

		return this.tokens?.user ?? null;
	}

	/**
	 * Check if access token is expired or about to expire
	 */
	isAccessTokenExpired(): boolean {
		if (!this.tokens) {
			this.tokens = this.load();
		}

		if (!this.tokens) {
			return true;
		}

		const now = Date.now();
		const expiresAt = this.tokens.expires_at;

		// Consider expired if within refresh buffer
		return now >= expiresAt - REFRESH_BUFFER_MS;
	}

	/**
	 * Check if we need to refresh the token
	 */
	needsRefresh(): boolean {
		if (!this.tokens) {
			this.tokens = this.load();
		}

		if (!this.tokens) {
			return false; // No tokens, need full auth flow
		}

		return this.isAccessTokenExpired() && !!this.tokens.refresh_token;
	}

	/**
	 * Check if we have valid cached tokens
	 */
	hasValidTokens(): boolean {
		return this.getAccessToken() !== null;
	}

	/**
	 * Update tokens after refresh
	 */
	updateTokens(
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		user?: CachedTokens["user"],
	): void {
		const currentUser = user ?? this.tokens?.user;
		if (!currentUser) {
			throw new Error("No user info available for token update");
		}

		const newTokens: CachedTokens = {
			access_token: accessToken,
			refresh_token: refreshToken,
			expires_at: Date.now() + expiresIn * 1000,
			user: currentUser,
			cached_at: Date.now(),
		};

		this.save(newTokens);
	}
}
