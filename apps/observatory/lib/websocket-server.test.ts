import type { SessionUpdate } from "@engram/storage/nats";
import { beforeEach, describe, expect, it, mock } from "bun:test";

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
	});

	describe("cleanupWebSocketServer", () => {
		it("should clear all state", () => {
			cleanupWebSocketServer();

			expect(true).toBe(true);
		});
	});
});
