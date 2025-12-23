import { describe, expect, it } from "bun:test";
import { createFalkorClient, FalkorClient } from "./falkor";
import { createNatsClient, NatsClient } from "./nats";

/**
 * Storage Package Unit Tests
 *
 * These tests verify the interface contracts of the storage clients.
 * Integration tests requiring actual database connections should be run separately
 * with real FalkorDB and NATS instances.
 */
describe("Storage Package", () => {
	describe("FalkorClient", () => {
		it("should create a client with default URL", () => {
			const client = createFalkorClient();
			expect(client).toBeDefined();
			expect(typeof client.connect).toBe("function");
			expect(typeof client.query).toBe("function");
			expect(typeof client.disconnect).toBe("function");
			expect(typeof client.isConnected).toBe("function");
		});

		it("should implement GraphClient interface", () => {
			const client = new FalkorClient();
			// Verify interface compliance
			expect(client).toHaveProperty("connect");
			expect(client).toHaveProperty("disconnect");
			expect(client).toHaveProperty("query");
			expect(client).toHaveProperty("isConnected");
		});

		it("should report not connected initially", () => {
			const client = new FalkorClient();
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("NatsClient", () => {
		it("should create a client with defaults", () => {
			const client = createNatsClient("test-client");
			expect(client).toBeDefined();
			expect(typeof client.getProducer).toBe("function");
			expect(typeof client.getConsumer).toBe("function");
			expect(typeof client.sendEvent).toBe("function");
			expect(typeof client.disconnect).toBe("function");
		});

		it("should implement MessageClient interface", () => {
			const client = new NatsClient();
			// Verify interface compliance
			expect(client).toHaveProperty("getProducer");
			expect(client).toHaveProperty("getConsumer");
			expect(client).toHaveProperty("disconnect");
		});
	});
});
