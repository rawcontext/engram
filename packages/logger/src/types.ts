import type { Logger as PinoLogger, LoggerOptions as PinoOptions } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface BaseLogContext {
	service?: string;
	component?: string;
	environment?: string;
	version?: string;
	instanceId?: string;
}

export interface TraceContext {
	correlationId?: string;
	traceId?: string;
	spanId?: string;
	requestId?: string;
}

export interface TenantContext {
	tenantId?: string;
	campaignId?: string;
	adminUserId?: string;
	externalUserId?: string;
}

export interface NodeLoggerOptions {
	/** Service name for all logs */
	service: string;
	/** Log level (default: 'info') */
	level?: LogLevel;
	/** Environment name */
	environment?: string;
	/** Service version */
	version?: string;
	/** Enable pretty printing (default: based on NODE_ENV) */
	pretty?: boolean;
	/** Additional redaction paths */
	redactPaths?: readonly string[];
	/** Base context to include in all logs */
	base?: Record<string, unknown>;
	/** Custom Pino options */
	pinoOptions?: Partial<PinoOptions>;
}

export interface BrowserLoggerOptions {
	/** Service name for all logs */
	service: string;
	/** Log level (default: 'info' in prod, 'debug' in dev) */
	level?: LogLevel;
	/** Environment name */
	environment?: string;
	/** Whether to forward logs to backend (default: true) */
	forwardToBackend?: boolean;
	/** Backend log endpoint */
	logEndpoint?: string;
	/** Batch size before sending (default: 10) */
	batchSize?: number;
	/** Flush interval in ms (default: 5000) */
	flushInterval?: number;
}

export type Logger = PinoLogger;
