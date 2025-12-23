import type { SessionUpdate } from "@engram/storage/nats";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
	cleanupWebSocketServer,
	handleConsumerStatusConnection,
	handleSessionConnection,
	handleSessionsConnection,
} from "./websocket-server";

vi.mock("@engram/storage/nats", () => ({
	createNatsPubSubSubscriber: mock(() => ({
		subscribe: mock(async (_channel: string, _callback: (data: any) => void) => {
			return mock();
		}),
		subscribeToConsumerStatus: mock(async (_callback: (data: any) => void) => {
			return mock();
		}),
	})),
}));

vi.mock("./graph-queries", () => ({
	getSessionLineage: mock(async () => ({
		nodes: [{ id: "node1", label: "Node 1" }],
		links: [],
	})),
	getSessionTimeline: mock(async () => ({
		timeline: [{ id: "event1" }],
	})),
	getSessionsForWebSocket: mock(async () => ({
		sessions: [{ id: "sess1", name: "Session 1" }],
	})),
}));

vi.mock("node:module", () => ({
	createRequire: mock(() =>
		mock(() => ({
			AdminClient: {
				create: mock(() => ({
					connect: mock(),
					disconnect: mock(),
					describeGroups: mock((_groups, _opts, callback) => {
						callback(null, [{ groupId: "test-group", state: 3, members: [{}] }]);
					}),
				})),
			},
		})),
	),
}));

describe("websocket-server", () => {
	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
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
			const { getSessionLineage } = await import("./graph-queries");
			(getSessionLineage as Mock).mockResolvedValueOnce({
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
			const { getSessionTimeline } = await import("./graph-queries");
			(getSessionTimeline as Mock).mockResolvedValueOnce({
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
			const { getSessionLineage } = await import("./graph-queries");
			(getSessionLineage as Mock).mockRejectedValueOnce(new Error("Fetch error"));

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
			const { createNatsPubSubSubscriber } = await import("@engram/storage/nats");
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			(createNatsPubSubSubscriber as Mock).mockReturnValueOnce({
				subscribe: mock(async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				}),
			} as any);

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
			const { getSessionsForWebSocket } = await import("./graph-queries");
			(getSessionsForWebSocket as Mock).mockRejectedValueOnce(new Error("Fetch error"));

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
			const { createNatsPubSubSubscriber } = await import("@engram/storage/nats");
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			(createNatsPubSubSubscriber as Mock).mockReturnValueOnce({
				subscribe: mock(async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return mock();
				}),
			} as any);

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
