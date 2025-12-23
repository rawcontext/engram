/**
 * Test preload file for graph package.
 *
 * This file is loaded before any test files via bunfig.toml preload.
 * It mocks module-level singletons (logger) BEFORE test files import them,
 * solving the Bun mock.module singleton interception limitation.
 *
 * @see https://bun.sh/docs/test/mocks#preload
 */
import { mock } from "bun:test";

// =============================================================================
// Logger Mocks
// =============================================================================

const mockLoggerInfo = mock();
const mockLoggerWarn = mock();
const mockLoggerError = mock();
const mockLoggerDebug = mock();

const mockLogger = {
	info: mockLoggerInfo,
	warn: mockLoggerWarn,
	error: mockLoggerError,
	debug: mockLoggerDebug,
};

mock.module("@engram/logger", () => ({
	createNodeLogger: mock(() => mockLogger),
}));

// =============================================================================
// Export mocks for test files to access
// =============================================================================

declare global {
	var __testMocks: {
		logger: {
			info: typeof mockLoggerInfo;
			warn: typeof mockLoggerWarn;
			error: typeof mockLoggerError;
			debug: typeof mockLoggerDebug;
		};
	};
}

globalThis.__testMocks = {
	logger: {
		info: mockLoggerInfo,
		warn: mockLoggerWarn,
		error: mockLoggerError,
		debug: mockLoggerDebug,
	},
};
