/**
 * @engram/telemetry
 *
 * OpenTelemetry instrumentation package for Engram services.
 *
 * Provides:
 * - Tracer provider initialization with OTLP and console exporters
 * - HTTP middleware for Hono framework
 * - Client instrumentation for FalkorDB, NATS, PostgreSQL, Qdrant
 * - MCP tool tracing
 * - WebSocket connection tracing
 */

export {
	traceDbOperation,
	traceHttpCall,
	traceJob,
	traceMcpTool,
	traceNatsOperation,
} from "./clients";
export { loadTelemetryConfig, type TelemetryConfig } from "./config";
export { traceWebSocket, tracingMiddleware } from "./middleware";
export {
	getCurrentSpan,
	getTracePropagationHeaders,
	getTracer,
	initTracing,
	recordSpanException,
	setSpanAttribute,
	shutdownTracing,
	withSpan,
	withSpanSync,
} from "./tracer";
