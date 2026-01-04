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

export { type TelemetryConfig, loadTelemetryConfig } from "./config";
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
export { tracingMiddleware, traceWebSocket } from "./middleware";
export {
	traceDbOperation,
	traceHttpCall,
	traceJob,
	traceMcpTool,
	traceNatsOperation,
} from "./clients";
