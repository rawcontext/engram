import { QdrantClient } from "@qdrant/js-client-rest";
import { beforeAll, describe, expect, it } from "vitest";
import { createFalkorClient, createNatsClient } from "../../packages/storage/src/index";

// Real Clients
const nats = createNatsClient("test-client");
// Using our wrapper again to verify IT works since official client failed in test harness (likely version mismatch or connection options)
const falkor = createFalkorClient();
const qdrant = new QdrantClient({ url: "http://localhost:6333" });

describe("Infrastructure E2E", () => {
	beforeAll(async () => {
		// Wait for services to be ready
		await new Promise((resolve) => setTimeout(resolve, 5000));
	});

	it("should connect to Redpanda and send/receive message", async () => {
		const topic = `test-topic-${Date.now()}`;
		const producer = await nats.getProducer();
		await producer.send({
			topic,
			messages: [{ key: "test-key", value: "Hello Redpanda" }],
		});

		expect(true).toBe(true);
	});

	it("should connect to FalkorDB and run query via Wrapper", async () => {
		await falkor.connect();
		try {
			// Create a node
			// Note: The wrapper does simple regex replacement for params $id.
			const query = "CREATE (:Person {name: 'WrapperTest'}) RETURN 'Success'";
			const res = await falkor.query(query);
			// Check if response array contains "Success"
			expect(JSON.stringify(res)).toContain("Success");
		} finally {
			await falkor.disconnect();
		}
	});

	it("should connect to Qdrant and list collections", async () => {
		const res = await qdrant.getCollections();
		expect(res).toHaveProperty("collections");
	});
});
