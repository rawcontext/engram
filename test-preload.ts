/**
 * Root-level test preload for the entire monorepo.
 *
 * This file is loaded before any test files via bunfig.toml preload.
 * It mocks module-level singletons (NATS, FalkorDB, Logger) BEFORE test files import them,
 * solving the Bun mock.module singleton interception limitation.
 *
 * @see https://bun.sh/docs/test/mocks#preload
 */
import { mock } from "bun:test";

// =============================================================================
// FalkorDB Mocks
// =============================================================================

const mockQuery = mock();
const mockConnect = mock();
const mockIsConnected = mock();
const mockDisconnect = mock();

const mockFalkorClient = {
	query: mockQuery,
	connect: mockConnect,
	isConnected: mockIsConnected,
	disconnect: mockDisconnect,
};

mock.module("@engram/storage/falkor", () => ({
	createFalkorClient: mock(() => mockFalkorClient),
}));

// =============================================================================
// NATS Mocks
// =============================================================================

const mockSubscribe = mock(async (_channel: string, _callback: (data: unknown) => void) => {
	return mock(); // Returns unsubscribe function
});

const mockSubscribeToConsumerStatus = mock(async (_callback: (data: unknown) => void) => {
	return mock(); // Returns unsubscribe function
});

const mockNatsConnect = mock(async () => {});
const mockNatsDisconnect = mock(async () => {});

const mockNatsPubSubSubscriber = {
	connect: mockNatsConnect,
	subscribe: mockSubscribe,
	subscribeToConsumerStatus: mockSubscribeToConsumerStatus,
	disconnect: mockNatsDisconnect,
};

mock.module("@engram/storage/nats", () => ({
	createNatsPubSubSubscriber: mock(() => mockNatsPubSubSubscriber),
	createNatsPubSubPublisher: mock(() => ({
		connect: mock(async () => {}),
		publishSessionUpdate: mock(async () => {}),
		publishGlobalSessionEvent: mock(async () => {}),
		publishConsumerStatus: mock(async () => {}),
		disconnect: mock(async () => {}),
	})),
	createNatsClient: mock(() => ({
		connect: mock(async () => {}),
		disconnect: mock(async () => {}),
	})),
}));

// =============================================================================
// Logger Mocks (only exposed for packages that need it, not globally mocked)
// =============================================================================

const mockLoggerInfo = mock();
const mockLoggerWarn = mock();
const mockLoggerError = mock();
const mockLoggerDebug = mock();

// Note: Logger is NOT mocked globally because many tests have their own logger mocks.
// Only packages with module-level logger singletons (like graph/merger.ts) need preload mocking.
// Those packages should use their own bunfig.toml with a local preload.

// =============================================================================
// Export mocks for test files to access
// =============================================================================

declare global {
	var __testMocks: {
		falkor: {
			client: typeof mockFalkorClient;
			query: typeof mockQuery;
			connect: typeof mockConnect;
			isConnected: typeof mockIsConnected;
			disconnect: typeof mockDisconnect;
		};
		nats: {
			subscriber: typeof mockNatsPubSubSubscriber;
			subscribe: typeof mockSubscribe;
			subscribeToConsumerStatus: typeof mockSubscribeToConsumerStatus;
			connect: typeof mockNatsConnect;
			disconnect: typeof mockNatsDisconnect;
		};
		logger: {
			info: typeof mockLoggerInfo;
			warn: typeof mockLoggerWarn;
			error: typeof mockLoggerError;
			debug: typeof mockLoggerDebug;
		};
	};
}

globalThis.__testMocks = {
	falkor: {
		client: mockFalkorClient,
		query: mockQuery,
		connect: mockConnect,
		isConnected: mockIsConnected,
		disconnect: mockDisconnect,
	},
	nats: {
		subscriber: mockNatsPubSubSubscriber,
		subscribe: mockSubscribe,
		subscribeToConsumerStatus: mockSubscribeToConsumerStatus,
		connect: mockNatsConnect,
		disconnect: mockNatsDisconnect,
	},
	logger: {
		info: mockLoggerInfo,
		warn: mockLoggerWarn,
		error: mockLoggerError,
		debug: mockLoggerDebug,
	},
};
