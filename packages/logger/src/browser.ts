import pino from "pino";
import type { BrowserLoggerOptions, Logger } from "./types";

/**
 * Extended Logger interface with cleanup method for browser environments.
 */
export interface BrowserLogger extends Logger {
	/** Clean up resources (event listeners, timers). Call before unmounting. */
	destroy: () => void;
}

/**
 * Create a Pino logger for browser environments.
 *
 * Features:
 * - Console output with appropriate methods
 * - Optional batched forwarding to backend
 * - Respects log level
 * - Debug only in development
 * - destroy() method to clean up event listeners and timers
 */
export function createBrowserLogger(options: BrowserLoggerOptions): BrowserLogger {
	const {
		service,
		level = typeof window !== "undefined" && process.env.NODE_ENV === "development"
			? "debug"
			: "info",
		environment = process.env.NODE_ENV || "development",
		forwardToBackend = true,
		logEndpoint = "/api/v1/logs/client",
		batchSize = 10,
		flushInterval = 5000,
		onFlushError,
	} = options;

	let logBuffer: Array<Record<string, unknown>> = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	const flush = async () => {
		if (logBuffer.length === 0) return;

		const logsToSend = [...logBuffer];
		logBuffer = [];

		if (!forwardToBackend) return;

		try {
			const response = await fetch(logEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ logs: logsToSend }),
				keepalive: true,
			});

			if (!response.ok) {
				const error = new Error(`Log flush failed: ${response.status} ${response.statusText}`);
				if (onFlushError) {
					onFlushError(error, logsToSend);
				}
			}
		} catch (e) {
			// Call error callback if provided, otherwise silent (can't log about logging failures)
			if (onFlushError) {
				const error = e instanceof Error ? e : new Error(String(e));
				onFlushError(error, logsToSend);
			}
		}
	};

	const scheduleFlush = () => {
		if (flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flush();
		}, flushInterval);
	};

	const addToBuffer = (logObject: Record<string, unknown>) => {
		logBuffer.push(logObject);
		if (logBuffer.length >= batchSize) {
			flush();
		} else {
			scheduleFlush();
		}
	};

	// Custom browser transport using pino's browser option
	const logger = pino({
		level,
		browser: {
			asObject: true,
			write: {
				trace: (o) => {
					console.debug(o);
					addToBuffer(o as Record<string, unknown>);
				},
				debug: (o) => {
					console.debug(o);
					addToBuffer(o as Record<string, unknown>);
				},
				info: (o) => {
					console.info(o);
					addToBuffer(o as Record<string, unknown>);
				},
				warn: (o) => {
					console.warn(o);
					addToBuffer(o as Record<string, unknown>);
				},
				error: (o) => {
					console.error(o);
					addToBuffer(o as Record<string, unknown>);
				},
				fatal: (o) => {
					console.error(o);
					addToBuffer(o as Record<string, unknown>);
				},
			},
		},
		base: {
			service,
			environment,
		},
	});

	// Event handlers for cleanup tracking
	const handleBeforeUnload = () => {
		if (!destroyed) flush();
	};
	const handleVisibilityChange = () => {
		if (!destroyed && document.visibilityState === "hidden") {
			flush();
		}
	};

	// Flush on page unload
	if (typeof window !== "undefined") {
		window.addEventListener("beforeunload", handleBeforeUnload);
		window.addEventListener("visibilitychange", handleVisibilityChange);
	}

	// Destroy method to clean up resources
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;

		// Clear flush timer
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}

		// Flush remaining logs
		flush();

		// Remove event listeners
		if (typeof window !== "undefined") {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			window.removeEventListener("visibilitychange", handleVisibilityChange);
		}

		// Clear buffer
		logBuffer = [];
	};

	// Attach destroy method to logger
	const browserLogger = logger as BrowserLogger;
	browserLogger.destroy = destroy;

	return browserLogger;
}
