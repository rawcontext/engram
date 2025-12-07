import pino from "pino";
import type { Logger, BrowserLoggerOptions } from "./types";

/**
 * Create a Pino logger for browser environments.
 *
 * Features:
 * - Console output with appropriate methods
 * - Optional batched forwarding to backend
 * - Respects log level
 * - Debug only in development
 */
export function createBrowserLogger(options: BrowserLoggerOptions): Logger {
	const {
		service,
		level = typeof window !== "undefined" && process.env.NODE_ENV === "development" ? "debug" : "info",
		environment = process.env.NODE_ENV || "development",
		forwardToBackend = true,
		logEndpoint = "/api/v1/logs/client",
		batchSize = 10,
		flushInterval = 5000,
	} = options;

	let logBuffer: Array<Record<string, unknown>> = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;

	const flush = async () => {
		if (logBuffer.length === 0) return;

		const logsToSend = [...logBuffer];
		logBuffer = [];

		if (!forwardToBackend) return;

		try {
			await fetch(logEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ logs: logsToSend }),
				keepalive: true,
			});
		} catch {
			// Silently fail - don't log about logging failures
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

	// Flush on page unload
	if (typeof window !== "undefined") {
		window.addEventListener("beforeunload", () => {
			flush();
		});
		window.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				flush();
			}
		});
	}

	return logger;
}
