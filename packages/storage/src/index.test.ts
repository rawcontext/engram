import { describe, expect, it, mock, spyOn } from "bun:test";
import { createFalkorClient, FalkorClient } from "./falkor";
import { createKafkaClient, KafkaClient } from "./kafka";

// Mock Redis
const mockRedisClient = {
	connect: mock(async () => {}),
	disconnect: mock(async () => {}),
	sendCommand: mock(async () => []),
	on: mock(() => {}),
};

// Mock createClient
mock.module("redis", () => ({
	createClient: () => mockRedisClient,
}));

// Mock KafkaJS
const mockProducer = {
	connect: mock(async () => {}),
	send: mock(async () => {}),
	disconnect: mock(async () => {}),
};

const mockConsumer = {
	connect: mock(async () => {}),
	subscribe: mock(async () => {}),
	run: mock(async () => {}),
	disconnect: mock(async () => {}),
};

const mockKafka = {
	producer: mock(() => mockProducer),
	consumer: mock(() => mockConsumer),
};

mock.module("kafkajs", () => ({
	Kafka: class {
		constructor() {
			return mockKafka;
		}
	},
}));

describe("Storage Package", () => {
	describe("FalkorClient", () => {
		it("should create a client with default URL", () => {
			const client = createFalkorClient();
			expect(client).toBeDefined();
			expect(client.connect).toBeFunction();
			expect(client.query).toBeFunction();
		});

		it("should connect and disconnect", async () => {
			const client = new FalkorClient();
			await client.connect();
			expect(mockRedisClient.connect).toHaveBeenCalled();

			await client.disconnect();
			expect(mockRedisClient.disconnect).toHaveBeenCalled();
		});

		it("should execute graph query", async () => {
			const client = new FalkorClient();
			await client.connect(); // Ensure connected if needed, though mock is loose

			const query = "MATCH (n) RETURN n";
			await client.query(query);

			expect(mockRedisClient.sendCommand).toHaveBeenCalled();
			const lastCall = mockRedisClient.sendCommand.mock.calls[0];
			// [ 'GRAPH.QUERY', 'SoulGraph', 'MATCH (n) RETURN n' ]
			expect(lastCall[0]).toEqual(["GRAPH.QUERY", "SoulGraph", query]);
		});

		it("should replace parameters in query", async () => {
			const client = new FalkorClient();
			const query = "CREATE (n {name: $name})";
			const params = { name: "test" };

			await client.query(query, params);

			const lastCall =
				mockRedisClient.sendCommand.mock.calls[mockRedisClient.sendCommand.mock.calls.length - 1];
			expect(lastCall[0][2]).toContain("'test'");
		});
	});

	describe("KafkaClient", () => {
		it("should create a client with defaults", () => {
			const client = createKafkaClient("test-client");
			expect(client).toBeDefined();
			expect(client.getProducer).toBeFunction();
		});

		it("should get producer and connect once", async () => {
			const client = new KafkaClient();
			await client.getProducer();
			expect(mockKafka.producer).toHaveBeenCalled();
			expect(mockProducer.connect).toHaveBeenCalled();

			// Second call should reuse
			await client.getProducer();
			expect(mockKafka.producer).toHaveBeenCalledTimes(1);
		});

		it("should send event via producer", async () => {
			const client = new KafkaClient();
			const topic = "test-topic";
			const key = "key-1";
			const message = { foo: "bar" };

			await client.sendEvent(topic, key, message);

			expect(mockProducer.send).toHaveBeenCalledWith({
				topic,
				messages: [{ key, value: JSON.stringify(message) }],
			});
		});

		it("should create consumer", async () => {
			const client = new KafkaClient();
			const consumer = await client.createConsumer("group-1");

			expect(mockKafka.consumer).toHaveBeenCalledWith({ groupId: "group-1" });
			expect(mockConsumer.connect).toHaveBeenCalled();
			expect(consumer).toBe(mockConsumer);
		});
	});
});
