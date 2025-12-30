import { describe, expect, it } from "bun:test";
import type { AuthContext } from "./auth";
import {
	createTenantContext,
	generateOrgSlug,
	getTenantGraphName,
	isValidOrgSlug,
	TenantAccessError,
	validateTenantAccess,
} from "./tenant";

describe("getTenantGraphName", () => {
	it("generates correct graph name format", () => {
		const result = getTenantGraphName({ orgSlug: "acme", orgId: "01ABC123" });
		expect(result).toBe("engram_acme_01ABC123");
	});

	it("handles hyphens in slug", () => {
		const result = getTenantGraphName({ orgSlug: "my-company", orgId: "XYZ789" });
		expect(result).toBe("engram_my-company_XYZ789");
	});
});

describe("createTenantContext", () => {
	it("creates context from auth with admin scope", () => {
		const auth: AuthContext & { orgId: string; orgSlug: string } = {
			id: "token-1",
			prefix: "egm_",
			method: "oauth" as const,
			type: "oauth" as const,
			userId: "user-123",
			orgId: "org-456",
			orgSlug: "acme",
			scopes: ["memory:read", "admin:read"],
			rateLimit: 60,
		};

		const ctx = createTenantContext(auth);

		expect(ctx.orgId).toBe("org-456");
		expect(ctx.orgSlug).toBe("acme");
		expect(ctx.userId).toBe("user-123");
		expect(ctx.isAdmin).toBe(true);
	});

	it("creates context without admin scope", () => {
		const auth: AuthContext & { orgId: string; orgSlug: string } = {
			id: "token-1",
			prefix: "egm_",
			method: "oauth" as const,
			type: "oauth" as const,
			userId: "user-123",
			orgId: "org-456",
			orgSlug: "acme",
			scopes: ["memory:read"],
			rateLimit: 60,
		};

		const ctx = createTenantContext(auth);
		expect(ctx.isAdmin).toBe(false);
	});

	it("throws if userId is missing", () => {
		const auth = {
			id: "token-1",
			prefix: "egm_",
			method: "oauth" as const,
			type: "oauth" as const,
			orgId: "org-456",
			orgSlug: "acme",
			scopes: [],
			rateLimit: 60,
		};

		expect(() => createTenantContext(auth as any)).toThrow("userId is required");
	});
});

describe("validateTenantAccess", () => {
	it("allows access to own tenant", () => {
		const ctx = { orgId: "org-1", orgSlug: "acme", userId: "u1", isAdmin: false };
		expect(() => validateTenantAccess(ctx, "org-1")).not.toThrow();
	});

	it("denies cross-tenant access for non-admin", () => {
		const ctx = { orgId: "org-1", orgSlug: "acme", userId: "u1", isAdmin: false };
		expect(() => validateTenantAccess(ctx, "org-2")).toThrow(TenantAccessError);
	});

	it("allows cross-tenant access for admin", () => {
		const ctx = { orgId: "org-1", orgSlug: "acme", userId: "u1", isAdmin: true };
		expect(() => validateTenantAccess(ctx, "org-2")).not.toThrow();
	});
});

describe("isValidOrgSlug", () => {
	it("accepts valid slugs", () => {
		expect(isValidOrgSlug("acme")).toBe(true);
		expect(isValidOrgSlug("my-company")).toBe(true);
		expect(isValidOrgSlug("a")).toBe(true);
		expect(isValidOrgSlug("a1")).toBe(true);
	});

	it("rejects invalid slugs", () => {
		expect(isValidOrgSlug("")).toBe(false);
		expect(isValidOrgSlug("-acme")).toBe(false);
		expect(isValidOrgSlug("acme-")).toBe(false);
		expect(isValidOrgSlug("ACME")).toBe(false);
		expect(isValidOrgSlug("my_company")).toBe(false);
	});
});

describe("generateOrgSlug", () => {
	it("converts name to slug", () => {
		expect(generateOrgSlug("Acme Corp")).toBe("acme-corp");
		expect(generateOrgSlug("My Company!")).toBe("my-company");
		expect(generateOrgSlug("  Spaces  ")).toBe("spaces");
	});

	it("limits to 32 characters", () => {
		const longName = "A".repeat(50);
		expect(generateOrgSlug(longName).length).toBeLessThanOrEqual(32);
	});
});
