import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as otelApi from "@opentelemetry/api";
import type { TelemetryConfig } from "./config";
// Import extractTraceContext from module for testing
import * as tracerModule from "./tracer";

const {
	getCurrentSpan,
	getTracePropagationHeaders,
	getTracer,
	initTracing,
	recordSpanException,
	setSpanAttribute,
	shutdownTracing,
	withSpan,
	withSpanSync,
} = tracerModule;

describe("Tracer Module", () => {
	let consoleWarnSpy: ReturnType<typeof spyOn>;
	let consoleLogSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
		consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		consoleWarnSpy.mockRestore();
		consoleLogSpy.mockRestore();
		await shutdownTracing();
	});

	describe("initTracing", () => {
		it("should return tracer when disabled", () => {
			const config: TelemetryConfig = {
				serviceName: "test-service",
				enabled: false,
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
			expect(consoleWarnSpy).toHaveBeenCalledWith("[Telemetry] Tracing is disabled");
		});

		it("should initialize with console exporter", () => {
			const config: TelemetryConfig = {
				serviceName: "test-service",
				enabled: true,
				consoleExporter: true,
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
			expect(consoleLogSpy).toHaveBeenCalledWith("[Telemetry] Console exporter enabled");
		});

		it("should initialize with OTLP exporter", () => {
			const config: TelemetryConfig = {
				serviceName: "test-service",
				enabled: true,
				otlpEndpoint: "http://localhost:4318/v1/traces",
				headers: { Authorization: "Bearer token" },
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
			expect(consoleLogSpy).toHaveBeenCalledWith(
				"[Telemetry] OTLP exporter configured: http://localhost:4318/v1/traces",
			);
		});

		it("should add service version to resource", () => {
			const config: TelemetryConfig = {
				serviceName: "versioned-service",
				serviceVersion: "1.2.3",
				enabled: true,
				consoleExporter: true,
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
		});

		it("should add tenant context to resource", () => {
			const config: TelemetryConfig = {
				serviceName: "tenant-service",
				enabled: true,
				consoleExporter: true,
				tenantContext: {
					orgId: "org-123",
					orgSlug: "my-org",
				},
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
		});

		it("should add custom resource attributes", () => {
			const config: TelemetryConfig = {
				serviceName: "custom-attrs-service",
				enabled: true,
				consoleExporter: true,
				resourceAttributes: {
					"deployment.environment": "staging",
					"host.name": "server-1",
				},
			};

			const tracer = initTracing(config);

			expect(tracer).toBeDefined();
		});
	});

	describe("getTracer", () => {
		it("should return fallback tracer when not initialized", () => {
			const tracer = getTracer("fallback-service");

			expect(tracer).toBeDefined();
		});

		it("should return initialized tracer after init", () => {
			initTracing({
				serviceName: "init-service",
				enabled: true,
				consoleExporter: true,
			});

			// First call after init
			const tracer1 = getTracer();
			expect(tracer1).toBeDefined();

			// Second call should return cached tracer (tests line 123 branch)
			const tracer2 = getTracer();
			expect(tracer2).toBeDefined();
			expect(tracer2).toBe(tracer1);
		});

		it("should return cached tracer on subsequent calls", () => {
			initTracing({
				serviceName: "cached-tracer-service",
				enabled: true,
				consoleExporter: true,
			});

			// Multiple calls should return the same tracer instance
			const t1 = getTracer();
			const t2 = getTracer("ignored-service-name");
			const t3 = getTracer();

			expect(t1).toBe(t2);
			expect(t2).toBe(t3);
		});
	});

	describe("shutdownTracing", () => {
		it("should shutdown gracefully when not initialized", async () => {
			await expect(shutdownTracing()).resolves.toBeUndefined();
		});

		it("should shutdown provider when initialized", async () => {
			initTracing({
				serviceName: "shutdown-service",
				enabled: true,
				consoleExporter: true,
			});

			await shutdownTracing();

			expect(consoleLogSpy).toHaveBeenCalledWith("[Telemetry] Tracer provider shutdown complete");
		});
	});

	describe("withSpan", () => {
		beforeEach(() => {
			initTracing({
				serviceName: "span-test-service",
				enabled: true,
				consoleExporter: true,
			});
		});

		it("should execute function within span and return result", async () => {
			const result = await withSpan("test-span", async (span) => {
				expect(span).toBeDefined();
				return { data: "success" };
			});

			expect(result).toEqual({ data: "success" });
		});

		it("should propagate errors and record exception", async () => {
			const error = new Error("Test error");

			await expect(
				withSpan("error-span", async () => {
					throw error;
				}),
			).rejects.toThrow("Test error");
		});

		it("should accept span options", async () => {
			await withSpan(
				"options-span",
				async () => {
					return "done";
				},
				{ attributes: { custom: "attr" } },
			);
		});
	});

	describe("withSpanSync", () => {
		beforeEach(() => {
			initTracing({
				serviceName: "sync-span-service",
				enabled: true,
				consoleExporter: true,
			});
		});

		it("should execute sync function within span", () => {
			const result = withSpanSync("sync-span", (span) => {
				expect(span).toBeDefined();
				return 42;
			});

			expect(result).toBe(42);
		});

		it("should propagate sync errors", () => {
			expect(() =>
				withSpanSync("sync-error-span", () => {
					throw new Error("Sync error");
				}),
			).toThrow("Sync error");
		});

		it("should handle non-Error sync exceptions", () => {
			expect(() =>
				withSpanSync("sync-string-error", () => {
					throw "string error";
				}),
			).toThrow();
		});
	});

	describe("getCurrentSpan", () => {
		it("should return undefined when no active span", () => {
			const span = getCurrentSpan();

			expect(span).toBeUndefined();
		});
	});

	describe("setSpanAttribute", () => {
		it("should not throw when no active span", () => {
			expect(() => setSpanAttribute("key", "value")).not.toThrow();
		});

		it("should set attribute on active span", async () => {
			initTracing({
				serviceName: "attr-test-service",
				enabled: true,
				consoleExporter: true,
			});

			await withSpan("attr-span", async () => {
				// This should set attribute on the active span
				setSpanAttribute("custom.key", "custom-value");
				setSpanAttribute("custom.number", 42);
				setSpanAttribute("custom.bool", true);
			});
		});
	});

	describe("recordSpanException", () => {
		it("should not throw when no active span", () => {
			expect(() => recordSpanException(new Error("test"))).not.toThrow();
		});

		it("should handle string exceptions", () => {
			expect(() => recordSpanException("string error")).not.toThrow();
		});

		it("should record exception on active span", async () => {
			initTracing({
				serviceName: "exception-test-service",
				enabled: true,
				consoleExporter: true,
			});

			await withSpan("exception-span", async () => {
				// Record exception but don't throw
				recordSpanException(new Error("logged error"));
				recordSpanException("string exception");
			});
		});
	});

	describe("getTracePropagationHeaders", () => {
		it("should return headers object", () => {
			const headers = getTracePropagationHeaders();

			expect(headers).toBeDefined();
			expect(typeof headers).toBe("object");
		});
	});

	describe("extractTraceContext", () => {
		it("should extract trace context from headers", () => {
			// This function has side effects but should not throw
			const headers = {
				traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
				tracestate: "congo=t61rcWkgMzE",
			};

			expect(() => tracerModule.extractTraceContext(headers)).not.toThrow();
		});

		it("should handle empty headers", () => {
			expect(() => tracerModule.extractTraceContext({})).not.toThrow();
		});

		it("should handle undefined header values", () => {
			const headers: Record<string, string | undefined> = {
				traceparent: undefined,
				other: "value",
			};

			expect(() => tracerModule.extractTraceContext(headers)).not.toThrow();
		});
	});
});
