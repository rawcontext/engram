/**
 * OpenTelemetry Client Instrumentation
 *
 * Provides tracing wrappers for external API clients (FalkorDB, NATS, PostgreSQL, etc.)
 */

import type { SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./tracer";

/**
 * Trace a database operation
 *
 * @param operation - Database operation name (query, insert, update, delete)
 * @param dbSystem - Database system (falkordb, postgresql, qdrant)
 * @param statement - SQL/Cypher query or operation description
 * @param fn - Function to execute
 */
export async function traceDbOperation<T>(
	operation: string,
	dbSystem: "falkordb" | "postgresql" | "qdrant" | "redis",
	statement: string,
	fn: () => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(`db.${operation}`, {
		attributes: {
			"db.system": dbSystem,
			"db.operation": operation,
			"db.statement": statement.slice(0, 1000), // Truncate long queries
		},
	});

	try {
		const result = await fn();
		span.setStatus({ code: 1 as SpanStatusCode }); // OK
		return result;
	} catch (error) {
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		span.setStatus({
			code: 2 as SpanStatusCode, // ERROR
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Trace a NATS message operation
 *
 * @param operation - NATS operation (publish, subscribe, consume)
 * @param subject - NATS subject/topic
 * @param fn - Function to execute
 */
export async function traceNatsOperation<T>(
	operation: "publish" | "subscribe" | "consume",
	subject: string,
	fn: () => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(`messaging.${operation}`, {
		attributes: {
			"messaging.system": "nats",
			"messaging.operation": operation,
			"messaging.destination": subject,
		},
	});

	try {
		const result = await fn();
		span.setStatus({ code: 1 as SpanStatusCode }); // OK
		return result;
	} catch (error) {
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		span.setStatus({
			code: 2 as SpanStatusCode, // ERROR
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Trace an external HTTP API call
 *
 * @param method - HTTP method
 * @param url - Target URL
 * @param fn - Function to execute
 */
export async function traceHttpCall<T>(
	method: string,
	url: string,
	fn: () => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const urlObj = new URL(url);
	const span = tracer.startSpan(`http.client.${method.toLowerCase()}`, {
		attributes: {
			"http.method": method,
			"http.url": url,
			"http.scheme": urlObj.protocol.replace(":", ""),
			"http.host": urlObj.host,
			"http.target": urlObj.pathname + urlObj.search,
		},
	});

	try {
		const result = await fn();
		span.setStatus({ code: 1 as SpanStatusCode }); // OK
		return result;
	} catch (error) {
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		span.setStatus({
			code: 2 as SpanStatusCode, // ERROR
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Trace an MCP tool invocation
 *
 * @param toolName - MCP tool name (remember, recall, query, etc.)
 * @param params - Tool parameters (will be truncated for attributes)
 * @param fn - Function to execute
 */
export async function traceMcpTool<T>(
	toolName: string,
	params: Record<string, unknown>,
	fn: () => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(`mcp.tool.${toolName}`, {
		attributes: {
			"mcp.tool.name": toolName,
			"mcp.tool.params": JSON.stringify(params).slice(0, 500), // Truncate large params
		},
	});

	try {
		const result = await fn();
		span.setStatus({ code: 1 as SpanStatusCode }); // OK
		return result;
	} catch (error) {
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		span.setStatus({
			code: 2 as SpanStatusCode, // ERROR
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();
	}
}

/**
 * Trace a background job or scheduled task
 *
 * @param jobName - Job name
 * @param fn - Function to execute
 */
export async function traceJob<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(`job.${jobName}`, {
		attributes: {
			"job.name": jobName,
		},
	});

	try {
		const result = await fn();
		span.setStatus({ code: 1 as SpanStatusCode }); // OK
		return result;
	} catch (error) {
		span.recordException(error instanceof Error ? error : new Error(String(error)));
		span.setStatus({
			code: 2 as SpanStatusCode, // ERROR
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();
	}
}
