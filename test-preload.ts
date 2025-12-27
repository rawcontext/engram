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

const mockQuery = mock(async () => []);
const mockConnect = mock(async () => {});
const mockIsConnected = mock(() => false);
const mockDisconnect = mock(async () => {});

const mockFalkorClient = {
	query: mockQuery,
	connect: mockConnect,
	isConnected: mockIsConnected,
	disconnect: mockDisconnect,
};

// Mock FalkorClient class that implements GraphClient interface
class MockFalkorClient {
	query = mockQuery;
	connect = mockConnect;
	isConnected = mockIsConnected;
	disconnect = mockDisconnect;
}

// Create singleton factory mocks that ALWAYS return the same object
const createFalkorClientMock = Object.assign(() => mockFalkorClient, {
	mock: { calls: [] as unknown[][] },
	mockClear: () => {
		createFalkorClientMock.mock.calls = [];
	},
});

mock.module("@engram/storage/falkor", () => ({
	createFalkorClient: createFalkorClientMock,
	FalkorClient: MockFalkorClient,
}));

// Also mock blob store
const mockBlobStore = {
	save: mock(async () => "blob://test"),
	load: mock(async () => Buffer.from("{}")),
	exists: mock(async () => false),
};

// Create a mock NATS client for @engram/storage
const mockNatsClientInstance = {
	getConsumer: mock(async () => ({
		subscribe: mock(async () => {}),
		run: mock(async () => {}),
		disconnect: mock(async () => {}),
	})),
	getProducer: mock(async () => ({
		send: mock(async () => {}),
		disconnect: mock(async () => {}),
	})),
	sendEvent: mock(async () => {}),
	connect: mock(async () => {}),
	disconnect: mock(async () => {}),
};

// Mock NatsClient class
class MockNatsClient {
	getConsumer = mock(async () => ({
		subscribe: mock(async () => {}),
		run: mock(async () => {}),
		disconnect: mock(async () => {}),
	}));
	getProducer = mock(async () => ({
		send: mock(async () => {}),
		disconnect: mock(async () => {}),
	}));
	sendEvent = mock(async () => {});
	connect = mock(async () => {});
	disconnect = mock(async () => {});
}

// Create singleton factory mocks for main @engram/storage entry point
const createNatsClientMock = Object.assign(() => mockNatsClientInstance, {
	mock: { calls: [] as unknown[][] },
	mockClear: () => {
		createNatsClientMock.mock.calls = [];
	},
});

const createBlobStoreMock = Object.assign(() => mockBlobStore, {
	mock: { calls: [] as unknown[][] },
	mockClear: () => {
		createBlobStoreMock.mock.calls = [];
	},
});

// Mock the main @engram/storage entry point (re-exports)
mock.module("@engram/storage", () => ({
	createFalkorClient: createFalkorClientMock,
	FalkorClient: MockFalkorClient,
	createBlobStore: createBlobStoreMock,
	createNatsClient: createNatsClientMock,
	NatsClient: MockNatsClient,
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
	createNatsClient: mock(() => mockNatsClientInstance),
	NatsClient: MockNatsClient,
}));

// =============================================================================
// Logger Mocks
// =============================================================================

const mockLoggerInfo = mock();
const mockLoggerWarn = mock();
const mockLoggerError = mock();
const mockLoggerDebug = mock();
const mockLoggerTrace = mock();
const mockLoggerFatal = mock();

const mockLogger = {
	info: mockLoggerInfo,
	warn: mockLoggerWarn,
	error: mockLoggerError,
	debug: mockLoggerDebug,
	trace: mockLoggerTrace,
	fatal: mockLoggerFatal,
};

mock.module("@engram/logger", () => ({
	createNodeLogger: mock(() => mockLogger),
	pino: {
		destination: mock((_fd: number) => ({ write: mock() })),
	},
	withTraceContext: mock((logger: unknown, _context: unknown) => logger),
}));

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
			instance: typeof mockLogger;
			info: typeof mockLoggerInfo;
			warn: typeof mockLoggerWarn;
			error: typeof mockLoggerError;
			debug: typeof mockLoggerDebug;
			trace: typeof mockLoggerTrace;
			fatal: typeof mockLoggerFatal;
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
		instance: mockLogger,
		info: mockLoggerInfo,
		warn: mockLoggerWarn,
		error: mockLoggerError,
		debug: mockLoggerDebug,
		trace: mockLoggerTrace,
		fatal: mockLoggerFatal,
	},
};
