/**
 * Test preload file for Observatory.
 *
 * This file is loaded before any test files via bunfig.toml preload.
 * It mocks module-level singletons (NATS, FalkorDB, pg) BEFORE test files import them,
 * solving the Bun mock.module singleton interception limitation.
 *
 * @see https://bun.sh/docs/test/mocks#preload
 */
import { mock } from "bun:test";

// =============================================================================
// PostgreSQL Mocks (for OAuth tests)
// =============================================================================

// Mock pg Pool for ESM compatibility
// The pg package doesn't export Pool from its ESM entry point, so we mock it here
const mockPgQuery = mock(async () => ({ rows: [] }));

mock.module("pg", () => ({
	Pool: class MockPool {
		query = mockPgQuery;
	},
	default: {
		Pool: class MockPool {
			query = mockPgQuery;
		},
	},
}));

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
// Export mocks for test files to access
// =============================================================================

// Expose mocks globally so test files can configure and assert on them
declare global {
	var __testMocks: {
		pg: {
			query: typeof mockPgQuery;
		};
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
	};
}

globalThis.__testMocks = {
	pg: {
		query: mockPgQuery,
	},
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
};
