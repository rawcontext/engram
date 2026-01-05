/**
 * Integration tests for OAuth Device Flow (RFC 8628).
 *
 * These tests verify the complete device authorization flow from initiation
 * through authorization to token issuance, testing cross-endpoint state management.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Only run when in observatory directory (avoids pg ESM conflicts)
const isObservatoryRoot = process.cwd().includes("apps/observatory");
const describeOrSkip = isObservatoryRoot ? describe : describe.skip;

interface MockedJsonResponse {
	body: unknown;
	init: { status: number; headers?: Record<string, string> };
}

// Use pg mock from test-preload.ts
const mockQuery = globalThis.__testMocks?.pg?.query ?? mock();

// Mock NextResponse
mock.module("next/server", () => ({
	NextResponse: {
		json: (
			body: unknown,
			init?: { status: number; headers?: Record<string, string> },
		): MockedJsonResponse => ({
			body,
			init: init ?? { status: 200 },
		}),
	},
}));

// Test data
const TEST_DEVICE_CODE = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const TEST_USER_CODE = "ABCD-EFGH";
const TEST_USER_ID = "user-123";
const TEST_CLIENT_ID = "mcp";
const TEST_ACCESS_TOKEN = "egm_oauth_test1234567890123456789012_ABC123";
const TEST_REFRESH_TOKEN = "egm_refresh_test123456789012345678901_DEF456";

function createMockRequest(options: {
	contentType?: string;
	body?: string | Record<string, unknown>;
	authorization?: string;
	dpop?: string;
}): Request {
	const headers = new Headers();
	if (options.contentType) {
		headers.set("content-type", options.contentType);
	}
	if (options.authorization) {
		headers.set("authorization", options.authorization);
	}
	if (options.dpop) {
		headers.set("dpop", options.dpop);
	}

	let bodyText: string;
	if (typeof options.body === "string") {
		bodyText = options.body;
	} else if (options.body) {
		bodyText = JSON.stringify(options.body);
	} else {
		bodyText = "";
	}

	return {
		headers,
		formData: async () => {
			const formData = new FormData();
			const params = new URLSearchParams(bodyText);
			for (const [key, value] of params) {
				formData.append(key, value);
			}
			return formData;
		},
		json: async () => (typeof options.body === "object" ? options.body : JSON.parse(bodyText)),
		text: async () => bodyText,
	} as unknown as Request;
}

describeOrSkip("Device Flow Integration", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.BETTER_AUTH_URL = "http://localhost:6178";
		mockQuery.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("Device Code Lifecycle", () => {
		it("should create device code with correct structure", async () => {
			// Mock INSERT query success
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { createDeviceCode } = await import("@lib/device-auth");

			const result = await createDeviceCode({
				clientId: TEST_CLIENT_ID,
				userAgent: "test-agent",
				ipAddress: "127.0.0.1",
			});

			// Verify response structure (RFC 8628 Section 3.2)
			expect(result).toHaveProperty("device_code");
			expect(result).toHaveProperty("user_code");
			expect(result).toHaveProperty("verification_uri");
			expect(result).toHaveProperty("verification_uri_complete");
			expect(result).toHaveProperty("expires_in");
			expect(result).toHaveProperty("interval");

			// Verify device code format (32 hex chars)
			expect(result.device_code).toMatch(/^[a-f0-9]{32}$/);

			// Verify user code format (XXXX-XXXX) - charset is ABCDEFGHJKMNPQRSTUVWXYZ23456789
			expect(result.user_code).toMatch(
				/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
			);

			// Verify expiration
			expect(result.expires_in).toBe(900); // 15 minutes

			// Verify polling interval
			expect(result.interval).toBe(5);
		});

		it("should poll with authorization_pending before user authorizes", async () => {
			// Mock findDeviceCode - pending status
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "pending",
						expires_at: new Date(Date.now() + 900000), // 15 min from now
						last_polled_at: null,
					},
				],
			});

			// Mock updatePollTimestamp
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			// Should return authorization_pending error
			expect(result).toHaveProperty("error", "authorization_pending");
			expect(result).toHaveProperty("error_description");
		});

		it("should return slow_down when polling too frequently", async () => {
			const recentPoll = new Date(Date.now() - 2000); // 2 seconds ago (< 5 second interval)

			// Mock findDeviceCode (first call for pollForToken)
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "pending",
						expires_at: new Date(Date.now() + 900000),
						last_polled_at: recentPoll,
					},
				],
			});

			// Mock findDeviceCode for updatePollTimestamp (second call)
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						last_polled_at: recentPoll,
					},
				],
			});

			// Mock updatePollTimestamp UPDATE query
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			// Should return slow_down error (RFC 8628)
			expect(result).toHaveProperty("error", "slow_down");
		});

		it("should return tokens after user authorizes", async () => {
			// Mock findDeviceCode - authorized status
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "authorized",
						user_id: TEST_USER_ID,
						expires_at: new Date(Date.now() + 900000),
						last_polled_at: null,
						user_agent: "test-agent",
						ip_address: "127.0.0.1",
					},
				],
			});

			// Mock updatePollTimestamp
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			// Mock user lookup
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: TEST_USER_ID,
						name: "Test User",
						email: "test@example.com",
						org_id: "org-123",
					},
				],
			});

			// Mock org lookup
			mockQuery.mockResolvedValueOnce({
				rows: [{ slug: "test-org" }],
			});

			// Mock token insertion
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			// Mock device code status update (mark as used)
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			// Should return tokens
			expect(result).toHaveProperty("access_token");
			expect(result).toHaveProperty("refresh_token");
			expect(result).toHaveProperty("token_type", "Bearer");
			expect(result).toHaveProperty("expires_in");
			expect(result).toHaveProperty("scopes");
			expect(result).toHaveProperty("user");

			// Verify token format
			const tokenResult = result as { access_token: string; refresh_token: string };
			expect(tokenResult.access_token).toMatch(/^egm_oauth_[a-f0-9]{32}_[A-Za-z0-9]{6}$/);
			expect(tokenResult.refresh_token).toMatch(/^egm_refresh_[a-f0-9]{32}_[A-Za-z0-9]{6}$/);
		});

		it("should return access_denied when user denies authorization", async () => {
			// Mock findDeviceCode - denied status
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "denied",
						expires_at: new Date(Date.now() + 900000),
						last_polled_at: null,
					},
				],
			});

			// Mock updatePollTimestamp
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			expect(result).toHaveProperty("error", "access_denied");
		});

		it("should return expired_token when device code expires", async () => {
			// Mock findDeviceCode - expired
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "pending",
						expires_at: new Date(Date.now() - 1000), // Already expired
						last_polled_at: null,
					},
				],
			});

			// Mock updatePollTimestamp
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			// Mock status update to expired
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			expect(result).toHaveProperty("error", "expired_token");
		});

		it("should return invalid_grant for used device code", async () => {
			// Mock findDeviceCode - already used
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: TEST_CLIENT_ID,
						status: "used",
						expires_at: new Date(Date.now() + 900000),
						last_polled_at: null,
					},
				],
			});

			// Mock updatePollTimestamp
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			expect(result).toHaveProperty("error", "invalid_grant");
		});

		it("should reject mismatched client_id", async () => {
			// Mock findDeviceCode
			mockQuery.mockResolvedValueOnce({
				rows: [
					{
						id: "dc-1",
						device_code: TEST_DEVICE_CODE,
						user_code: TEST_USER_CODE,
						client_id: "different-client",
						status: "pending",
						expires_at: new Date(Date.now() + 900000),
						last_polled_at: null,
					},
				],
			});

			const { pollForToken } = await import("@lib/device-auth");

			const result = await pollForToken(TEST_DEVICE_CODE, TEST_CLIENT_ID);

			expect(result).toHaveProperty("error", "invalid_client");
		});
	});

	describe("User Code Verification", () => {
		it("should authorize device code with valid user code", async () => {
			// Mock UPDATE query - authorizeDeviceCode does a direct UPDATE, returns rowCount=1 if found
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { authorizeDeviceCode } = await import("@lib/device-auth");

			const result = await authorizeDeviceCode(TEST_USER_CODE, TEST_USER_ID);

			expect(result).toBe(true);
		});

		it("should normalize user codes with dashes and spaces", async () => {
			const { normalizeUserCode } = await import("@lib/device-auth");

			// Test various formats
			expect(normalizeUserCode("ABCD-EFGH")).toBe("ABCDEFGH");
			expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
			expect(normalizeUserCode("ABCD EFGH")).toBe("ABCDEFGH");
			expect(normalizeUserCode("abcd efgh")).toBe("ABCDEFGH");
			expect(normalizeUserCode("AbCd-EfGh")).toBe("ABCDEFGH");
		});

		it("should deny device code", async () => {
			// Mock deny update
			mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

			const { denyDeviceCode } = await import("@lib/device-auth");

			const result = await denyDeviceCode(TEST_USER_CODE);

			expect(result).toBe(true);
		});
	});

	describe("Token Checksum Validation", () => {
		it("should validate correct token checksums", async () => {
			const { computeTokenChecksum, validateTokenChecksum } = await import("@lib/device-auth");

			// Generate a token with valid checksum
			const payload = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
			const checksum = computeTokenChecksum(payload);
			const token = `${payload}_${checksum}`;

			expect(validateTokenChecksum(token)).toBe(true);
		});

		it("should reject tokens with invalid checksums", async () => {
			const { validateTokenChecksum } = await import("@lib/device-auth");

			// Token with wrong checksum
			const invalidToken = "egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_WRONG1";

			expect(validateTokenChecksum(invalidToken)).toBe(false);
		});

		it("should reject malformed tokens", async () => {
			const { validateTokenChecksum } = await import("@lib/device-auth");

			expect(validateTokenChecksum("not_a_valid_token")).toBe(false);
			expect(validateTokenChecksum("egm_oauth_short")).toBe(false);
			expect(validateTokenChecksum("")).toBe(false);
		});
	});
});

describeOrSkip("Token Refresh Flow", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		mockQuery.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should refresh access token with valid refresh token", async () => {
		// Mock token lookup
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: "token-1",
					user_id: TEST_USER_ID,
					client_id: TEST_CLIENT_ID,
					scopes: ["memory:read", "memory:write"],
					refresh_token_expires_at: new Date(Date.now() + 2592000000), // 30 days
					revoked_at: null,
					user_name: "Test User",
					user_email: "test@example.com",
				},
			],
		});

		// Mock token update
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		const { refreshAccessToken } = await import("@lib/device-auth");

		const result = await refreshAccessToken(TEST_REFRESH_TOKEN, TEST_CLIENT_ID);

		// Should return new tokens
		expect(result).toHaveProperty("access_token");
		expect(result).toHaveProperty("refresh_token");
		expect(result).toHaveProperty("token_type", "Bearer");
		expect(result).toHaveProperty("scopes");
		expect(result).toHaveProperty("user");
	});

	it("should reject expired refresh token", async () => {
		// Mock token lookup with expired refresh token
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: "token-1",
					user_id: TEST_USER_ID,
					client_id: TEST_CLIENT_ID,
					scopes: ["memory:read"],
					refresh_token_expires_at: new Date(Date.now() - 1000), // Already expired
					revoked_at: null,
					user_name: "Test User",
					user_email: "test@example.com",
				},
			],
		});

		const { refreshAccessToken } = await import("@lib/device-auth");

		const result = await refreshAccessToken(TEST_REFRESH_TOKEN, TEST_CLIENT_ID);

		expect(result).toHaveProperty("error", "invalid_grant");
	});

	it("should reject revoked refresh token", async () => {
		// Mock token lookup with revoked token
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: "token-1",
					user_id: TEST_USER_ID,
					client_id: TEST_CLIENT_ID,
					scopes: ["memory:read"],
					refresh_token_expires_at: new Date(Date.now() + 2592000000),
					revoked_at: new Date(), // Revoked
					user_name: "Test User",
					user_email: "test@example.com",
				},
			],
		});

		const { refreshAccessToken } = await import("@lib/device-auth");

		const result = await refreshAccessToken(TEST_REFRESH_TOKEN, TEST_CLIENT_ID);

		expect(result).toHaveProperty("error", "invalid_grant");
	});

	it("should reject mismatched client_id on refresh", async () => {
		// Mock token lookup
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: "token-1",
					user_id: TEST_USER_ID,
					client_id: "different-client",
					scopes: ["memory:read"],
					refresh_token_expires_at: new Date(Date.now() + 2592000000),
					revoked_at: null,
					user_name: "Test User",
					user_email: "test@example.com",
				},
			],
		});

		const { refreshAccessToken } = await import("@lib/device-auth");

		const result = await refreshAccessToken(TEST_REFRESH_TOKEN, TEST_CLIENT_ID);

		expect(result).toHaveProperty("error", "invalid_client");
	});
});

describeOrSkip("Token Revocation", () => {
	beforeEach(() => {
		mockQuery.mockReset();
	});

	it("should revoke access token", async () => {
		// Mock access token revocation success
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		const { revokeTokenByValue } = await import("@lib/device-auth");

		const result = await revokeTokenByValue(TEST_ACCESS_TOKEN, "access_token");

		expect(result).toBe(true);
	});

	it("should revoke refresh token", async () => {
		// Mock access token lookup (no match)
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		// Mock refresh token revocation success
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		const { revokeTokenByValue } = await import("@lib/device-auth");

		const result = await revokeTokenByValue(TEST_REFRESH_TOKEN);

		expect(result).toBe(true);
	});

	it("should return false for non-existent token (RFC 7009 compliance)", async () => {
		// Mock no token found for either access or refresh
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		const { revokeTokenByValue } = await import("@lib/device-auth");

		// RFC 7009: endpoint returns 200 OK even for non-existent tokens
		// but revokeTokenByValue returns false to indicate no token was revoked
		const result = await revokeTokenByValue("nonexistent_token");

		expect(result).toBe(false);
	});
});

describeOrSkip("Access Token Validation", () => {
	beforeEach(() => {
		mockQuery.mockReset();
	});

	it("should validate active access token", async () => {
		// Mock token lookup
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: "token-1",
					user_id: TEST_USER_ID,
					client_id: TEST_CLIENT_ID,
					scopes: ["memory:read", "memory:write"],
					access_token_expires_at: new Date(Date.now() + 604800000), // 7 days
					revoked_at: null,
				},
			],
		});

		// Mock last_used_at update (fire and forget)
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

		const { validateAccessToken } = await import("@lib/device-auth");

		const result = await validateAccessToken(TEST_ACCESS_TOKEN);

		expect(result).not.toBeNull();
		expect(result).toHaveProperty("user_id", TEST_USER_ID);
		expect(result).toHaveProperty("scopes");
	});

	it("should reject expired access token", async () => {
		// Mock token lookup - expired (query filters by expires_at)
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const { validateAccessToken } = await import("@lib/device-auth");

		const result = await validateAccessToken(TEST_ACCESS_TOKEN);

		expect(result).toBeNull();
	});

	it("should reject revoked access token", async () => {
		// Mock token lookup - revoked (query filters by revoked_at)
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const { validateAccessToken } = await import("@lib/device-auth");

		const result = await validateAccessToken(TEST_ACCESS_TOKEN);

		expect(result).toBeNull();
	});
});
