import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mock pino before importing existing code
mock.module("pino", () => {
	const pinoMock = (options: any) => {
		const createLogger = (opts: any) => {
			return {
				level: opts.level || "info",
				info: (obj: any) => {
					const logObj = typeof obj === "string" ? { msg: obj } : obj;
					if (opts.browser?.write?.info) {
						opts.browser.write.info(logObj);
					}
				},
				bindings: () => {
					let b = opts.base || {};
					if (opts.formatters && opts.formatters.bindings) {
						// Pass existing bindings (simulated as base)
						b = opts.formatters.bindings(b);
					}
					return b;
				},
				child: (childBindings: any) => {
					// Merge bindings
					const newBase = { ...opts.base, ...childBindings };
					// Return new logger with merged options
					return createLogger({ ...opts, base: newBase });
				},
				debug: () => {},
				warn: () => {},
				error: () => {},
				fatal: () => {},
				trace: () => {},
			};
		};
		return createLogger(options);
	};
	// Emulate default export
	pinoMock.stdTimeFunctions = { isoTime: () => {} };
	return { default: pinoMock };
});

// Import after mocking
import { createBrowserLogger } from "./browser";

describe("Browser Logger", () => {
	// Mock global fetch
	const mockFetch = mock(async () => new Response("ok"));
	const originalFetch = global.fetch;
	const originalWindow = global.window;
	const originalDocument = global.document;

	beforeEach(() => {
		global.fetch = mockFetch;
		global.window = {
			addEventListener: mock(() => {}),
		} as any;
		global.document = {
			visibilityState: "visible",
		} as any;
		mockFetch.mockClear();
	});

	afterEach(() => {
		global.fetch = originalFetch;
		global.window = originalWindow;
		global.document = originalDocument;
	});

	it("should create a logger with correct base context", () => {
		const logger = createBrowserLogger({
			service: "test-browser-service",
			environment: "test",
			forwardToBackend: false,
		});

		expect(logger.bindings()).toMatchObject({
			service: "test-browser-service",
			environment: "test",
		});
	});

	it("should buffer and flush logs", async () => {
		const logger = createBrowserLogger({
			service: "test",
			forwardToBackend: true,
			batchSize: 2,
			flushInterval: 10000,
		});

		// Log 1 - buffer
		logger.info("Log 1");
		expect(mockFetch).not.toHaveBeenCalled();

		// Log 2 - trigger batch
		logger.info("Log 2");

		// Wait a microtask for the async flush call (even though mocked logic is sync, flush is async)
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockFetch).toHaveBeenCalled();
		const callArgs = mockFetch.mock.calls[0];
		expect(callArgs[0]).toBe("/api/v1/logs/client");

		const body = JSON.parse(callArgs[1].body as string);
		expect(body.logs).toHaveLength(2);
		expect(body.logs[0].msg).toBe("Log 1");
		expect(body.logs[1].msg).toBe("Log 2");
	});
});
