import pino, { type DestinationStream } from "pino";
import { mergeRedactPaths } from "./redaction";
import type { Logger, NodeLoggerOptions, TenantContext, TraceContext } from "./types";

/**
 * Create a Pino logger for Node.js/Bun environments.
 *
 * Features:
 * - Uppercase severity levels for Cloud Logging compatibility
 * - ISO timestamps
 * - PII redaction via Pino's built-in redaction
 * - Pretty printing in development
 * - Structured JSON in production
 */
export function createNodeLogger(
	options: NodeLoggerOptions,
	destination?: DestinationStream,
): Logger {
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
						trace: "DEBUG",
						debug: "DEBUG",
						info: "INFO",
						warn: "WARNING",
						error: "ERROR",
						fatal: "CRITICAL",
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

	return logger;
}

/**
 * Create a child logger with additional context.
 *
 * @param logger - Parent logger
 * @param component - Component name
 * @param context - Additional context
 */
export function childLogger(
	logger: Logger,
	component: string,
	context?: Record<string, unknown>,
): Logger {
	return logger.child({ component, ...context });
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
