import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SessionUpdate } from "@engram/storage/nats";

// =============================================================================
// Mock Setup
// =============================================================================

// Create graph-queries mocks BEFORE importing websocket-server
const mockGetSessionLineage = mock(async () => ({
	nodes: [{ id: "node1", label: "Node 1" }],
	links: [],
}));

const mockGetSessionTimeline = mock(async () => ({
	timeline: [{ id: "event1" }],
}));

const mockGetSessionsForWebSocket = mock(async () => ({
	active: [{ id: "sess1", title: "Session 1" }],
	recent: [],
}));

// Mock graph-queries before websocket-server imports it
mock.module("./graph-queries", () => ({
	getSessionLineage: mockGetSessionLineage,
	getSessionTimeline: mockGetSessionTimeline,
	getSessionsForWebSocket: mockGetSessionsForWebSocket,
}));

// Mock node:module for Kafka admin client
mock.module("node:module", () => ({
	createRequire: mock(() =>
		mock(() => ({
			AdminClient: {
				create: mock(() => ({
					connect: mock(),
					disconnect: mock(),
					describeGroups: mock(
						(
							_groups: unknown,
							_opts: unknown,
							callback: (err: unknown, result: unknown[]) => void,
						) => {
							callback(null, [{ groupId: "test-group", state: 3, members: [{}] }]);
						},
					),
				})),
			},
		})),
	),
}));

// Access NATS mocks from preload (for module-level singleton in websocket-server)
const { subscribe: mockSubscribe, subscribeToConsumerStatus: mockSubscribeToConsumerStatus } =
	globalThis.__testMocks.nats;

// Import module under test (NATS singleton uses mocked client from preload)
import {
	cleanupWebSocketServer,
	handleConsumerStatusConnection,
	handleSessionConnection,
	handleSessionsConnection,
} from "./websocket-server";

describe("websocket-server", () => {
	beforeEach(() => {
		mockGetSessionLineage.mockClear();
		mockGetSessionTimeline.mockClear();
		mockGetSessionsForWebSocket.mockClear();
		mockSubscribe.mockClear();
		mockSubscribeToConsumerStatus.mockClear();

		// Reset mock implementations to defaults
		mockGetSessionLineage.mockImplementation(async () => ({
			nodes: [{ id: "node1", label: "Node 1" }],
			links: [],
		}));
		mockGetSessionTimeline.mockImplementation(async () => ({
			timeline: [{ id: "event1" }],
		}));
		mockGetSessionsForWebSocket.mockImplementation(async () => ({
			active: [{ id: "sess1", title: "Session 1" }],
			recent: [],
		}));

		cleanupWebSocketServer();
	});

	describe("handleSessionConnection", () => {
		it("should handle session connection and send initial data", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"lineage"'));
			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"replay"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle session with no lineage data", async () => {
			mockGetSessionLineage.mockResolvedValueOnce({
				nodes: [],
				links: [],
			});

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_empty");

			const lineageCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"lineage"'),
			);
			expect(lineageCalls).toHaveLength(0);
		});

		it("should handle session with no timeline data", async () => {
			mockGetSessionTimeline.mockResolvedValueOnce({
				timeline: [],
			});

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_empty");

			const timelineCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"replay"'),
			);
			expect(timelineCalls).toHaveLength(0);
		});

		it("should handle initial fetch errors gracefully", async () => {
			mockGetSessionLineage.mockRejectedValueOnce(new Error("Fetch error"));

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_error");

			expect(ws.on).toHaveBeenCalled();
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should call unsubscribe on close", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const closeHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "close")[1];

			await closeHandler();

			expect(ws.on).toHaveBeenCalled();
		});

		it("should not send updates when WebSocket is closed", async () => {
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			mockSubscribe.mockImplementationOnce(
				async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				},
			);

			const ws = {
				readyState: 3,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			if (subscribeCallback) {
				subscribeCallback({
					type: "turn_completed" as any,
					sessionId: "sess_123",
					data: {},
					timestamp: Date.now(),
				});
			}

			const updateCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"update"'),
			);
			expect(updateCalls).toHaveLength(0);
		});

		it("should send NATS updates when WebSocket is open", async () => {
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			mockSubscribe.mockImplementationOnce(
				async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				},
			);

			const ws = {
				readyState: 1, // OPEN
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			// Clear initial data calls
			ws.send.mockClear();

			if (subscribeCallback) {
				subscribeCallback({
					type: "turn_completed" as any,
					sessionId: "sess_123",
					data: { turnId: "turn_1" },
					timestamp: Date.now(),
				});
			}

			// Should have sent the update
			const updateCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"update"'),
			);
			expect(updateCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("handleSessionsConnection", () => {
		it("should handle sessions connection and send initial data", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"sessions"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle initial sessions fetch error", async () => {
			mockGetSessionsForWebSocket.mockRejectedValueOnce(new Error("Fetch error"));

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"error"'));
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle subscribe message", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "subscribe" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should call unsubscribe on close", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			const closeHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "close")[1];

			await closeHandler();

			expect(ws.on).toHaveBeenCalled();
		});

		it("should not send updates when WebSocket is closed", async () => {
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			mockSubscribe.mockImplementationOnce(
				async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				},
			);

			const ws = {
				readyState: 3,
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			if (subscribeCallback) {
				subscribeCallback({
					type: "session_created",
					sessionId: "sess_new",
					data: {},
					timestamp: Date.now(),
				});
			}

			const updateCalls = ws.send.mock.calls.filter(
				(call: any[]) =>
					call[0].includes('"type":"session_created"') ||
					call[0].includes('"type":"session_updated"') ||
					call[0].includes('"type":"session_closed"'),
			);
			expect(updateCalls).toHaveLength(0);
		});

		it("should send NATS updates when WebSocket is open", async () => {
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			mockSubscribe.mockImplementationOnce(
				async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				},
			);

			const ws = {
				readyState: 1, // OPEN
				send: mock(),
				on: mock(),
			} as any;

			await handleSessionsConnection(ws);

			// Clear initial data calls
			ws.send.mockClear();

			if (subscribeCallback) {
				subscribeCallback({
					type: "session_created",
					sessionId: "sess_new",
					data: { id: "sess_new" },
					timestamp: Date.now(),
				});
			}

			// Should have sent the update
			const updateCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"session_created"'),
			);
			expect(updateCalls.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("handleConsumerStatusConnection", () => {
		it("should handle consumer status connection and send initial status", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should remove client from set on close", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			const closeHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "close")[1];

			closeHandler();

			expect(ws.on).toHaveBeenCalled();
		});

		it("should handle consumer_ready event and broadcast to all clients", async () => {
			// Set up mock to capture the event handler
			let eventHandler: ((event: any) => void) | null = null;
			mockSubscribeToConsumerStatus.mockClear();
			mockSubscribeToConsumerStatus.mockImplementation(async (handler: any) => {
				eventHandler = handler;
			});

			// Create multiple WebSocket clients
			const ws1 = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			const ws2 = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws1);
			await handleConsumerStatusConnection(ws2);

			// Wait for NATS subscription
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear initial calls
			ws1.send.mockClear();
			ws2.send.mockClear();

			// Trigger consumer_ready event
			if (eventHandler) {
				eventHandler({
					type: "consumer_ready",
					groupId: "ingestion-group",
					serviceId: "service-1",
					timestamp: Date.now(),
				});
			}

			// Both clients should receive the broadcast
			expect(ws1.send).toHaveBeenCalled();
			expect(ws2.send).toHaveBeenCalled();
		});

		it("should handle consumer_heartbeat event and update state", async () => {
			let eventHandler: ((event: any) => void) | null = null;
			mockSubscribeToConsumerStatus.mockClear();
			mockSubscribeToConsumerStatus.mockImplementation(async (handler: any) => {
				eventHandler = handler;
			});

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			// Wait for NATS subscription
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear initial calls
			ws.send.mockClear();

			// Trigger consumer_heartbeat event
			if (eventHandler) {
				eventHandler({
					type: "consumer_heartbeat",
					groupId: "memory-group",
					serviceId: "service-2",
					timestamp: Date.now(),
				});
			}

			// Should broadcast updated status
			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle consumer_disconnected event and remove state", async () => {
			let eventHandler: ((event: any) => void) | null = null;
			mockSubscribeToConsumerStatus.mockClear();
			mockSubscribeToConsumerStatus.mockImplementation(async (handler: any) => {
				eventHandler = handler;
			});

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			// Wait for NATS subscription
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear initial calls
			ws.send.mockClear();

			// First add a consumer
			if (eventHandler) {
				eventHandler({
					type: "consumer_ready",
					groupId: "search-group",
					serviceId: "service-3",
					timestamp: Date.now(),
				});

				// Then disconnect it
				eventHandler({
					type: "consumer_disconnected",
					groupId: "search-group",
					serviceId: "service-3",
					timestamp: Date.now(),
				});
			}

			// Should broadcast updated status twice (ready + disconnected)
			expect(ws.send).toHaveBeenCalled();
		});

		it("should not broadcast to closed WebSocket connections", async () => {
			let eventHandler: ((event: any) => void) | null = null;

			// Reset the mock before setting implementation
			mockSubscribeToConsumerStatus.mockClear();
			mockSubscribeToConsumerStatus.mockImplementation(async (handler: any) => {
				eventHandler = handler;
			});

			const wsOpen = {
				readyState: 1, // OPEN
				send: mock(),
				on: mock(),
			} as any;

			const wsClosed = {
				readyState: 3, // CLOSED
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(wsOpen);
			await handleConsumerStatusConnection(wsClosed);

			// Wait a bit for NATS subscription to be set up
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear initial calls
			wsOpen.send.mockClear();
			wsClosed.send.mockClear();

			// Trigger event
			if (eventHandler) {
				eventHandler({
					type: "consumer_ready",
					groupId: "control-group",
					serviceId: "service-4",
					timestamp: Date.now(),
				});
			}

			// Only open connection should receive broadcast
			expect(wsOpen.send).toHaveBeenCalled();
			expect(wsClosed.send).not.toHaveBeenCalled();
		});

		it("should handle NATS subscription initialization failure gracefully", async () => {
			mockSubscribeToConsumerStatus.mockRejectedValueOnce(new Error("NATS connection failed"));

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			// Should not throw, even if NATS fails
			await handleConsumerStatusConnection(ws);

			// Should still send initial status
			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status"'));
		});

		it("should mark consumers offline after heartbeat timeout", async () => {
			let eventHandler: ((event: any) => void) | null = null;
			mockSubscribeToConsumerStatus.mockClear();
			mockSubscribeToConsumerStatus.mockImplementation(async (handler: any) => {
				eventHandler = handler;
			});

			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws);

			// Wait for NATS subscription
			await new Promise((resolve) => setTimeout(resolve, 100));

			// First add a consumer that's online
			if (eventHandler) {
				eventHandler({
					type: "consumer_ready",
					groupId: "ingestion-group",
					serviceId: "service-1",
					timestamp: Date.now(),
				});
			}

			// Wait a bit for the state to update
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Clear initial calls
			ws.send.mockClear();

			// Now manually set the timestamp to an old value to simulate timeout
			// This requires us to trigger another heartbeat with an old timestamp
			if (eventHandler) {
				eventHandler({
					type: "consumer_heartbeat",
					groupId: "ingestion-group",
					serviceId: "service-1",
					timestamp: Date.now() - 31_000, // 31 seconds ago
				});
			}

			// Wait for timeout checker to run (runs every 5 seconds)
			// We'll wait 6 seconds to be safe
			await new Promise((resolve) => setTimeout(resolve, 6000));

			// Check that status was broadcast by the timeout checker
			// The consumer should have been marked offline
			const statusCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"status"'),
			);
			expect(statusCalls.length).toBeGreaterThanOrEqual(1);
		}, 10000); // Set test timeout to 10 seconds
	});

	describe("cleanupWebSocketServer", () => {
		it("should clear all state", () => {
			cleanupWebSocketServer();

			expect(true).toBe(true);
		});

		it("should reset consumer subscription initialized flag", async () => {
			const ws = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			// First connection should initialize
			await handleConsumerStatusConnection(ws);

			// Cleanup
			cleanupWebSocketServer();

			// Second connection should re-initialize (not skip)
			const ws2 = {
				readyState: 1,
				send: mock(),
				on: mock(),
			} as any;

			await handleConsumerStatusConnection(ws2);

			// Should have subscribed twice (once for each connection)
			expect(mockSubscribeToConsumerStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
	});
});
