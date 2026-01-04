/**
 * OpenTelemetry Middleware for HTTP Frameworks
 *
 * Provides middleware for Hono, Express, and other frameworks to automatically
 * create spans for incoming HTTP requests.
 */

import { type SpanStatusCode, trace } from "@opentelemetry/api";
import type { Context as HonoContext, MiddlewareHandler } from "hono";
import { getTracer } from "./tracer";

/**
 * Hono middleware for OpenTelemetry tracing
 *
 * Creates a span for each incoming HTTP request and sets appropriate attributes.
 *
 * @example
 * import { Hono } from 'hono';
 * import { tracingMiddleware } from '@engram/telemetry';
 *
 * const app = new Hono();
 * app.use('*', tracingMiddleware());
 */
export function tracingMiddleware(): MiddlewareHandler {
	return async (c: HonoContext, next) => {
		const tracer = getTracer();
		const { req } = c;

		// Extract span name from route pattern (if available) or URL path
		const routePath = c.req.routePath || new URL(req.url).pathname;
		const spanName = `${req.method} ${routePath}`;

		const span = tracer.startSpan(spanName, {
			attributes: {
				"http.method": req.method,
				"http.url": req.url,
				"http.route": routePath,
				"http.scheme": new URL(req.url).protocol.replace(":", ""),
				"http.target": new URL(req.url).pathname + new URL(req.url).search,
			},
		});

		// Add tenant context if available (from auth middleware)
		const orgId = c.get("orgId");
		const orgSlug = c.get("orgSlug");
		if (orgId) {
			span.setAttribute("tenant.org_id", orgId);
		}
		if (orgSlug) {
			span.setAttribute("tenant.org_slug", orgSlug);
		}

		// Add user context if available
		const userId = c.get("userId");
		if (userId) {
			span.setAttribute("user.id", userId);
		}

		try {
			// Execute the request handler within the span context
			await next();

			// Set span status based on HTTP status code
			const status = c.res.status;
			span.setAttribute("http.status_code", status);

			if (status >= 400) {
				span.setStatus({
					code: 2 as SpanStatusCode, // ERROR
					message: `HTTP ${status}`,
				});
			} else {
				span.setStatus({ code: 1 as SpanStatusCode }); // OK
			}
		} catch (error) {
			// Record exception and set error status
			span.recordException(error instanceof Error ? error : new Error(String(error)));
			span.setStatus({
				code: 2 as SpanStatusCode, // ERROR
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			span.end();
		}
	};
}

/**
 * WebSocket connection tracing helper
 *
 * Creates a span for WebSocket connection lifecycle.
 *
 * @param action - WebSocket action (connect, disconnect, message)
 * @param sessionId - Session ID for correlation
 * @param fn - Function to execute within span
 */
export async function traceWebSocket<T>(
	action: "connect" | "disconnect" | "message",
	sessionId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(`websocket.${action}`, {
		attributes: {
			"websocket.action": action,
			"session.id": sessionId,
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
