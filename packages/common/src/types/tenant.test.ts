import { describe, expect, it } from "bun:test";
import type { AuthContext } from "./auth";
import {
	createTenantContext,
	generateOrgSlug,
	getTenantContext,
	getTenantGraphName,
	isValidOrgSlug,
	runWithTenantContext,
	TenantAccessError,
	TenantContextError,
	tryGetTenantContext,
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

describe("Runtime Context Management", () => {
	const mockContext = {
		orgId: "org-123",
		orgSlug: "acme",
		userId: "user-456",
		isAdmin: false,
	};

	describe("getTenantContext", () => {
		it("throws when called outside of context scope", () => {
			expect(() => getTenantContext()).toThrow(TenantContextError);
			expect(() => getTenantContext()).toThrow(
				"Tenant context not available. Ensure this code runs within runWithTenantContext().",
			);
		});

		it("returns context when called within scope", async () => {
			await runWithTenantContext(mockContext, async () => {
				const ctx = getTenantContext();
				expect(ctx).toEqual(mockContext);
			});
		});

		it("allows nested access to context", async () => {
			await runWithTenantContext(mockContext, async () => {
				const nested = async () => {
					const ctx = getTenantContext();
					return ctx.orgId;
				};
				const orgId = await nested();
				expect(orgId).toBe("org-123");
			});
		});
	});

	describe("tryGetTenantContext", () => {
		it("returns undefined when called outside of context scope", () => {
			const ctx = tryGetTenantContext();
			expect(ctx).toBeUndefined();
		});

		it("returns context when called within scope", async () => {
			await runWithTenantContext(mockContext, async () => {
				const ctx = tryGetTenantContext();
				expect(ctx).toEqual(mockContext);
			});
		});
	});

	describe("runWithTenantContext", () => {
		it("establishes context for async operations", async () => {
			const result = await runWithTenantContext(mockContext, async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return getTenantContext().orgId;
			});
			expect(result).toBe("org-123");
		});

		it("isolates context between concurrent operations", async () => {
			const ctx1 = { orgId: "org-1", orgSlug: "acme", userId: "u1", isAdmin: false };
			const ctx2 = { orgId: "org-2", orgSlug: "globex", userId: "u2", isAdmin: true };

			const [result1, result2] = await Promise.all([
				runWithTenantContext(ctx1, async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return getTenantContext();
				}),
				runWithTenantContext(ctx2, async () => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					return getTenantContext();
				}),
			]);

			expect(result1).toEqual(ctx1);
			expect(result2).toEqual(ctx2);
		});

		it("propagates errors from inner function", async () => {
			await expect(
				runWithTenantContext(mockContext, async () => {
					throw new Error("Test error");
				}),
			).rejects.toThrow("Test error");
		});

		it("context is not available after scope exits", async () => {
			await runWithTenantContext(mockContext, async () => {
				expect(getTenantContext()).toEqual(mockContext);
			});

			// Context should not be available outside the scope
			expect(() => getTenantContext()).toThrow(TenantContextError);
		});
	});
});
