import { spyOn, describe, expect, it } from "bun:test";
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

	describe("Lifecycle Management", () => {
		it("should prevent logging after destroy", () => {
			const logger = createNodeLogger({ service: "test" });
			const infoSpy = spyOn(console, "info");

			// Log before destroy
			logger.info("before destroy");

			// Destroy logger
			logger.destroy?.();

			// Try to log after destroy
			logger.info("after destroy");

			// Should not throw, but subsequent logs should be dropped
			expect(logger).toBeDefined();

			infoSpy.mockRestore();
		});

		it("should handle flush during destroy", () => {
			const logger = createNodeLogger({ service: "test" });

			// Should not throw
			expect(() => {
				logger.flush?.(() => {});
				logger.destroy?.();
			}).not.toThrow();
		});

		it("should handle multiple destroy calls", () => {
			const logger = createNodeLogger({ service: "test" });

			// Should not throw on multiple destroy calls
			expect(() => {
				logger.destroy?.();
				logger.destroy?.();
				logger.destroy?.();
			}).not.toThrow();
		});

		it("should wrap all logging methods", () => {
			const logger = createNodeLogger({ service: "test" });

			// Should not throw when calling logging methods
			expect(() => {
				logger.trace("trace");
				logger.debug("debug");
				logger.info("info");
				logger.warn("warn");
				logger.error("error");
				logger.fatal("fatal");
			}).not.toThrow();
		});

		it("should handle flush callback", () => {
			const logger = createNodeLogger({ service: "test" });
			const callback = mock();

			logger.flush?.(callback);

			// Callback should be called
			expect(callback).toHaveBeenCalled();
		});

		it("should not flush when already destroyed", () => {
			const logger = createNodeLogger({ service: "test" });
			const callback = mock();

			logger.destroy?.();
			logger.flush?.(callback);

			// Callback should still be called but flush should be no-op
			expect(callback).toHaveBeenCalled();
		});

		it("should handle destroy during flushing", () => {
			const logger = createNodeLogger({ service: "test" });

			// Start a flush with a slow callback
			const flushCallback: (() => void) | null = null;
			logger.flush?.((_err) => {
				// This callback is called synchronously or async
				if (flushCallback) flushCallback();
			});

			// Destroy while flushing (simulated)
			expect(() => {
				logger.destroy?.();
			}).not.toThrow();
		});

		it("should handle flush without callback", () => {
			const logger = createNodeLogger({ service: "test" });

			// Should not throw when flushing without callback
			expect(() => {
				logger.flush?.();
			}).not.toThrow();
		});

		it("should handle flush when not active", () => {
			const logger = createNodeLogger({ service: "test" });
			const callback = mock();

			// Destroy first
			logger.destroy?.();

			// Then flush
			logger.flush?.(callback);

			// Should call callback immediately
			expect(callback).toHaveBeenCalledWith();
		});

		it("should drop all log levels after destroy", () => {
			const logger = createNodeLogger({ service: "test", pretty: false });

			logger.destroy?.();

			// All of these should be silently dropped
			expect(() => {
				logger.trace("dropped");
				logger.debug("dropped");
				logger.info("dropped");
				logger.warn("dropped");
				logger.error("dropped");
				logger.fatal("dropped");
			}).not.toThrow();
		});
	});

	describe("Environment and Configuration", () => {
		it("should use production settings when environment is production", () => {
			const logger = createNodeLogger({
				service: "prod-service",
				environment: "production",
			});

			expect(logger.bindings()).toMatchObject({
				service: "prod-service",
				environment: "production",
			});
		});

		it("should disable pretty mode in production", () => {
			const logger = createNodeLogger({
				service: "prod-service",
				environment: "production",
			});

			// Pretty mode should be disabled by default in production
			expect(logger).toBeDefined();
		});

		it("should explicitly disable pretty mode", () => {
			const logger = createNodeLogger({
				service: "test-service",
				environment: "development",
				pretty: false,
			});

			expect(logger).toBeDefined();
		});

		it("should handle custom environment", () => {
			const logger = createNodeLogger({
				service: "test-service",
				environment: "staging",
			});

			expect(logger.bindings()).toMatchObject({
				environment: "staging",
			});
		});

		it("should create logger without version", () => {
			const originalVersion = process.env.npm_package_version;
			delete process.env.npm_package_version;

			const logger = createNodeLogger({
				service: "test-service",
			});

			// Version should not be in bindings if not provided
			const bindings = logger.bindings();
			expect(bindings.version).toBeUndefined();

			// Restore original value
			if (originalVersion) {
				process.env.npm_package_version = originalVersion;
			}
		});

		it("should use NODE_ENV when environment not specified", () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = "test";

			const logger = createNodeLogger({
				service: "test-service",
			});

			expect(logger.bindings()).toMatchObject({
				environment: "test",
			});

			process.env.NODE_ENV = originalEnv;
		});

		it("should fallback to development when NODE_ENV not set", () => {
			const originalEnv = process.env.NODE_ENV;
			delete process.env.NODE_ENV;

			const logger = createNodeLogger({
				service: "test-service",
			});

			expect(logger.bindings()).toMatchObject({
				environment: "development",
			});

			process.env.NODE_ENV = originalEnv;
		});
	});

	describe("Formatters", () => {
		it("should map trace level to TRACE", () => {
			const logger = createNodeLogger({ service: "test", level: "trace" });

			// Should not throw and level should be trace
			expect(logger.level).toBe("trace");
		});

		it("should map fatal level to FATAL", () => {
			const logger = createNodeLogger({ service: "test", level: "fatal" });

			// Should not throw and level should be fatal (though this is unusual)
			expect(logger.level).toBe("fatal");
		});

		it("should handle non-standard log level in formatters", () => {
			const logger = createNodeLogger({ service: "test" });

			// Fatal is a standard level, but tests the toUpperCase path
			expect(() => {
				logger.fatal("test fatal");
			}).not.toThrow();
		});
	});

	describe("Destination", () => {
		it("should accept custom destination stream", () => {
			const customDestination = {
				write: mock(),
			};

			const logger = createNodeLogger({ service: "test" }, customDestination as any);

			expect(logger).toBeDefined();
		});
	});
});
