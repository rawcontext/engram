import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadTelemetryConfig, type TelemetryConfig } from "./config";

describe("loadTelemetryConfig", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should return default configuration when no env vars are set", () => {
		delete process.env.OTEL_ENABLED;
		delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
		delete process.env.OTEL_CONSOLE_EXPORTER;
		delete process.env.OTEL_SERVICE_NAME;
		delete process.env.OTEL_SERVICE_VERSION;

		const config = loadTelemetryConfig();

		expect(config.serviceName).toBe("unknown-service");
		expect(config.enabled).toBe(true);
		expect(config.consoleExporter).toBe(true); // Falls back to console when no OTLP endpoint
	});

	it("should use defaults from parameter", () => {
		const defaults: Partial<TelemetryConfig> = {
			serviceName: "my-service",
			serviceVersion: "1.0.0",
			headers: { Authorization: "Bearer token" },
			resourceAttributes: { environment: "test" },
			tenantContext: { orgId: "org-123", orgSlug: "my-org" },
		};

		const config = loadTelemetryConfig(defaults);

		expect(config.serviceName).toBe("my-service");
		expect(config.serviceVersion).toBe("1.0.0");
		expect(config.headers).toEqual({ Authorization: "Bearer token" });
		expect(config.resourceAttributes).toEqual({ environment: "test" });
		expect(config.tenantContext).toEqual({ orgId: "org-123", orgSlug: "my-org" });
	});

	it("should read OTEL_ENABLED=false to disable tracing", () => {
		process.env.OTEL_ENABLED = "false";

		const config = loadTelemetryConfig();

		expect(config.enabled).toBe(false);
	});

	it("should read OTEL_EXPORTER_OTLP_ENDPOINT", () => {
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";

		const config = loadTelemetryConfig();

		expect(config.otlpEndpoint).toBe("http://localhost:4318/v1/traces");
		expect(config.consoleExporter).toBe(false); // Disabled when OTLP is available
	});

	it("should read OTEL_EXPORTER_OTLP_TRACES_ENDPOINT as fallback", () => {
		process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://traces.example.com/v1/traces";

		const config = loadTelemetryConfig();

		expect(config.otlpEndpoint).toBe("http://traces.example.com/v1/traces");
	});

	it("should prefer OTEL_EXPORTER_OTLP_ENDPOINT over TRACES_ENDPOINT", () => {
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://primary.example.com";
		process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://fallback.example.com";

		const config = loadTelemetryConfig();

		expect(config.otlpEndpoint).toBe("http://primary.example.com");
	});

	it("should enable console exporter when explicitly set", () => {
		process.env.OTEL_CONSOLE_EXPORTER = "true";
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";

		const config = loadTelemetryConfig();

		expect(config.consoleExporter).toBe(true);
		expect(config.otlpEndpoint).toBe("http://localhost:4318");
	});

	it("should read service name and version from env", () => {
		process.env.OTEL_SERVICE_NAME = "test-service";
		process.env.OTEL_SERVICE_VERSION = "2.0.0";

		const config = loadTelemetryConfig();

		expect(config.serviceName).toBe("test-service");
		expect(config.serviceVersion).toBe("2.0.0");
	});

	it("should prefer defaults.serviceName over env var", () => {
		process.env.OTEL_SERVICE_NAME = "env-service";

		const config = loadTelemetryConfig({ serviceName: "default-service" });

		expect(config.serviceName).toBe("default-service");
	});

	it("should handle empty defaults", () => {
		const config = loadTelemetryConfig({});

		expect(config.headers).toEqual({});
		expect(config.resourceAttributes).toEqual({});
	});
});
