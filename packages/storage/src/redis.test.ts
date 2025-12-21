import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the redis module before importing the code under test
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockSubscribe = vi.fn().mockResolvedValue(undefined);
const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();

let mockIsOpen = false;

vi.mock("redis", () => ({
	createClient: vi.fn(() => ({
		connect: mockConnect,
		quit: mockQuit,
		publish: mockPublish,
		subscribe: mockSubscribe,
		unsubscribe: mockUnsubscribe,
		on: mockOn,
		get isOpen() {
			return mockIsOpen;
		},
	})),
}));

import { createRedisPublisher, createRedisSubscriber, type SessionUpdate } from "./redis";

describe("Redis Storage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsOpen = false;
		process.env.REDIS_URL = "redis://localhost:6379";
	});

	afterEach(() => {
		delete process.env.REDIS_URL;
	});

	describe("createRedisPublisher", () => {
		describe("connect", () => {
			it("should connect to Redis successfully", async () => {
				const publisher = createRedisPublisher();

				await publisher.connect();

				expect(mockConnect).toHaveBeenCalledTimes(1);
				expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
			});

			it("should reuse existing connection if already open", async () => {
				const publisher = createRedisPublisher();

				// First connect
				await publisher.connect();
				mockIsOpen = true;

				// Second connect should reuse
				await publisher.connect();

				expect(mockConnect).toHaveBeenCalledTimes(1);
			});

			it("should wait for existing connection attempt if connecting", async () => {
				const publisher = createRedisPublisher();

				// Slow down the connect to simulate in-progress connection
				mockConnect.mockImplementationOnce(async () => {
					await new Promise((r) => setTimeout(r, 100));
					mockIsOpen = true;
				});

				// Start two concurrent connections
				const p1 = publisher.connect();
				const p2 = publisher.connect();

				await Promise.all([p1, p2]);

				// Only one actual connect call should be made
				expect(mockConnect).toHaveBeenCalledTimes(1);
			});

			it("should throw if REDIS_URL is not set", async () => {
				delete process.env.REDIS_URL;
				const publisher = createRedisPublisher();

				await expect(publisher.connect()).rejects.toThrow(
					"REDIS_URL environment variable is required",
				);
			});

			it("should register error handler on client", async () => {
				const publisher = createRedisPublisher();
				await publisher.connect();

				expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));

				// Simulate error callback
				const errorHandler = mockOn.mock.calls.find((call) => call[0] === "error")?.[1];
				const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

				errorHandler(new Error("Test error"));

				expect(consoleSpy).toHaveBeenCalledWith("[Redis Publisher] Error:", expect.any(Error));
				consoleSpy.mockRestore();
			});
		});

		describe("publishSessionUpdate", () => {
			it("should publish session update to correct channel", async () => {
				const publisher = createRedisPublisher();
				const sessionId = "test-session-123";
				const update = { type: "lineage" as const, data: { foo: "bar" } };

				await publisher.publishSessionUpdate(sessionId, update);

				expect(mockPublish).toHaveBeenCalledTimes(1);
				const [channel, message] = mockPublish.mock.calls[0];
				expect(channel).toBe(`session:${sessionId}:updates`);

				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("lineage");
				expect(parsed.sessionId).toBe(sessionId);
				expect(parsed.data).toEqual({ foo: "bar" });
				expect(typeof parsed.timestamp).toBe("number");
			});

			it("should connect automatically if not connected", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishSessionUpdate("session-1", {
					type: "timeline",
					data: null,
				});

				expect(mockConnect).toHaveBeenCalled();
				expect(mockPublish).toHaveBeenCalled();
			});

			it("should handle various update types", async () => {
				const publisher = createRedisPublisher();
				const types: Array<SessionUpdate["type"]> = [
					"lineage",
					"timeline",
					"node_created",
					"graph_node_created",
					"session_created",
					"session_updated",
					"session_closed",
				];

				for (const type of types) {
					await publisher.publishSessionUpdate("session", { type, data: {} });
				}

				expect(mockPublish).toHaveBeenCalledTimes(types.length);
			});

			it("should include timestamp in published message", async () => {
				const publisher = createRedisPublisher();
				const beforeTime = Date.now();

				await publisher.publishSessionUpdate("session", {
					type: "node_created",
					data: { nodeId: "123" },
				});

				const afterTime = Date.now();
				const [, message] = mockPublish.mock.calls[0];
				const parsed = JSON.parse(message);

				expect(parsed.timestamp).toBeGreaterThanOrEqual(beforeTime);
				expect(parsed.timestamp).toBeLessThanOrEqual(afterTime);
			});
		});

		describe("publishGlobalSessionEvent", () => {
			it("should publish to global sessions channel", async () => {
				const publisher = createRedisPublisher();
				const sessionData = { id: "session-1", name: "Test Session" };

				await publisher.publishGlobalSessionEvent("session_created", sessionData);

				expect(mockPublish).toHaveBeenCalledTimes(1);
				const [channel, message] = mockPublish.mock.calls[0];
				expect(channel).toBe("sessions:updates");

				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("session_created");
				expect(parsed.sessionId).toBe("");
				expect(parsed.data).toEqual(sessionData);
				expect(typeof parsed.timestamp).toBe("number");
			});

			it("should handle session_updated event type", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishGlobalSessionEvent("session_updated", { updated: true });

				const [, message] = mockPublish.mock.calls[0];
				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("session_updated");
			});

			it("should handle session_closed event type", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishGlobalSessionEvent("session_closed", { id: "closed-1" });

				const [, message] = mockPublish.mock.calls[0];
				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("session_closed");
			});
		});

		describe("publishConsumerStatus", () => {
			it("should publish consumer_ready event", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishConsumerStatus("consumer_ready", "test-group", "service-1");

				expect(mockPublish).toHaveBeenCalledTimes(1);
				const [channel, message] = mockPublish.mock.calls[0];
				expect(channel).toBe("consumers:status");

				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("consumer_ready");
				expect(parsed.groupId).toBe("test-group");
				expect(parsed.serviceId).toBe("service-1");
				expect(typeof parsed.timestamp).toBe("number");
			});

			it("should publish consumer_disconnected event", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishConsumerStatus("consumer_disconnected", "test-group", "service-2");

				const [, message] = mockPublish.mock.calls[0];
				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("consumer_disconnected");
				expect(parsed.groupId).toBe("test-group");
				expect(parsed.serviceId).toBe("service-2");
			});

			it("should publish consumer_heartbeat event", async () => {
				const publisher = createRedisPublisher();

				await publisher.publishConsumerStatus("consumer_heartbeat", "test-group", "service-3");

				const [, message] = mockPublish.mock.calls[0];
				const parsed = JSON.parse(message);
				expect(parsed.type).toBe("consumer_heartbeat");
			});
		});

		describe("disconnect", () => {
			it("should disconnect when connected", async () => {
				const publisher = createRedisPublisher();

				await publisher.connect();
				mockIsOpen = true;

				await publisher.disconnect();

				expect(mockQuit).toHaveBeenCalledTimes(1);
			});

			it("should be idempotent when not connected", async () => {
				const publisher = createRedisPublisher();

				await publisher.disconnect();
				await publisher.disconnect();

				expect(mockQuit).not.toHaveBeenCalled();
			});

			it("should be idempotent when already disconnected", async () => {
				const publisher = createRedisPublisher();

				await publisher.connect();
				mockIsOpen = true;
				await publisher.disconnect();
				mockIsOpen = false;

				await publisher.disconnect();

				expect(mockQuit).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe("createRedisSubscriber", () => {
		describe("connect", () => {
			it("should connect to Redis successfully", async () => {
				const subscriber = createRedisSubscriber();

				await subscriber.connect();

				expect(mockConnect).toHaveBeenCalledTimes(1);
				expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
			});

			it("should reuse existing connection if already open", async () => {
				const subscriber = createRedisSubscriber();

				await subscriber.connect();
				mockIsOpen = true;

				await subscriber.connect();

				expect(mockConnect).toHaveBeenCalledTimes(1);
			});

			it("should register error handler on client", async () => {
				const subscriber = createRedisSubscriber();
				await subscriber.connect();

				const errorHandler = mockOn.mock.calls.find((call) => call[0] === "error")?.[1];
				const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

				errorHandler(new Error("Subscriber error"));

				expect(consoleSpy).toHaveBeenCalledWith("[Redis Subscriber] Error:", expect.any(Error));
				consoleSpy.mockRestore();
			});
		});

		describe("subscribe", () => {
			it("should subscribe to session-specific channel", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				await subscriber.subscribe("session-123", callback);

				expect(mockSubscribe).toHaveBeenCalledWith(
					"session:session-123:updates",
					expect.any(Function),
				);
			});

			it("should subscribe to full channel name if contains colon", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				await subscriber.subscribe("sessions:updates", callback);

				expect(mockSubscribe).toHaveBeenCalledWith("sessions:updates", expect.any(Function));
			});

			it("should invoke callback when message is received", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();
				const testMessage: SessionUpdate = {
					type: "lineage",
					sessionId: "session-123",
					data: { test: true },
					timestamp: Date.now(),
				};

				// Capture the message handler
				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribe("session-123", callback);

				// Simulate receiving a message
				messageHandler?.(JSON.stringify(testMessage));

				expect(callback).toHaveBeenCalledWith(testMessage);
			});

			it("should handle multiple callbacks for same channel", async () => {
				const subscriber = createRedisSubscriber();
				const callback1 = vi.fn();
				const callback2 = vi.fn();
				const testMessage: SessionUpdate = {
					type: "timeline",
					sessionId: "session-123",
					data: null,
					timestamp: Date.now(),
				};

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribe("session-123", callback1);
				await subscriber.subscribe("session-123", callback2);

				// Should only subscribe once to the channel
				expect(mockSubscribe).toHaveBeenCalledTimes(1);

				// Both callbacks should be invoked
				messageHandler?.(JSON.stringify(testMessage));

				expect(callback1).toHaveBeenCalledWith(testMessage);
				expect(callback2).toHaveBeenCalledWith(testMessage);
			});

			it("should handle JSON parse errors gracefully", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();
				const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribe("session-123", callback);

				// Send invalid JSON
				messageHandler?.("not valid json");

				expect(callback).not.toHaveBeenCalled();
				expect(consoleSpy).toHaveBeenCalledWith(
					"[Redis Subscriber] Failed to parse message:",
					expect.any(Error),
				);
				consoleSpy.mockRestore();
			});

			it("should return unsubscribe function", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				mockSubscribe.mockImplementationOnce(() => Promise.resolve());

				const unsubscribe = await subscriber.subscribe("session-123", callback);

				expect(typeof unsubscribe).toBe("function");
			});

			it("should unsubscribe single callback without affecting others", async () => {
				const subscriber = createRedisSubscriber();
				const callback1 = vi.fn();
				const callback2 = vi.fn();

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				const unsubscribe1 = await subscriber.subscribe("session-123", callback1);
				await subscriber.subscribe("session-123", callback2);

				// Unsubscribe first callback
				await unsubscribe1();

				// Should not unsubscribe from Redis channel yet
				expect(mockUnsubscribe).not.toHaveBeenCalled();

				// Only callback2 should receive messages
				const testMessage: SessionUpdate = {
					type: "node_created",
					sessionId: "session-123",
					data: {},
					timestamp: Date.now(),
				};
				messageHandler?.(JSON.stringify(testMessage));

				expect(callback1).not.toHaveBeenCalled();
				expect(callback2).toHaveBeenCalledWith(testMessage);
			});

			it("should unsubscribe from Redis when last callback removed", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				mockSubscribe.mockImplementationOnce(() => Promise.resolve());
				mockIsOpen = true;

				const unsubscribe = await subscriber.subscribe("session-123", callback);
				await unsubscribe();

				expect(mockUnsubscribe).toHaveBeenCalledWith("session:session-123:updates");
			});
		});

		describe("disconnect", () => {
			it("should disconnect and unsubscribe from all channels", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				await subscriber.subscribe("session-1", callback);
				await subscriber.subscribe("session-2", callback);
				mockIsOpen = true;

				await subscriber.disconnect();

				expect(mockUnsubscribe).toHaveBeenCalledWith("session:session-1:updates");
				expect(mockUnsubscribe).toHaveBeenCalledWith("session:session-2:updates");
				expect(mockQuit).toHaveBeenCalledTimes(1);
			});

			it("should be idempotent when not connected", async () => {
				const subscriber = createRedisSubscriber();

				await subscriber.disconnect();

				expect(mockQuit).not.toHaveBeenCalled();
			});

			it("should clear subscriptions on disconnect", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementation((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribe("session-1", callback);
				mockIsOpen = true;

				await subscriber.disconnect();
				mockIsOpen = false;

				// Re-subscribing should require a new Redis subscription
				mockSubscribe.mockClear();
				await subscriber.subscribe("session-1", callback);

				expect(mockSubscribe).toHaveBeenCalled();
			});
		});

		describe("subscribeToConsumerStatus", () => {
			it("should subscribe to consumer status channel", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				await subscriber.subscribeToConsumerStatus(callback);

				expect(mockSubscribe).toHaveBeenCalledWith("consumers:status", expect.any(Function));
			});

			it("should receive consumer status updates", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribeToConsumerStatus(callback);

				const statusUpdate = {
					type: "consumer_ready",
					groupId: "test-group",
					serviceId: "service-1",
					timestamp: Date.now(),
				};

				messageHandler?.(JSON.stringify(statusUpdate));

				expect(callback).toHaveBeenCalledWith(statusUpdate);
			});

			it("should handle consumer_disconnected event", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribeToConsumerStatus(callback);

				const statusUpdate = {
					type: "consumer_disconnected",
					groupId: "test-group",
					serviceId: "service-2",
					timestamp: Date.now(),
				};

				messageHandler?.(JSON.stringify(statusUpdate));

				expect(callback).toHaveBeenCalledWith(statusUpdate);
			});

			it("should handle consumer_heartbeat event", async () => {
				const subscriber = createRedisSubscriber();
				const callback = vi.fn();

				let messageHandler: (message: string) => void;
				mockSubscribe.mockImplementationOnce((_channel, handler) => {
					messageHandler = handler;
					return Promise.resolve();
				});

				await subscriber.subscribeToConsumerStatus(callback);

				const statusUpdate = {
					type: "consumer_heartbeat",
					groupId: "test-group",
					serviceId: "service-3",
					timestamp: Date.now(),
				};

				messageHandler?.(JSON.stringify(statusUpdate));

				expect(callback).toHaveBeenCalledWith(statusUpdate);
			});
		});
	});

	describe("SessionUpdate type", () => {
		it("should have correct structure", async () => {
			const publisher = createRedisPublisher();

			await publisher.publishSessionUpdate("test", {
				type: "graph_node_created",
				data: { nodeType: "Entity", properties: { name: "Test" } },
			});

			const [, message] = mockPublish.mock.calls[0];
			const parsed: SessionUpdate = JSON.parse(message);

			expect(parsed).toHaveProperty("type");
			expect(parsed).toHaveProperty("sessionId");
			expect(parsed).toHaveProperty("data");
			expect(parsed).toHaveProperty("timestamp");
		});
	});

	describe("Error scenarios", () => {
		it("should handle publish failure", async () => {
			const publisher = createRedisPublisher();
			mockPublish.mockRejectedValueOnce(new Error("Publish failed"));

			await expect(
				publisher.publishSessionUpdate("session", { type: "lineage", data: null }),
			).rejects.toThrow("Publish failed");
		});

		it("should handle subscribe failure", async () => {
			const subscriber = createRedisSubscriber();
			mockSubscribe.mockRejectedValueOnce(new Error("Subscribe failed"));

			await expect(subscriber.subscribe("session", vi.fn())).rejects.toThrow("Subscribe failed");
		});

		it("should handle connect failure in publisher", async () => {
			const publisher = createRedisPublisher();
			mockConnect.mockRejectedValueOnce(new Error("Connection refused"));

			await expect(publisher.connect()).rejects.toThrow("Connection refused");
		});

		it("should handle connect failure in subscriber", async () => {
			const subscriber = createRedisSubscriber();
			mockConnect.mockRejectedValueOnce(new Error("Connection refused"));

			await expect(subscriber.connect()).rejects.toThrow("Connection refused");
		});

		it("should handle quit failure gracefully", async () => {
			const publisher = createRedisPublisher();
			mockQuit.mockRejectedValueOnce(new Error("Quit failed"));

			await publisher.connect();
			mockIsOpen = true;

			await expect(publisher.disconnect()).rejects.toThrow("Quit failed");
		});

		it("should reset connectPromise on publisher connection failure", async () => {
			const publisher = createRedisPublisher();
			mockConnect.mockRejectedValueOnce(new Error("First connection failed"));

			// First connection attempt fails
			await expect(publisher.connect()).rejects.toThrow("First connection failed");

			// Reset mocks for successful retry
			mockConnect.mockResolvedValueOnce(undefined);
			mockIsOpen = false;

			// Second connection attempt should succeed
			await publisher.connect();
			expect(mockConnect).toHaveBeenCalledTimes(2);
		});

		it("should reset state on publisher disconnect failure", async () => {
			const publisher = createRedisPublisher();
			mockQuit.mockRejectedValueOnce(new Error("Quit failed"));

			await publisher.connect();
			mockIsOpen = true;

			// Disconnect will fail but should still reset state
			await expect(publisher.disconnect()).rejects.toThrow("Quit failed");

			// State should be reset despite error
			mockIsOpen = false;
			mockConnect.mockResolvedValueOnce(undefined);

			// Should be able to reconnect
			await publisher.connect();
			expect(mockConnect).toHaveBeenCalled();
		});

		it("should reset state on subscriber disconnect failure", async () => {
			const subscriber = createRedisSubscriber();

			await subscriber.connect();
			mockIsOpen = true;

			// Simulate quit failure
			mockQuit.mockRejectedValueOnce(new Error("Quit failed"));

			await expect(subscriber.disconnect()).rejects.toThrow("Quit failed");

			// State should be reset
			mockIsOpen = false;
		});
	});

	describe("Edge cases", () => {
		it("should handle empty session ID", async () => {
			const publisher = createRedisPublisher();

			await publisher.publishSessionUpdate("", { type: "lineage", data: null });

			const [channel] = mockPublish.mock.calls[0];
			expect(channel).toBe("session::updates");
		});

		it("should handle special characters in session ID", async () => {
			const publisher = createRedisPublisher();
			const specialId = "session-with:special/chars&symbols";

			await publisher.publishSessionUpdate(specialId, { type: "timeline", data: null });

			const [channel] = mockPublish.mock.calls[0];
			expect(channel).toBe(`session:${specialId}:updates`);
		});

		it("should handle complex nested data in updates", async () => {
			const publisher = createRedisPublisher();
			const complexData = {
				nested: {
					array: [1, 2, { deep: true }],
					object: { key: "value" },
				},
				nullValue: null,
				undefinedBecomes: undefined,
			};

			await publisher.publishSessionUpdate("session", {
				type: "node_created",
				data: complexData,
			});

			const [, message] = mockPublish.mock.calls[0];
			const parsed = JSON.parse(message);

			expect(parsed.data.nested.array).toEqual([1, 2, { deep: true }]);
			expect(parsed.data.nested.object).toEqual({ key: "value" });
			expect(parsed.data.nullValue).toBeNull();
		});

		it("should handle large data payloads", async () => {
			const publisher = createRedisPublisher();
			const largeData = { content: "x".repeat(100000) };

			await publisher.publishSessionUpdate("session", { type: "lineage", data: largeData });

			const [, message] = mockPublish.mock.calls[0];
			const parsed = JSON.parse(message);
			expect(parsed.data.content.length).toBe(100000);
		});
	});
});
