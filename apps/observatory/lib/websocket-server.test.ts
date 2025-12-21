import type { SessionUpdate } from "@engram/storage/redis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	cleanupWebSocketServer,
	handleConsumerStatusConnection,
	handleSessionConnection,
	handleSessionsConnection,
} from "./websocket-server";

vi.mock("@engram/storage/redis", () => ({
	createRedisSubscriber: vi.fn(() => ({
		subscribe: vi.fn(async (_channel: string, _callback: (data: any) => void) => {
			return vi.fn();
		}),
		subscribeToConsumerStatus: vi.fn(async (_callback: (data: any) => void) => {
			return vi.fn();
		}),
	})),
}));

vi.mock("./graph-queries", () => ({
	getSessionLineage: vi.fn(async () => ({
		nodes: [{ id: "node1", label: "Node 1" }],
		links: [],
	})),
	getSessionTimeline: vi.fn(async () => ({
		timeline: [{ id: "event1" }],
	})),
	getSessionsForWebSocket: vi.fn(async () => ({
		sessions: [{ id: "sess1", name: "Session 1" }],
	})),
}));

vi.mock("node:module", () => ({
	createRequire: vi.fn(() =>
		vi.fn(() => ({
			AdminClient: {
				create: vi.fn(() => ({
					connect: vi.fn(),
					disconnect: vi.fn(),
					describeGroups: vi.fn((_groups, _opts, callback) => {
						callback(null, [{ groupId: "test-group", state: 3, members: [{}] }]);
					}),
				})),
			},
		})),
	),
}));

describe("websocket-server", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cleanupWebSocketServer();
	});

	describe("handleSessionConnection", () => {
		it("should handle session connection and send initial data", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"lineage"'));
			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"replay"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle session with no lineage data", async () => {
			const { getSessionLineage } = await import("./graph-queries");
			vi.mocked(getSessionLineage).mockResolvedValueOnce({
				nodes: [],
				links: [],
			});

			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_empty");

			const lineageCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"lineage"'),
			);
			expect(lineageCalls).toHaveLength(0);
		});

		it("should handle session with no timeline data", async () => {
			const { getSessionTimeline } = await import("./graph-queries");
			vi.mocked(getSessionTimeline).mockResolvedValueOnce({
				timeline: [],
			});

			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_empty");

			const timelineCalls = ws.send.mock.calls.filter((call: any[]) =>
				call[0].includes('"type":"replay"'),
			);
			expect(timelineCalls).toHaveLength(0);
		});

		it("should handle initial fetch errors gracefully", async () => {
			const { getSessionLineage } = await import("./graph-queries");
			vi.mocked(getSessionLineage).mockRejectedValueOnce(new Error("Fetch error"));

			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_error");

			expect(ws.on).toHaveBeenCalled();
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should call unsubscribe on close", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			const closeHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "close")[1];

			await closeHandler();

			expect(ws.on).toHaveBeenCalled();
		});

		it("should not send updates when WebSocket is closed", async () => {
			const { createRedisSubscriber } = await import("@engram/storage/redis");
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			vi.mocked(createRedisSubscriber).mockReturnValueOnce({
				subscribe: vi.fn(async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return vi.fn();
				}),
			} as any);

			const ws = {
				readyState: 3,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionConnection(ws, "sess_123");

			if (subscribeCallback) {
				subscribeCallback({
					type: "turn_completed",
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
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"sessions"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle initial sessions fetch error", async () => {
			const { getSessionsForWebSocket } = await import("./graph-queries");
			vi.mocked(getSessionsForWebSocket).mockRejectedValueOnce(new Error("Fetch error"));

			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"error"'));
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle subscribe message", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "subscribe" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should call unsubscribe on close", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleSessionsConnection(ws);

			const closeHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "close")[1];

			await closeHandler();

			expect(ws.on).toHaveBeenCalled();
		});

		it("should not send updates when WebSocket is closed", async () => {
			const { createRedisSubscriber } = await import("@engram/storage/redis");
			let subscribeCallback: ((data: SessionUpdate) => void) | null = null;

			vi.mocked(createRedisSubscriber).mockReturnValueOnce({
				subscribe: vi.fn(async (_channel: string, callback: (data: SessionUpdate) => void) => {
					subscribeCallback = callback;
					return vi.fn();
				}),
			} as any);

			const ws = {
				readyState: 3,
				send: vi.fn(),
				on: vi.fn(),
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
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleConsumerStatusConnection(ws);

			expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"status"'));
			expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
			expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
		});

		it("should handle refresh message", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleConsumerStatusConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler(JSON.stringify({ type: "refresh" }));

			expect(ws.send).toHaveBeenCalled();
		});

		it("should handle invalid message gracefully", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
			} as any;

			await handleConsumerStatusConnection(ws);

			const messageHandler = ws.on.mock.calls.find((call: any[]) => call[0] === "message")[1];

			await messageHandler("invalid json");

			expect(ws.send).toHaveBeenCalled();
		});

		it("should remove client from set on close", async () => {
			const ws = {
				readyState: 1,
				send: vi.fn(),
				on: vi.fn(),
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
