import { describe, expect, it } from "bun:test";
import {
	type AuditAction,
	createAuditEntry,
	getActionSeverity,
	isCrossTenantAction,
} from "./audit";

describe("audit utilities", () => {
	describe("createAuditEntry", () => {
		it("should add timestamp and success defaults", () => {
			const entry = createAuditEntry({
				userId: "user-123",
				action: "TOKEN_ISSUED",
			});

			expect(entry.userId).toBe("user-123");
			expect(entry.action).toBe("TOKEN_ISSUED");
			expect(entry.timestamp).toBeInstanceOf(Date);
			expect(entry.success).toBe(true);
		});

		it("should preserve provided values", () => {
			const customDate = new Date("2024-01-01");
			const entry = createAuditEntry({
				userId: "user-123",
				action: "CROSS_TENANT_QUERY",
				targetOrgId: "org-456",
				success: false,
				timestamp: customDate,
				errorMessage: "Access denied",
			});

			expect(entry.userId).toBe("user-123");
			expect(entry.targetOrgId).toBe("org-456");
			expect(entry.success).toBe(false);
			expect(entry.timestamp).toBe(customDate);
			expect(entry.errorMessage).toBe("Access denied");
		});

		it("should handle all optional fields", () => {
			const entry = createAuditEntry({
				userId: "user-123",
				action: "CROSS_TENANT_READ",
				userOrgId: "org-123",
				targetOrgId: "org-456",
				resourceType: "memory",
				resourceId: "mem-789",
				ipAddress: "192.168.1.1",
				userAgent: "Mozilla/5.0",
				metadata: { query: "MATCH (n) RETURN n" },
			});

			expect(entry.userOrgId).toBe("org-123");
			expect(entry.resourceType).toBe("memory");
			expect(entry.resourceId).toBe("mem-789");
			expect(entry.ipAddress).toBe("192.168.1.1");
			expect(entry.userAgent).toBe("Mozilla/5.0");
			expect(entry.metadata).toEqual({ query: "MATCH (n) RETURN n" });
		});
	});

	describe("isCrossTenantAction", () => {
		it("should return true for cross-tenant actions", () => {
			expect(isCrossTenantAction("CROSS_TENANT_QUERY")).toBe(true);
			expect(isCrossTenantAction("CROSS_TENANT_READ")).toBe(true);
			expect(isCrossTenantAction("CROSS_TENANT_WRITE")).toBe(true);
			expect(isCrossTenantAction("CROSS_TENANT_DELETE")).toBe(true);
		});

		it("should return false for non-cross-tenant actions", () => {
			expect(isCrossTenantAction("ORG_CREATE")).toBe(false);
			expect(isCrossTenantAction("ORG_UPDATE")).toBe(false);
			expect(isCrossTenantAction("ORG_DELETE")).toBe(false);
			expect(isCrossTenantAction("ORG_MEMBER_ADD")).toBe(false);
			expect(isCrossTenantAction("ORG_MEMBER_REMOVE")).toBe(false);
			expect(isCrossTenantAction("ORG_ROLE_CHANGE")).toBe(false);
			expect(isCrossTenantAction("TOKEN_ISSUED")).toBe(false);
			expect(isCrossTenantAction("TOKEN_REVOKED")).toBe(false);
			expect(isCrossTenantAction("ADMIN_IMPERSONATION")).toBe(false);
		});
	});

	describe("getActionSeverity", () => {
		it("should return critical for destructive and impersonation actions", () => {
			expect(getActionSeverity("CROSS_TENANT_DELETE")).toBe("critical");
			expect(getActionSeverity("ORG_DELETE")).toBe("critical");
			expect(getActionSeverity("ADMIN_IMPERSONATION")).toBe("critical");
		});

		it("should return high for write and revocation actions", () => {
			expect(getActionSeverity("CROSS_TENANT_WRITE")).toBe("high");
			expect(getActionSeverity("ORG_MEMBER_REMOVE")).toBe("high");
			expect(getActionSeverity("TOKEN_REVOKED")).toBe("high");
		});

		it("should return medium for read and org management actions", () => {
			expect(getActionSeverity("CROSS_TENANT_QUERY")).toBe("medium");
			expect(getActionSeverity("CROSS_TENANT_READ")).toBe("medium");
			expect(getActionSeverity("ORG_CREATE")).toBe("medium");
			expect(getActionSeverity("ORG_UPDATE")).toBe("medium");
			expect(getActionSeverity("ORG_MEMBER_ADD")).toBe("medium");
			expect(getActionSeverity("ORG_ROLE_CHANGE")).toBe("medium");
		});

		it("should return low for token issuance", () => {
			expect(getActionSeverity("TOKEN_ISSUED")).toBe("low");
		});

		it("should return low for unknown actions", () => {
			// Test default case with an action cast
			expect(getActionSeverity("UNKNOWN_ACTION" as AuditAction)).toBe("low");
		});
	});
});
