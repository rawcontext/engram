// Main exports for the logging package

import pino from "pino";

export { createBrowserLogger } from "./browser";
export { childLogger, createNodeLogger, withTenantContext, withTraceContext } from "./node";
export * from "./redaction";
export * from "./types";
export { pino };

// Re-export legacy createLogger for backward compatibility during refactor (mapped to createNodeLogger)
import { createNodeLogger } from "./node";

// Shim for legacy LoggerOptions to new NodeLoggerOptions
export interface LegacyLoggerOptions {
	level?: string;
	component?: string;
}

export type LoggerOptions = LegacyLoggerOptions;

export const createLogger = (options: LegacyLoggerOptions = {}) => {
	return createNodeLogger({
		service: "soul-system", // Default service name
		level: (options.level as any) || "info",
		base: { component: options.component },
	});
};
