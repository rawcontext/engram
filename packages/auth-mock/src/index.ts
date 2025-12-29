/**
 * Mock OAuth Server
 *
 * Provides mock OAuth endpoints for CI testing without database dependencies.
 * All tokens are valid with proper CRC32 checksums but ephemeral (in-memory only).
 *
 * @example
 * ```ts
 * import { createMockAuthServer, buildMockTokenResponse } from '@engram/auth-mock';
 *
 * // Start server
 * const server = createMockAuthServer(3010);
 *
 * // Generate mock tokens for testing
 * const tokenResponse = buildMockTokenResponse();
 * console.log(tokenResponse.access_token); // egm_oauth_...
 * ```
 *
 * @module @engram/auth-mock
 */

export { createMockAuthServer } from "./server";
export {
	buildMockClientTokenResponse,
	buildMockDeviceCodeResponse,
	buildMockTokenResponse,
	generateMockAccessToken,
	generateMockClientToken,
	generateMockDeviceCode,
	generateMockRefreshToken,
	generateMockUserCode,
	hashToken,
	MOCK_USER,
} from "./tokens";
