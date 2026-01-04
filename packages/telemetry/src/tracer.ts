/**
 * OpenTelemetry Tracer Provider
 *
 * Configures and initializes the OpenTelemetry SDK for distributed tracing.
 */

import {
	context,
	propagation,
	type Span,
	type SpanOptions,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { Resource } from "@opentelemetry/resources";
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { TelemetryConfig } from "./config";

let provider: NodeTracerProvider | null = null;
let tracer: Tracer | null = null;

/**
 * Initialize OpenTelemetry tracing
 *
 * @param config - Telemetry configuration
 * @returns Tracer instance
 */
export function initTracing(config: TelemetryConfig): Tracer {
	if (!config.enabled) {
		console.warn("[Telemetry] Tracing is disabled");
		return trace.getTracer(config.serviceName);
	}

	// Create resource attributes
	const resourceAttrs: Record<string, string | number | boolean> = {
		[ATTR_SERVICE_NAME]: config.serviceName,
		...(config.serviceVersion && { [ATTR_SERVICE_VERSION]: config.serviceVersion }),
		...config.resourceAttributes,
	};

	// Add tenant context if provided
	if (config.tenantContext?.orgId) {
		resourceAttrs["tenant.org_id"] = config.tenantContext.orgId;
	}
	if (config.tenantContext?.orgSlug) {
		resourceAttrs["tenant.org_slug"] = config.tenantContext.orgSlug;
	}

	const resource = new Resource(resourceAttrs);

	// Create tracer provider
	provider = new NodeTracerProvider({ resource });

	// Configure span processors
	if (config.otlpEndpoint) {
		const otlpExporter = new OTLPTraceExporter({
			url: config.otlpEndpoint,
			headers: config.headers,
		});

		provider.addSpanProcessor(
			new BatchSpanProcessor(otlpExporter, {
				maxQueueSize: 2048,
				maxExportBatchSize: 512,
				scheduledDelayMillis: 5000,
				exportTimeoutMillis: 30000,
			}),
		);

		console.log(`[Telemetry] OTLP exporter configured: ${config.otlpEndpoint}`);
	}

	if (config.consoleExporter) {
		provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
		console.log("[Telemetry] Console exporter enabled");
	}

	// Register the provider
	provider.register();

	// Register HTTP auto-instrumentation
	registerInstrumentations({
		instrumentations: [
			new HttpInstrumentation({
				requestHook: (span, request) => {
					// Add custom attributes to HTTP spans
					const headers = (request as any).headers;
					if (headers && typeof headers["user-agent"] === "string") {
						span.setAttribute("http.request.user_agent", headers["user-agent"]);
					}
				},
			}),
		],
	});

	// Get tracer instance
	tracer = trace.getTracer(config.serviceName, config.serviceVersion);

	console.log(`[Telemetry] Initialized tracing for service: ${config.serviceName}`);

	return tracer;
}

/**
 * Get the current tracer instance
 * @param serviceName - Service name for fallback tracer
 * @returns Tracer instance
 */
export function getTracer(serviceName = "unknown-service"): Tracer {
	if (!tracer) {
		return trace.getTracer(serviceName);
	}
	return tracer;
}

/**
 * Shutdown tracing (call on graceful shutdown)
 */
export async function shutdownTracing(): Promise<void> {
	if (provider) {
		await provider.shutdown();
		console.log("[Telemetry] Tracer provider shutdown complete");
	}
}

/**
 * Create a new span with error handling
 *
 * @param name - Span name
 * @param fn - Function to execute within span
 * @param options - Span options
 * @returns Function result
 */
export async function withSpan<T>(
	name: string,
	fn: (span: Span) => Promise<T>,
	options?: SpanOptions,
): Promise<T> {
	const currentTracer = tracer || trace.getTracer("unknown-service");
	const span = currentTracer.startSpan(name, options);

	try {
		const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
		span.setStatus({ code: SpanStatusCode.OK });
		return result;
	} catch (error) {
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: error instanceof Error ? error.message : String(error),
		});
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Create a new span synchronously with error handling
 *
 * @param name - Span name
 * @param fn - Function to execute within span
 * @param options - Span options
 * @returns Function result
 */
export function withSpanSync<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T {
	const currentTracer = tracer || trace.getTracer("unknown-service");
	const span = currentTracer.startSpan(name, options);

	try {
		const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
		span.setStatus({ code: SpanStatusCode.OK });
		return result;
	} catch (error) {
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: error instanceof Error ? error.message : String(error),
		});
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Get the current active span
 */
export function getCurrentSpan(): Span | undefined {
	return trace.getSpan(context.active());
}

/**
 * Set attribute on current span
 */
export function setSpanAttribute(key: string, value: string | number | boolean): void {
	const span = getCurrentSpan();
	if (span) {
		span.setAttribute(key, value);
	}
}

/**
 * Record an exception on current span
 */
export function recordSpanException(error: Error | string): void {
	const span = getCurrentSpan();
	if (span) {
		span.recordException(error instanceof Error ? error : new Error(error));
	}
}

/**
 * Get trace context propagation headers (for outgoing HTTP requests)
 */
export function getTracePropagationHeaders(): Record<string, string> {
	const headers: Record<string, string> = {};
	propagation.inject(context.active(), headers);
	return headers;
}

/**
 * Extract trace context from incoming headers (for incoming HTTP requests)
 */
export function extractTraceContext(headers: Record<string, string | undefined>): void {
	const ctx = propagation.extract(context.active(), headers);
	context.setGlobalContextManager(ctx as any);
}
