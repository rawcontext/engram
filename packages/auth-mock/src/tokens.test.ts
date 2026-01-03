import { describe, expect, it } from "bun:test";
import {
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

describe("tokens", () => {
	describe("generateMockAccessToken", () => {
		it("should generate token with correct format", () => {
			const token = generateMockAccessToken();

			expect(token).toMatch(/^egm_oauth_[0-9a-f]{32}_[A-Za-z0-9]{6}$/);
		});

		it("should generate unique tokens", () => {
			const token1 = generateMockAccessToken();
			const token2 = generateMockAccessToken();

			expect(token1).not.toBe(token2);
		});

		it("should have consistent checksum", () => {
			const token = generateMockAccessToken();
			const parts = token.split("_");

			// egm_oauth_random_checksum
			expect(parts).toHaveLength(4);
			expect(parts[0]).toBe("egm");
			expect(parts[1]).toBe("oauth");
			expect(parts[2]).toHaveLength(32);
			expect(parts[3]).toHaveLength(6);
		});
	});

	describe("generateMockRefreshToken", () => {
		it("should generate token with correct format", () => {
			const token = generateMockRefreshToken();

			expect(token).toMatch(/^egm_refresh_[0-9a-f]{32}_[A-Za-z0-9]{6}$/);
		});

		it("should generate unique tokens", () => {
			const token1 = generateMockRefreshToken();
			const token2 = generateMockRefreshToken();

			expect(token1).not.toBe(token2);
		});
	});

	describe("generateMockClientToken", () => {
		it("should generate token with correct format", () => {
			const token = generateMockClientToken();

			expect(token).toMatch(/^egm_client_[0-9a-f]{32}_[A-Za-z0-9]{6}$/);
		});

		it("should generate unique tokens", () => {
			const token1 = generateMockClientToken();
			const token2 = generateMockClientToken();

			expect(token1).not.toBe(token2);
		});
	});

	describe("generateMockUserCode", () => {
		it("should generate code in XXXX-XXXX format", () => {
			const code = generateMockUserCode();

			expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
		});

		it("should generate unique codes", () => {
			const code1 = generateMockUserCode();
			const code2 = generateMockUserCode();

			expect(code1).not.toBe(code2);
		});

		it("should only use allowed characters (no I, L, O)", () => {
			// Run multiple times to increase probability of catching issues
			for (let i = 0; i < 10; i++) {
				const code = generateMockUserCode();
				// Excludes I, L, O to avoid confusion with 1, l, 0
				const allowedChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

				for (const char of code.replace("-", "")) {
					expect(allowedChars).toContain(char);
				}
			}
		});
	});

	describe("generateMockDeviceCode", () => {
		it("should generate 32 hex character code", () => {
			const code = generateMockDeviceCode();

			expect(code).toMatch(/^[0-9a-f]{32}$/);
		});

		it("should generate unique codes", () => {
			const code1 = generateMockDeviceCode();
			const code2 = generateMockDeviceCode();

			expect(code1).not.toBe(code2);
		});
	});

	describe("hashToken", () => {
		it("should return SHA-256 hex hash", () => {
			const hash = hashToken("test-token");

			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it("should return consistent hash for same input", () => {
			const hash1 = hashToken("same-input");
			const hash2 = hashToken("same-input");

			expect(hash1).toBe(hash2);
		});

		it("should return different hash for different input", () => {
			const hash1 = hashToken("input1");
			const hash2 = hashToken("input2");

			expect(hash1).not.toBe(hash2);
		});
	});

	describe("MOCK_USER", () => {
		it("should have required properties", () => {
			expect(MOCK_USER.id).toBe("mock-user-123");
			expect(MOCK_USER.name).toBe("Mock User");
			expect(MOCK_USER.email).toBe("mock@example.com");
		});
	});

	describe("buildMockTokenResponse", () => {
		it("should return valid token response structure", () => {
			const response = buildMockTokenResponse();

			expect(response.access_token).toMatch(/^egm_oauth_/);
			expect(response.refresh_token).toMatch(/^egm_refresh_/);
			expect(response.token_type).toBe("Bearer");
			expect(response.expires_in).toBeGreaterThan(0);
			expect(Array.isArray(response.scopes)).toBe(true);
			expect(response.user).toEqual(MOCK_USER);
		});

		it("should generate unique tokens each call", () => {
			const response1 = buildMockTokenResponse();
			const response2 = buildMockTokenResponse();

			expect(response1.access_token).not.toBe(response2.access_token);
			expect(response1.refresh_token).not.toBe(response2.refresh_token);
		});
	});

	describe("buildMockDeviceCodeResponse", () => {
		it("should return valid device code response structure", () => {
			const baseUrl = "http://localhost:3010";
			const response = buildMockDeviceCodeResponse(baseUrl);

			expect(response.device_code).toMatch(/^[0-9a-f]{32}$/);
			expect(response.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
			expect(response.verification_uri).toBe(`${baseUrl}/activate`);
			expect(response.verification_uri_complete).toContain(`${baseUrl}/activate?code=`);
			expect(response.expires_in).toBeGreaterThan(0);
			expect(response.interval).toBeGreaterThan(0);
		});

		it("should include user code in verification_uri_complete", () => {
			const response = buildMockDeviceCodeResponse("http://test:8080");

			expect(response.verification_uri_complete).toContain(response.user_code);
		});
	});

	describe("buildMockClientTokenResponse", () => {
		it("should return valid client token response structure", () => {
			const scopes = ["memory:read", "memory:write"];
			const response = buildMockClientTokenResponse(scopes);

			expect(response.access_token).toMatch(/^egm_client_/);
			expect(response.token_type).toBe("DPoP");
			expect(response.expires_in).toBe(3600);
			expect(response.scope).toBe("memory:read memory:write");
		});

		it("should handle single scope", () => {
			const response = buildMockClientTokenResponse(["query:read"]);

			expect(response.scope).toBe("query:read");
		});

		it("should handle empty scopes", () => {
			const response = buildMockClientTokenResponse([]);

			expect(response.scope).toBe("");
		});
	});
});
