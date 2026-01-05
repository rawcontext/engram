/**
 * Integration tests for NATS client.
 *
 * Tests NatsClient, NatsPubSubPublisher, and NatsPubSubSubscriber against real NATS.
 * Run with: RUN_INTEGRATION_TESTS=1 bun test packages/storage/tests/integration/nats.integration.spec.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
	NatsClient,
	createNatsPubSubPublisher,
	createNatsPubSubSubscriber,
	type SessionUpdate,
} from "../../src/nats";
import {
	createTestId,
	createTestNatsConnection,
	getNatsUrl,
	shouldRunIntegrationTests,
	startNatsContainer,
	stopAllContainers,
} from "./fixtures";

// Skip all tests if integration tests are not enabled
const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("NatsClient Integration", () => {
	let client: NatsClient;

	beforeAll(async () => {
		await startNatsContainer();
		const url = getNatsUrl();
		client = new NatsClient(url);
	});

	afterAll(async () => {
		if (client) {
			await client.disconnect();
		}
		await stopAllContainers();
	});

	describe("Connection Lifecycle", () => {
		it("should connect successfully", async () => {
			await client.connect();
			const nc = await client.getConnection();
			expect(nc).toBeDefined();
		});

		it("should handle multiple connect calls", async () => {
			await client.connect();
			await client.connect();
			const nc = await client.getConnection();
			expect(nc).toBeDefined();
		});
	});

	describe("Producer Operations", () => {
		it("should get a producer", async () => {
			const producer = await client.getProducer();
			expect(producer).toBeDefined();
			expect(producer.send).toBeDefined();
		});
	});

	describe("sendEvent", () => {
		it("should publish events to JetStream", async () => {
			const testKey = createTestId("event");
			const testMessage = {
				type: "test",
				data: { hello: "world" },
				timestamp: Date.now(),
			};

			// This should not throw
			await client.sendEvent("events.raw", testKey, testMessage);
		});

		it("should handle deduplication (same msgID)", async () => {
			const testKey = createTestId("dedup");
			const testMessage = { type: "test", data: "dedup test" };

			// Publish the same message twice with the same key
			await client.sendEvent("events.raw", testKey, testMessage);
			await client.sendEvent("events.raw", testKey, testMessage);

			// Both should succeed (duplicate detection happens server-side)
		});
	});

	describe("Disconnect", () => {
		it("should disconnect successfully", async () => {
			const tempClient = new NatsClient(getNatsUrl());
			await tempClient.connect();
			await tempClient.disconnect();
			// Should not throw on disconnect
		});
	});
});

describe.skipIf(!runTests)("NatsPubSub Integration", () => {
	beforeAll(async () => {
		await startNatsContainer();
		// Set NATS_URL for the pub/sub functions
		process.env.NATS_URL = `nats://${getNatsUrl()}`;
	});

	afterAll(async () => {
		await stopAllContainers();
	});

	describe("Publisher", () => {
		let publisher: ReturnType<typeof createNatsPubSubPublisher>;

		beforeAll(() => {
			publisher = createNatsPubSubPublisher();
		});

		afterEach(async () => {
			await publisher.disconnect();
		});

		it("should connect successfully", async () => {
			await publisher.connect();
			// No error means success
		});

		it("should publish session updates", async () => {
			await publisher.connect();
			const sessionId = createTestId("session");

			await publisher.publishSessionUpdate(sessionId, {
				type: "node_created",
				data: { nodeId: "test-node" },
			});
			// No error means success
		});

		it("should publish global session events", async () => {
			await publisher.connect();

			await publisher.publishGlobalSessionEvent("session_created", {
				id: createTestId("session"),
				title: "Test Session",
			});
			// No error means success
		});

		it("should publish consumer status", async () => {
			await publisher.connect();

			await publisher.publishConsumerStatus("consumer_ready", "test-group", "test-service");
			// No error means success
		});
	});

	describe("Subscriber", () => {
		let publisher: ReturnType<typeof createNatsPubSubPublisher>;
		let subscriber: ReturnType<typeof createNatsPubSubSubscriber>;

		beforeAll(() => {
			publisher = createNatsPubSubPublisher();
			subscriber = createNatsPubSubSubscriber();
		});

		afterEach(async () => {
			await subscriber.disconnect();
			await publisher.disconnect();
		});

		it("should connect successfully", async () => {
			await subscriber.connect();
			// No error means success
		});

		it("should subscribe to session updates", async () => {
			await subscriber.connect();
			await publisher.connect();

			const sessionId = createTestId("session");
			const receivedMessages: SessionUpdate[] = [];

			const unsubscribe = await subscriber.subscribe<SessionUpdate>(sessionId, (message) => {
				receivedMessages.push(message);
			});

			// Give subscription time to fully establish
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Publish a message
			await publisher.publishSessionUpdate(sessionId, {
				type: "node_created",
				data: { nodeId: "test-node" },
			});

			// Wait for message to be received (NATS is fast but async)
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
			if (receivedMessages.length > 0) {
				expect(receivedMessages[0].type).toBe("node_created");
				expect(receivedMessages[0].sessionId).toBe(sessionId);
			}

			await unsubscribe();
		});

		it("should subscribe to consumer status", async () => {
			await subscriber.connect();
			await publisher.connect();

			const receivedMessages: unknown[] = [];

			const unsubscribe = await subscriber.subscribeToConsumerStatus((message) => {
				receivedMessages.push(message);
			});

			// Give subscription time to fully establish
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Publish consumer status
			await publisher.publishConsumerStatus("consumer_heartbeat", "test-group", "test-service");

			// Wait for message
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

			await unsubscribe();
		});

		it("should unsubscribe correctly", async () => {
			await subscriber.connect();
			await publisher.connect();

			const sessionId = createTestId("session");
			const receivedMessages: SessionUpdate[] = [];

			const unsubscribe = await subscriber.subscribe<SessionUpdate>(sessionId, (message) => {
				receivedMessages.push(message);
			});

			// Unsubscribe before publishing
			await unsubscribe();

			// Publish a message after unsubscribe
			await publisher.publishSessionUpdate(sessionId, {
				type: "node_created",
				data: { nodeId: "after-unsub" },
			});

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should not have received the message
			const afterUnsubMessages = receivedMessages.filter(
				(m) => (m.data as { nodeId: string }).nodeId === "after-unsub",
			);
			expect(afterUnsubMessages).toHaveLength(0);
		});

		it("should handle multiple subscribers to same subject", async () => {
			await subscriber.connect();
			await publisher.connect();

			const sessionId = createTestId("session");
			const receivedMessages1: SessionUpdate[] = [];
			const receivedMessages2: SessionUpdate[] = [];

			const unsubscribe1 = await subscriber.subscribe<SessionUpdate>(sessionId, (message) => {
				receivedMessages1.push(message);
			});

			const unsubscribe2 = await subscriber.subscribe<SessionUpdate>(sessionId, (message) => {
				receivedMessages2.push(message);
			});

			// Give subscriptions time to fully establish
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Publish a message
			await publisher.publishSessionUpdate(sessionId, {
				type: "timeline",
				data: { events: [] },
			});

			// Wait for messages
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Both subscribers should receive the message
			expect(receivedMessages1.length).toBeGreaterThanOrEqual(1);
			expect(receivedMessages2.length).toBeGreaterThanOrEqual(1);

			await unsubscribe1();
			await unsubscribe2();
		});
	});
});
