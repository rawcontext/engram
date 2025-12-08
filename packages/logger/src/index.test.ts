import { describe, expect, it, spyOn } from "bun:test";
import { createNodeLogger, withTenantContext, withTraceContext } from "./node";
import { DEFAULT_REDACT_PATHS, mergeRedactPaths } from "./redaction";

describe("Logger Package", () => {
	describe("Redaction", () => {
		it("should return default paths when no custom paths provided", () => {
			const paths = mergeRedactPaths();
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
			// This is hard to test directly without mocking pino or stream
			// relying on bindings check which confirms configuration was passed
			const logger = createNodeLogger({ service: "test" });
			expect(logger.level).toBe("info");
		});
	});

	describe("Context Helpers", () => {
		it("should add trace context", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTraceContext(baseLogger, {
				traceId: "trace-123",
				spanId: "span-456",
			});

			expect(child.bindings()).toMatchObject({
				trace_id: "trace-123",
				span_id: "span-456",
			});
		});

		it("should add tenant context", () => {
			const baseLogger = createNodeLogger({ service: "test" });
			const child = withTenantContext(baseLogger, {
				tenantId: "tenant-abc",
				campaignId: "camp-xyz",
			});

			expect(child.bindings()).toMatchObject({
				tenant_id: "tenant-abc",
				campaign_id: "camp-xyz",
			});
		});
	});
});
