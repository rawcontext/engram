/**
 * OpenTelemetry Configuration
 *
 * Provides configuration options for trace exporters and resource attributes.
 */

export interface TelemetryConfig {
	/** Service name for resource attributes */
	serviceName: string;
	/** Service version */
	serviceVersion?: string;
	/** OTLP exporter endpoint (e.g., 'http://localhost:4318/v1/traces') */
	otlpEndpoint?: string;
	/** Whether to export to console (for local dev) */
	consoleExporter?: boolean;
	/** Whether tracing is enabled at all */
	enabled?: boolean;
	/** Optional headers for OTLP exporter */
	headers?: Record<string, string>;
	/** Additional resource attributes */
	resourceAttributes?: Record<string, string | number | boolean>;
	/** Tenant context (org_id, org_slug) */
	tenantContext?: {
		orgId?: string;
		orgSlug?: string;
	};
}

/**
 * Load telemetry configuration from environment variables
 */
export function loadTelemetryConfig(defaults: Partial<TelemetryConfig> = {}): TelemetryConfig {
	const enabled = process.env.OTEL_ENABLED !== "false";
	const otlpEndpoint =
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
	const consoleExporter = process.env.OTEL_CONSOLE_EXPORTER === "true";

	return {
		serviceName: defaults.serviceName || process.env.OTEL_SERVICE_NAME || "unknown-service",
		serviceVersion: defaults.serviceVersion || process.env.OTEL_SERVICE_VERSION,
		otlpEndpoint,
		consoleExporter: consoleExporter || (!otlpEndpoint && enabled),
		enabled,
		headers: defaults.headers || {},
		resourceAttributes: defaults.resourceAttributes || {},
		tenantContext: defaults.tenantContext,
	};
}
