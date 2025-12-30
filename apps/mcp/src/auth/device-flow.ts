/**
 * OAuth Device Flow Client
 *
 * Implements the client side of RFC 8628 OAuth 2.0 Device Authorization Grant.
 * Handles initiating device flow, polling for tokens, and refreshing tokens.
 *
 * @see docs/design/oauth-device-flow.md
 */

import { exec } from "node:child_process";
import { platform, release, arch } from "node:os";
import type { DeviceCodeResponse, TokenErrorResponse, TokenResponse } from "@engram/common/types";
import type { Logger } from "@engram/logger";
import { TokenCache } from "./token-cache";

export interface DeviceFlowOptions {
	apiUrl: string;
	clientId?: string;
	logger: Logger;
	tokenCache: TokenCache;
}

export interface DeviceFlowResult {
	success: boolean;
	tokens?: TokenResponse;
	error?: string;
}

/**
 * Client for OAuth device flow authentication
 */
export class DeviceFlowClient {
	private readonly apiUrl: string;
	private readonly clientId: string;
	private readonly logger: Logger;
	private readonly tokenCache: TokenCache;

	constructor(options: DeviceFlowOptions) {
		this.apiUrl = options.apiUrl.replace(/\/$/, "");
		this.clientId = options.clientId ?? "mcp";
		this.logger = options.logger;
		this.tokenCache = options.tokenCache;
	}

	/**
	 * Generate a descriptive User-Agent string for device identification
	 */
	private getUserAgent(): string {
		const os = platform();
		const osRelease = release();
		const architecture = arch();

		// Map platform to friendly name
		const osName =
			os === "darwin" ? "macOS" : os === "win32" ? "Windows" : os === "linux" ? "Linux" : os;

		return `Engram-MCP/1.0 (${osName} ${osRelease}; ${architecture}) Bun/${process.versions.bun ?? "unknown"}`;
	}

	/**
	 * Start the device authorization flow
	 *
	 * 1. Request device code from Observatory
	 * 2. Display URL and code to user
	 * 3. Open browser (if possible)
	 * 4. Poll for token
	 * 5. Cache tokens on success
	 */
	async startDeviceFlow(options?: {
		onDisplayCode?: (code: string, url: string, urlComplete: string) => void;
		onPolling?: () => void;
		onSuccess?: (email: string) => void;
		openBrowser?: boolean;
	}): Promise<DeviceFlowResult> {
		// Step 1: Request device code
		this.logger.info("Starting device authorization flow");

		let deviceCodeResponse: DeviceCodeResponse;
		try {
			deviceCodeResponse = await this.requestDeviceCode();
		} catch (error) {
			this.logger.error({ error }, "Failed to request device code");
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to request device code",
			};
		}

		// Step 2: Display code to user
		const { device_code, user_code, verification_uri, verification_uri_complete, interval } =
			deviceCodeResponse;

		// Build complete URL if not provided
		const completeUrl = verification_uri_complete ?? `${verification_uri}?code=${user_code}`;

		if (options?.onDisplayCode) {
			options.onDisplayCode(user_code, verification_uri, completeUrl);
		} else {
			console.log("\n┌─────────────────────────────────────────────────────┐");
			console.log(`│  To authenticate, open: ${verification_uri}`);
			console.log("│");
			console.log(`│  Enter code: ${user_code}`);
			console.log("│");
			console.log(`│  Or visit: ${completeUrl}`);
			console.log("└─────────────────────────────────────────────────────┘\n");
		}

		// Step 3: Open browser (if enabled and possible)
		if (options?.openBrowser !== false) {
			this.openBrowser(completeUrl);
		}

		// Step 4: Poll for token
		options?.onPolling?.();
		const result = await this.pollForToken(device_code, interval);

		if (!result.success || !result.tokens) {
			return result;
		}

		// Step 5: Cache tokens
		this.tokenCache.updateTokens(
			result.tokens.access_token,
			result.tokens.refresh_token,
			result.tokens.expires_in,
			result.tokens.user,
		);

		options?.onSuccess?.(result.tokens.user.email);

		return result;
	}

	/**
	 * Request a device code from the authorization server
	 */
	private async requestDeviceCode(): Promise<DeviceCodeResponse> {
		const response = await fetch(`${this.apiUrl}/api/auth/device`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": this.getUserAgent(),
			},
			body: JSON.stringify({ client_id: this.clientId }),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Device code request failed: ${response.status} - ${error}`);
		}

		return (await response.json()) as DeviceCodeResponse;
	}

	/**
	 * Poll for token with exponential backoff
	 */
	private async pollForToken(deviceCode: string, interval: number): Promise<DeviceFlowResult> {
		const maxAttempts = 180; // 15 minutes at 5 second intervals
		let attempts = 0;
		let currentInterval = interval * 1000;

		while (attempts < maxAttempts) {
			attempts++;

			// Wait before polling
			await this.sleep(currentInterval);

			try {
				const result = await this.requestToken(deviceCode);

				// Check for error responses
				if ("error" in result) {
					const errorResult = result as TokenErrorResponse;

					switch (errorResult.error) {
						case "authorization_pending":
							// User hasn't authorized yet, keep polling
							this.logger.debug("Authorization pending, continuing to poll");
							continue;

						case "slow_down":
							// Increase polling interval
							currentInterval += 5000;
							this.logger.debug({ interval: currentInterval }, "Slowing down polling");
							continue;

						case "expired_token":
							return {
								success: false,
								error: "Device code expired. Please try again.",
							};

						case "access_denied":
							return {
								success: false,
								error: "Authorization denied by user.",
							};

						default:
							return {
								success: false,
								error: errorResult.error_description || errorResult.error,
							};
					}
				}

				// Success!
				const tokens = result as TokenResponse;
				this.logger.info({ user: tokens.user.email }, "Device authorized successfully");
				return { success: true, tokens };
			} catch (error) {
				this.logger.warn({ error, attempt: attempts }, "Token request failed, retrying");
			}
		}

		return {
			success: false,
			error: "Polling timeout. Please try again.",
		};
	}

	/**
	 * Request token from the token endpoint
	 */
	private async requestToken(deviceCode: string): Promise<TokenResponse | TokenErrorResponse> {
		const response = await fetch(`${this.apiUrl}/api/auth/device/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: deviceCode,
				client_id: this.clientId,
			}),
		});

		return (await response.json()) as TokenResponse | TokenErrorResponse;
	}

	/**
	 * Refresh the access token using the refresh token
	 */
	async refreshToken(): Promise<DeviceFlowResult> {
		const refreshToken = this.tokenCache.getRefreshToken();

		if (!refreshToken) {
			return {
				success: false,
				error: "No refresh token available",
			};
		}

		this.logger.debug("Refreshing access token");

		try {
			const response = await fetch(`${this.apiUrl}/api/auth/device/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: this.clientId,
				}),
			});

			const result = (await response.json()) as TokenResponse | TokenErrorResponse;

			if ("error" in result) {
				this.logger.warn({ error: result.error }, "Token refresh failed");
				return {
					success: false,
					error: result.error_description || result.error,
				};
			}

			// Update cached tokens
			this.tokenCache.updateTokens(
				result.access_token,
				result.refresh_token,
				result.expires_in,
				result.user,
			);

			this.logger.info("Access token refreshed successfully");
			return { success: true, tokens: result };
		} catch (error) {
			this.logger.error({ error }, "Token refresh request failed");
			return {
				success: false,
				error: error instanceof Error ? error.message : "Token refresh failed",
			};
		}
	}

	/**
	 * Get a valid access token, refreshing if needed
	 */
	async getValidAccessToken(): Promise<string | null> {
		// Check if we have a valid cached token
		const accessToken = this.tokenCache.getAccessToken();
		if (accessToken) {
			return accessToken;
		}

		// Try to refresh
		if (this.tokenCache.needsRefresh()) {
			const result = await this.refreshToken();
			if (result.success && result.tokens) {
				return result.tokens.access_token;
			}
		}

		// No valid token available
		return null;
	}

	/**
	 * Open URL in the default browser
	 */
	private openBrowser(url: string): void {
		try {
			const os = platform();
			let command: string;

			switch (os) {
				case "darwin":
					command = `open "${url}"`;
					break;
				case "win32":
					command = `start "" "${url}"`;
					break;
				default:
					// Linux and others
					command = `xdg-open "${url}"`;
					break;
			}

			exec(command, (error) => {
				if (error) {
					this.logger.debug({ error }, "Could not open browser automatically");
				}
			});
		} catch (error) {
			this.logger.debug({ error }, "Failed to open browser");
		}
	}

	/**
	 * Sleep for a given duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Check if we have valid cached credentials
 */
export function hasValidCredentials(logger: Logger): boolean {
	const cache = new TokenCache({ logger });
	return cache.hasValidTokens();
}
