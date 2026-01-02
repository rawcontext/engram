import { describe, expect, it, mock } from "bun:test";
import { AuditClient } from "./audit";

// Mock logger
const createMockLogger = () => ({
	info: mock(() => {}),
	warn: mock(() => {}),
	error: mock(() => {}),
	debug: mock(() => {}),
});

describe("AuditClient", () => {
	describe("constructor", () => {
		it("should create client without database URL (disabled)", () => {
			const logger = createMockLogger();
			const client = new AuditClient({ logger: logger as any });

			expect(client).toBeDefined();
			expect(logger.warn).toHaveBeenCalled();
		});
	});

	describe("log", () => {
		it("should log to console when database not configured", async () => {
			const logger = createMockLogger();
			const client = new AuditClient({ logger: logger as any });

			await client.log({
				userId: "user-123",
				action: "TEST_ACTION",
			});

			expect(logger.info).toHaveBeenCalled();
		});
	});

	describe("logCrossTenantQuery", () => {
		it("should log cross-tenant query event", async () => {
			const logger = createMockLogger();
			const client = new AuditClient({ logger: logger as any });

			await client.logCrossTenantQuery({
				userId: "user-123",
				userOrgId: "org-a",
				targetOrgId: "org-b",
				query: "MATCH (n) RETURN n",
				ipAddress: "192.168.1.1",
				userAgent: "Test/1.0",
			});

			expect(logger.info).toHaveBeenCalled();
			const call = logger.info.mock.calls[0];
			expect(call[0].audit.action).toBe("CROSS_TENANT_QUERY");
			expect(call[0].audit.targetOrgId).toBe("org-b");
		});
	});

	describe("logCrossTenantRead", () => {
		it("should log cross-tenant read event", async () => {
			const logger = createMockLogger();
			const client = new AuditClient({ logger: logger as any });

			await client.logCrossTenantRead({
				userId: "user-123",
				userOrgId: "org-a",
				targetOrgId: "org-b",
				resourceType: "memory",
				resourceId: "mem-456",
				ipAddress: "192.168.1.1",
				userAgent: "Test/1.0",
			});

			expect(logger.info).toHaveBeenCalled();
			const call = logger.info.mock.calls[0];
			expect(call[0].audit.action).toBe("CROSS_TENANT_READ");
			expect(call[0].audit.resourceType).toBe("memory");
			expect(call[0].audit.resourceId).toBe("mem-456");
		});
	});

	describe("close", () => {
		it("should handle close when pool is null", async () => {
			const logger = createMockLogger();
			const client = new AuditClient({ logger: logger as any });

			// Should not throw
			await expect(client.close()).resolves.toBeUndefined();
		});
	});
});
