import pino, { type DestinationStream } from "pino";
import { mergeRedactPaths } from "./redaction";
import type { Logger, NodeLoggerOptions, TenantContext, TraceContext } from "./types";

/**
 * Lifecycle state for logger management
 */
enum LoggerState {
	Active = "active",
	Flushing = "flushing",
	Destroyed = "destroyed",
}

/**
 * Extended logger interface with lifecycle methods
 */
export interface LifecycleLogger extends Logger {
	destroy?: () => void;
}

/**
 * Wraps a Pino logger with lifecycle management to prevent race conditions
 * and post-destroy logging.
 */
function wrapLoggerWithLifecycle(logger: Logger): LifecycleLogger {
	let state = LoggerState.Active;
	const originalFlush = logger.flush?.bind(logger);

	// Wrap all logging methods to check state
	const createLoggingMethod = <T extends (...args: any[]) => any>(originalMethod: T): T => {
		return ((...args: unknown[]) => {
			if (state === LoggerState.Destroyed) {
				// Silently drop logs after destroy
				return;
			}
			return originalMethod(...args);
		}) as T;
	};

	const wrappedLogger = Object.create(logger) as LifecycleLogger;

	// Wrap flush to prevent concurrent flush/destroy
	if (originalFlush) {
		wrappedLogger.flush = ((cb?: (err?: Error) => void) => {
			if (state !== LoggerState.Active) {
				cb?.();
				return;
			}
			state = LoggerState.Flushing;
			try {
				originalFlush(cb);
			} finally {
				if (state === LoggerState.Flushing) {
					state = LoggerState.Active;
				}
			}
		}) as typeof logger.flush;
	}

	// Add destroy method with state tracking
	wrappedLogger.destroy = () => {
		if (state === LoggerState.Destroyed) return;

		// Wait for flush to complete if in progress
		if (state === LoggerState.Flushing) {
			// Already flushing, just mark for destroy
			state = LoggerState.Destroyed;
			return;
		}

		state = LoggerState.Destroyed;
		// Pino doesn't have a destroy method, but we prevent further logging
	};

	// Wrap all logging methods
	(["trace", "debug", "info", "warn", "error", "fatal"] as const).forEach((level) => {
		const originalMethod = logger[level].bind(logger);
		wrappedLogger[level] = createLoggingMethod(originalMethod);
	});

	return wrappedLogger;
}

/**
 * Create a Pino logger for Node.js/Bun environments.
 *
 * Features:
 * - Uppercase severity levels for Cloud Logging compatibility
 * - ISO timestamps
 * - PII redaction via Pino's built-in redaction
 * - Pretty printing in development
 * - Structured JSON in production
 * - Lifecycle management to prevent race conditions and post-destroy logging
 */
export function createNodeLogger(
	options: NodeLoggerOptions,
	destination?: DestinationStream,
): LifecycleLogger {
	const {
		service,
		level = "info",
		environment = process.env.NODE_ENV || "development",
		version = process.env.npm_package_version,
		pretty = environment === "development",
		redactPaths,
		base = {},
		pinoOptions = {},
	} = options;

	const transport = pretty
		? {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "SYS:standard",
					ignore: "pid,hostname",
					levelFirst: true,
					messageFormat: "{component} - {msg}",
				},
			}
		: undefined;

	const logger = pino(
		{
			level,
			// Custom level labels for Cloud Logging compatibility
			formatters: {
				level(label) {
					// Map to Cloud Logging severity
					const severityMap: Record<string, string> = {
						debug: "DEBUG",
						info: "INFO",
						warn: "WARNING",
						error: "ERROR",
					};
					return { severity: severityMap[label] || label.toUpperCase() };
				},
				bindings(bindings) {
					// Remove default pid/hostname, add our base context
					const { pid: _pid, hostname: _hostname, ...rest } = bindings;
					return {
						service,
						environment,
						...(version && { version }),
						...base,
						...rest,
					};
				},
			},
			// ISO timestamp for Cloud Logging
			timestamp: pino.stdTimeFunctions.isoTime,
			// Redaction for PII
			redact: {
				paths: mergeRedactPaths(redactPaths) as string[],
				censor: "[REDACTED]",
			},
			// Transport for pretty printing in dev
			...(transport && { transport }),
			// Merge any custom options
			...pinoOptions,
		},
		destination,
	);

	return wrapLoggerWithLifecycle(logger);
}

/**
 * Create a child logger with trace context.
 *
 * @param logger - Parent logger
 * @param trace - Trace context from request
 */
export function withTraceContext(logger: Logger, trace: TraceContext): Logger {
	return logger.child({
		...(trace.correlationId && { correlation_id: trace.correlationId }),
		...(trace.traceId && { trace_id: trace.traceId }),
		...(trace.spanId && { span_id: trace.spanId }),
		...(trace.requestId && { request_id: trace.requestId }),
	});
}

/**
 * Create a child logger with tenant context.
 *
 * @param logger - Parent logger
 * @param tenant - Tenant context
 */
export function withTenantContext(logger: Logger, tenant: TenantContext): Logger {
	return logger.child({
		...(tenant.tenantId && { tenant_id: tenant.tenantId }),
		...(tenant.campaignId && { campaign_id: tenant.campaignId }),
		...(tenant.adminUserId && { admin_user_id: tenant.adminUserId }),
		...(tenant.externalUserId && { external_user_id: tenant.externalUserId }),
	});
}
