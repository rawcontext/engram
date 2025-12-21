import { describe, expect, it } from "vitest";
import { createLogger } from "./index";
import { createNodeLogger, withTenantContext, withTraceContext } from "./node";
import { DEFAULT_REDACT_PATHS, mergeRedactPaths } from "./redaction";

describe("Logger Package", () => {
	describe("Redaction", () => {
		it("should return default paths when no custom paths provided", () => {
			const paths = mergeRedactPaths();
			expect(paths).toEqual(DEFAULT_REDACT_PATHS);
		});

		it("should return default paths with empty array", () => {
			const paths = mergeRedactPaths([]);
			expect(paths).toEqual(DEFAULT_REDACT_PATHS);
		});

		it("should merge custom paths with defaults", () => {
			const customPaths = ["custom.secret"];
			const paths = mergeRedactPaths(customPaths);
			expect(paths).toContain("custom.secret");
			expect(paths).toContain("req.headers.authorization");
		});

		it("should deduplicate paths", () => {
			const customPaths = ["req.headers.authorization"];
			const paths = mergeRedactPaths(customPaths);
			const authPaths = paths.filter((p) => p === "req.headers.authorization");
			expect(authPaths).toHaveLength(1);
		});

		it("should handle multiple custom paths", () => {
			const customPaths = ["my.secret", "another.key", "custom.token"];
			const paths = mergeRedactPaths(customPaths);
			expect(paths).toContain("my.secret");
			expect(paths).toContain("another.key");
			expect(paths).toContain("custom.token");
			expect(paths.length).toBeGreaterThan(DEFAULT_REDACT_PATHS.length);
		});
	});

	describe("Node Logger", () => {
		it("should create a logger with correct base context", () => {
			const logger = createNodeLogger({
				service: "test-service",
				environment: "test",
				base: { component: "test-comp" },
			});

			expect(logger.bindings()).toMatchObject({
				service: "test-service",
				environment: "test",
				component: "test-comp",
			});
		});

		it("should map log levels correctly", () => {
			const logger = createNodeLogger({ service: "test" });
			expect(logger.level).toBe("info");
		});

		it("should respect custom log level", () => {
			const logger = createNodeLogger({ service: "test", level: "debug" });
			expect(logger.level).toBe("debug");
		});

		it("should include version when provided", () => {
			const logger = createNodeLogger({
				service: "test-service",
				version: "1.2.3",
			});
			expect(logger.bindings()).toMatchObject({
				version: "1.2.3",
			});
		});

		it("should create logger with custom redaction paths", () => {
			const logger = createNodeLogger({
				service: "test",
				redactPaths: ["my.custom.path"],
			});
			// Logger should be created successfully with custom redaction
			expect(logger).toBeDefined();
			expect(logger.level).toBe("info");
		});

		it("should create logger with custom pino options", () => {
			const logger = createNodeLogger({
				service: "test",
				pinoOptions: { name: "custom-name" },
			});
			expect(logger).toBeDefined();
		});
	});

	describe("Context Helpers", () => {
		it("should add trace context with all fields", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTraceContext(baseLogger, {
				correlationId: "corr-001",
				traceId: "trace-123",
				spanId: "span-456",
				requestId: "req-789",
			});

			expect(child.bindings()).toMatchObject({
				correlation_id: "corr-001",
				trace_id: "trace-123",
				span_id: "span-456",
				request_id: "req-789",
			});
		});

		it("should add trace context with partial fields", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTraceContext(baseLogger, {
				traceId: "trace-123",
			});

			expect(child.bindings()).toMatchObject({
				trace_id: "trace-123",
			});
			// Should not include undefined fields
			expect(child.bindings().span_id).toBeUndefined();
		});

		it("should add tenant context with all fields", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTenantContext(baseLogger, {
				tenantId: "tenant-abc",
				campaignId: "camp-xyz",
				adminUserId: "admin-001",
				externalUserId: "ext-user-002",
			});

			expect(child.bindings()).toMatchObject({
				tenant_id: "tenant-abc",
				campaign_id: "camp-xyz",
				admin_user_id: "admin-001",
				external_user_id: "ext-user-002",
			});
		});

		it("should add tenant context with partial fields", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTenantContext(baseLogger, {
				tenantId: "tenant-abc",
			});

			expect(child.bindings()).toMatchObject({
				tenant_id: "tenant-abc",
			});
			// Should not include undefined fields
			expect(child.bindings().campaign_id).toBeUndefined();
		});

		it("should handle empty trace context", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTraceContext(baseLogger, {});

			// Should still create child logger without errors
			expect(child).toBeDefined();
		});

		it("should handle empty tenant context", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTenantContext(baseLogger, {});

			// Should still create child logger without errors
			expect(child).toBeDefined();
		});
	});

	describe("Legacy createLogger", () => {
		it("should create a logger with default options", () => {
			const logger = createLogger();
			expect(logger).toBeDefined();
			expect(logger.level).toBe("info");
		});

		it("should create a logger with custom level", () => {
			const logger = createLogger({ level: "debug" });
			expect(logger.level).toBe("debug");
		});

		it("should create a logger with component", () => {
			const logger = createLogger({ component: "TestComponent" });
			expect(logger.bindings()).toMatchObject({
				component: "TestComponent",
			});
		});

		it("should use engram-system as default service", () => {
			const logger = createLogger();
			expect(logger.bindings()).toMatchObject({
				service: "engram-system",
			});
		});
	});
});
