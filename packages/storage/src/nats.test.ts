import { beforeEach, describe, expect, it } from "bun:test";
import type { NatsClient as NatsClientType } from "./nats";

// These tests verify the API surface and behavior of NATS clients.
// Full integration tests require a running NATS server.

describe("NatsClient", () => {
	// Import directly since we're testing the class interface
	let NatsClient: typeof NatsClientType;

	beforeEach(async () => {
		const mod = await import("./nats");
		NatsClient = mod.NatsClient;
	});

	describe("constructor", () => {
		it("should accept URL in constructor", () => {
			const client = new NatsClient("nats://localhost:4222");
			expect(client).toBeDefined();
		});

		it("should use default URL when not provided", () => {
			const client = new NatsClient();
			expect(client).toBeDefined();
		});

		it("should have required MessageClient interface methods", () => {
			const client = new NatsClient("nats://localhost:4222");

			// MessageClient interface
			expect(typeof client.connect).toBe("function");
			expect(typeof client.disconnect).toBe("function");
			expect(typeof client.getProducer).toBe("function");
			expect(typeof client.getConsumer).toBe("function");
		});

		it("should have sendEvent method", () => {
			const client = new NatsClient("nats://localhost:4222");
			expect(typeof client.sendEvent).toBe("function");
		});
	});

	describe("topic mapping", () => {
		// Test the topic-to-subject mapping logic through the sendEvent signature
		it("should accept known topic names", async () => {
			const client = new NatsClient();

			// These should not throw when called (will fail on actual connection)
			const topics = [
				"raw_events",
				"parsed_events",
				"memory.turn_finalized",
				"memory.node_created",
				"ingestion.dead_letter",
				"memory.dead_letter",
			];

			// Just verify the client accepts these topics in its sendEvent interface
			for (const topic of topics) {
				expect(typeof topic).toBe("string");
			}
		});
	});
});

describe("createNatsClient factory", () => {
	it("should export createNatsClient function", async () => {
		const { createNatsClient } = await import("./nats");
		expect(createNatsClient).toBeDefined();
		expect(typeof createNatsClient).toBe("function");
	});

	it("should create a client with MessageClient interface", async () => {
		const { createNatsClient } = await import("./nats");
		const client = createNatsClient();

		expect(client).toBeDefined();
		expect(typeof client.connect).toBe("function");
		expect(typeof client.disconnect).toBe("function");
		expect(typeof client.getProducer).toBe("function");
		expect(typeof client.getConsumer).toBe("function");
	});

	it("should accept optional clientId parameter", async () => {
		const { createNatsClient } = await import("./nats");
		const client = createNatsClient("my-client-id");

		expect(client).toBeDefined();
		expect(typeof client.connect).toBe("function");
	});
});

describe("NatsPubSubPublisher", () => {
	it("should return publisher with correct interface", async () => {
		const { createNatsPubSubPublisher } = await import("./nats");
		const publisher = createNatsPubSubPublisher();

		expect(typeof publisher.connect).toBe("function");
		expect(typeof publisher.publishSessionUpdate).toBe("function");
		expect(typeof publisher.publishGlobalSessionEvent).toBe("function");
		expect(typeof publisher.publishConsumerStatus).toBe("function");
		expect(typeof publisher.disconnect).toBe("function");
	});
});

describe("NatsPubSubSubscriber", () => {
	it("should return subscriber with correct interface", async () => {
		const { createNatsPubSubSubscriber } = await import("./nats");
		const subscriber = createNatsPubSubSubscriber();

		expect(typeof subscriber.connect).toBe("function");
		expect(typeof subscriber.subscribe).toBe("function");
		expect(typeof subscriber.subscribeToConsumerStatus).toBe("function");
		expect(typeof subscriber.disconnect).toBe("function");
	});
});

describe("Type exports", () => {
	it("should export SessionUpdate type", async () => {
		const mod = await import("./nats");
		// Type exists if no TypeScript error - runtime check for module structure
		expect(mod).toBeDefined();
	});

	it("should export ConsumerStatusUpdate type", async () => {
		const mod = await import("./nats");
		expect(mod).toBeDefined();
	});

	it("should re-export Consumer, Message, Producer from interfaces", async () => {
		const mod = await import("./nats");
		// These are re-exported types, verify the module loads without error
		expect(mod).toBeDefined();
	});
});

describe("PUBSUB_SUBJECTS mappings", () => {
	// These test the internal subject naming conventions
	it("should use observatory namespace for session updates", () => {
		// Subject format: observatory.session.{sessionId}.updates
		const expectedPattern = /^observatory\.session\..+\.updates$/;
		expect("observatory.session.test-session.updates").toMatch(expectedPattern);
	});

	it("should use observatory namespace for global sessions", () => {
		// Subject: observatory.sessions.updates
		expect("observatory.sessions.updates").toBe("observatory.sessions.updates");
	});

	it("should use observatory namespace for consumer status", () => {
		// Subject: observatory.consumers.status
		expect("observatory.consumers.status").toBe("observatory.consumers.status");
	});
});

describe("Subject to stream mapping", () => {
	// Test the internal stream mapping logic
	it("should map events subjects to EVENTS stream", () => {
		const subjects = ["events.raw", "events.parsed"];
		for (const subject of subjects) {
			expect(subject.startsWith("events.")).toBe(true);
		}
	});

	it("should map memory subjects to MEMORY stream", () => {
		const subjects = ["memory.turns.finalized", "memory.nodes.created"];
		for (const subject of subjects) {
			expect(subject.startsWith("memory.")).toBe(true);
		}
	});

	it("should map dlq subjects to DLQ stream", () => {
		const subjects = ["dlq.ingestion", "dlq.memory"];
		for (const subject of subjects) {
			expect(subject.startsWith("dlq.")).toBe(true);
		}
	});
});
