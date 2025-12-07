// Main exports for the logging package
export * from "./types";
export * from "./redaction";
export { createNodeLogger, childLogger, withTraceContext, withTenantContext } from "./node";
export { createBrowserLogger } from "./browser";

// Re-export legacy createLogger for backward compatibility during refactor (mapped to createNodeLogger)
import { createNodeLogger } from "./node";
import type { LoggerOptions } from "./index"; // Self-reference for legacy type? No.

// Shim for legacy LoggerOptions to new NodeLoggerOptions
export interface LegacyLoggerOptions {
	level?: string;
	component?: string;
}

export const createLogger = (options: LegacyLoggerOptions = {}) => {
	return createNodeLogger({
		service: "soul-system", // Default service name
		level: (options.level as any) || "info",
		base: { component: options.component },
	});
};
