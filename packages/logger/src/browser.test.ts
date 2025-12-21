import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock pino before importing existing code
vi.mock("pino", () => {
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
					if (opts.formatters?.bindings) {
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

/**
 * Minimal Window interface for testing browser logger.
 */
interface MockWindow {
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
}

/**
 * Minimal Document interface for testing browser logger.
 */
interface MockDocument {
	visibilityState: string;
}

describe("Browser Logger", () => {
	// Mock global fetch
	let mockFetch: ReturnType<typeof vi.spyOn>;
	const originalFetch = global.fetch;
	const originalWindow = global.window;
	const originalDocument = global.document;

	beforeEach(() => {
		mockFetch = vi.spyOn(global, "fetch").mockImplementation(async () => new Response("ok"));
		global.window = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		} as unknown as typeof global.window;
		global.document = {
			visibilityState: "visible",
		} as unknown as typeof global.document;
	});

	afterEach(() => {
		mockFetch.mockRestore();
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

		const body = JSON.parse((callArgs[1] as { body: string }).body);
		expect(body.logs).toHaveLength(2);
		expect(body.logs[0].msg).toBe("Log 1");
		expect(body.logs[1].msg).toBe("Log 2");
	});

	describe("destroy()", () => {
		it("should have destroy method", () => {
			const logger = createBrowserLogger({
				service: "test",
				forwardToBackend: false,
			});

			expect(typeof logger.destroy).toBe("function");
		});

		it("should flush remaining logs on destroy", async () => {
			const logger = createBrowserLogger({
				service: "test",
				forwardToBackend: true,
				batchSize: 10, // High batch size so auto-flush doesn't trigger
				flushInterval: 10000,
			});

			// Log without triggering batch
			logger.info("Final log");

			// Destroy should flush
			logger.destroy();

			// Wait for async flush
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockFetch).toHaveBeenCalled();
		});

		it("should be idempotent (safe to call multiple times)", () => {
			const logger = createBrowserLogger({
				service: "test",
				forwardToBackend: false,
			});

			// Should not throw when called multiple times
			expect(() => {
				logger.destroy();
				logger.destroy();
				logger.destroy();
			}).not.toThrow();
		});

		it("should remove event listeners on destroy", () => {
			const removeEventListenerSpy = vi.fn();
			const addEventListenerSpy = vi.fn();

			global.window = {
				addEventListener: addEventListenerSpy,
				removeEventListener: removeEventListenerSpy,
			} as unknown as typeof global.window;

			const logger = createBrowserLogger({
				service: "test",
				forwardToBackend: false,
			});

			// Should have added listeners
			expect(addEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
			expect(addEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

			// Destroy
			logger.destroy();

			// Should have removed listeners
			expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
			expect(removeEventListenerSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
		});

		it("should not process new logs after destroy", async () => {
			const logger = createBrowserLogger({
				service: "test",
				forwardToBackend: true,
				batchSize: 10, // High batch size so we can count logs
				flushInterval: 10000,
			});

			// Log one message, then destroy
			logger.info("Before destroy");
			logger.destroy();

			// Wait for destroy's flush
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Get the call count from destroy flush
			const callCountAfterDestroy = mockFetch.mock.calls.length;

			// Try to log after destroy
			logger.info("After destroy 1");
			logger.info("After destroy 2");

			// Wait for any potential async operations
			await new Promise((resolve) => setTimeout(resolve, 10));

			// The call count should not have increased (destroy flag prevents further processing)
			expect(mockFetch.mock.calls.length).toBe(callCountAfterDestroy);
		});
	});
});
