/**
 * Mock Token Generation
 *
 * Generates valid OAuth tokens with CRC32 checksums for CI testing.
 * Uses the same token format as production but without database dependencies.
 *
 * @module @engram/auth-mock/tokens
 */

import { crc32 } from "node:zlib";
import type { DeviceCodeResponse, TokenResponse } from "@engram/common/types";
import { OAuthConfig } from "@engram/common/types";

// =============================================================================
// Token Checksum (CRC6) - duplicated from device-auth.ts for independence
// =============================================================================

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Encode a number to Base62 with fixed length padding.
 */
function encodeBase62(num: number, length: number): string {
	let result = "";
	let remaining = num >>> 0; // Ensure unsigned 32-bit

	while (remaining > 0) {
		result = BASE62_CHARS[remaining % 62] + result;
		remaining = Math.floor(remaining / 62);
	}

	return result.padStart(length, "0");
}

/**
 * Compute CRC32 checksum of a string and return as 6-char Base62.
 */
function computeTokenChecksum(payload: string): string {
	const checksum = crc32(Buffer.from(payload));
	return encodeBase62(checksum, 6);
}

// =============================================================================
// Token Generation
// =============================================================================

/**
 * Generate a mock OAuth access token.
 * Format: egm_oauth_{random32}_{crc6}
 */
export function generateMockAccessToken(): string {
	const randomArray = new Uint8Array(16);
	crypto.getRandomValues(randomArray);
	const random = Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const payload = `egm_oauth_${random}`;
	const checksum = computeTokenChecksum(payload);
	return `${payload}_${checksum}`;
}

/**
 * Generate a mock OAuth refresh token.
 * Format: egm_refresh_{random32}_{crc6}
 */
export function generateMockRefreshToken(): string {
	const randomArray = new Uint8Array(16);
	crypto.getRandomValues(randomArray);
	const random = Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const payload = `egm_refresh_${random}`;
	const checksum = computeTokenChecksum(payload);
	return `${payload}_${checksum}`;
}

/**
 * Generate a mock client credentials token.
 * Format: egm_client_{random32}_{crc6}
 */
export function generateMockClientToken(): string {
	const randomArray = new Uint8Array(16);
	crypto.getRandomValues(randomArray);
	const random = Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const payload = `egm_client_${random}`;
	const checksum = computeTokenChecksum(payload);
	return `${payload}_${checksum}`;
}

/**
 * Generate a human-readable user code (XXXX-XXXX format).
 */
export function generateMockUserCode(): string {
	const chars = OAuthConfig.USER_CODE_CHARS;
	let code = "";

	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < 8; i++) {
		code += chars[bytes[i] % chars.length];
		if (i === 3) code += "-";
	}

	return code;
}

/**
 * Generate a device code (32 hex chars).
 */
export function generateMockDeviceCode(): string {
	const randomArray = new Uint8Array(16);
	crypto.getRandomValues(randomArray);
	return Array.from(randomArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Hash a token using SHA-256.
 */
export function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

// =============================================================================
// Mock User Data
// =============================================================================

/**
 * Mock user for testing.
 */
export const MOCK_USER = {
	id: "mock-user-123",
	name: "Mock User",
	email: "mock@example.com",
};

// =============================================================================
// Token Response Builders
// =============================================================================

/**
 * Build a mock token response for device code or refresh token grants.
 */
export function buildMockTokenResponse(): TokenResponse {
	return {
		access_token: generateMockAccessToken(),
		token_type: "Bearer",
		expires_in: OAuthConfig.ACCESS_TOKEN_EXPIRES_IN,
		refresh_token: generateMockRefreshToken(),
		scopes: [...OAuthConfig.DEFAULT_SCOPES],
		user: MOCK_USER,
	};
}

/**
 * Build a mock device code response.
 */
export function buildMockDeviceCodeResponse(baseUrl: string): DeviceCodeResponse {
	const deviceCode = generateMockDeviceCode();
	const userCode = generateMockUserCode();

	return {
		device_code: deviceCode,
		user_code: userCode,
		verification_uri: `${baseUrl}/activate`,
		verification_uri_complete: `${baseUrl}/activate?code=${userCode}`,
		expires_in: OAuthConfig.DEVICE_CODE_EXPIRES_IN,
		interval: OAuthConfig.POLLING_INTERVAL,
	};
}

/**
 * Build a mock client credentials token response.
 */
export function buildMockClientTokenResponse(scopes: string[]) {
	const CLIENT_TOKEN_EXPIRES_IN = 60 * 60; // 1 hour

	return {
		access_token: generateMockClientToken(),
		token_type: "DPoP",
		expires_in: CLIENT_TOKEN_EXPIRES_IN,
		scope: scopes.join(" "),
	};
}
