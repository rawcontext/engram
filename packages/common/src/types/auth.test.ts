import { describe, expect, it } from "bun:test";
import { identifyTokenType, TOKEN_PATTERNS } from "./auth";

describe("identifyTokenType", () => {
	it("identifies user tokens (egm_oauth_*)", () => {
		const token = "egm_oauth_abc123def456789012345678901234ab_X7kM2p";
		expect(identifyTokenType(token)).toBe("user");
	});

	it("identifies client tokens (egm_client_*)", () => {
		const token = "egm_client_abc123def456789012345678901234ab_Y8nL3q";
		expect(identifyTokenType(token)).toBe("client");
	});

	it("identifies refresh tokens (egm_refresh_*)", () => {
		const token = "egm_refresh_abc123def456789012345678901234ab_Z9oM4r";
		expect(identifyTokenType(token)).toBe("refresh");
	});

	it("returns null for invalid tokens", () => {
		expect(identifyTokenType("invalid_token")).toBeNull();
		expect(identifyTokenType("egm_unknown_abc123def456789012345678901234ab_X7kM2p")).toBeNull();
		expect(identifyTokenType("egm_oauth_tooshort_X7kM2p")).toBeNull();
	});
});

describe("TOKEN_PATTERNS", () => {
	it("validates user tokens correctly", () => {
		expect(TOKEN_PATTERNS.user.test("egm_oauth_abc123def456789012345678901234ab_X7kM2p")).toBe(
			true,
		);
		expect(TOKEN_PATTERNS.user.test("egm_oauth_tooshort_X7kM2p")).toBe(false);
		expect(TOKEN_PATTERNS.user.test("egm_client_abc123def456789012345678901234ab_X7kM2p")).toBe(
			false,
		);
	});

	it("validates client tokens correctly", () => {
		expect(TOKEN_PATTERNS.client.test("egm_client_abc123def456789012345678901234ab_Y8nL3q")).toBe(
			true,
		);
		expect(TOKEN_PATTERNS.client.test("egm_client_tooshort_Y8nL3q")).toBe(false);
		expect(TOKEN_PATTERNS.client.test("egm_oauth_abc123def456789012345678901234ab_Y8nL3q")).toBe(
			false,
		);
	});

	it("validates refresh tokens correctly", () => {
		expect(TOKEN_PATTERNS.refresh.test("egm_refresh_abc123def456789012345678901234ab_Z9oM4r")).toBe(
			true,
		);
		expect(TOKEN_PATTERNS.refresh.test("egm_refresh_tooshort_Z9oM4r")).toBe(false);
		expect(TOKEN_PATTERNS.refresh.test("egm_oauth_abc123def456789012345678901234ab_Z9oM4r")).toBe(
			false,
		);
	});
});
