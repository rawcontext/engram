import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mocks so they're available before the module is loaded
const {
	mockProducerConnect,
	mockProducerDisconnect,
	mockProducerSend,
	mockConsumerConnect,
	mockConsumerDisconnect,
	mockConsumerSubscribe,
	mockConsumerRun,
	mockProducer,
	mockConsumer,
	mockKafka,
} = vi.hoisted(() => {
	const mockProducerConnect = vi.fn();
	const mockProducerDisconnect = vi.fn();
	const mockProducerSend = vi.fn();

	const mockConsumerConnect = vi.fn();
	const mockConsumerDisconnect = vi.fn();
	const mockConsumerSubscribe = vi.fn();
	const mockConsumerRun = vi.fn();

	const mockProducer = {
		connect: mockProducerConnect,
		disconnect: mockProducerDisconnect,
		send: mockProducerSend,
	};

	const mockConsumer = {
		connect: mockConsumerConnect,
		disconnect: mockConsumerDisconnect,
		subscribe: mockConsumerSubscribe,
		run: mockConsumerRun,
	};

	const mockKafka = {
		producer: vi.fn(() => mockProducer),
		consumer: vi.fn(() => mockConsumer),
	};

	return {
		mockProducerConnect,
		mockProducerDisconnect,
		mockProducerSend,
		mockConsumerConnect,
		mockConsumerDisconnect,
		mockConsumerSubscribe,
		mockConsumerRun,
		mockProducer,
		mockConsumer,
		mockKafka,
	};
});

vi.mock("@confluentinc/kafka-javascript", () => {
	class MockKafka {
		producer = mockKafka.producer;
		consumer = mockKafka.consumer;
	}

	return {
		KafkaJS: {
			Kafka: MockKafka,
		},
	};
});

import { createKafkaClient, KafkaClient } from "./kafka";

describe("KafkaClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockProducerConnect.mockResolvedValue(undefined);
		mockProducerDisconnect.mockResolvedValue(undefined);
		mockProducerSend.mockResolvedValue(undefined);
		mockConsumerConnect.mockResolvedValue(undefined);
		mockConsumerDisconnect.mockResolvedValue(undefined);
		mockConsumerSubscribe.mockResolvedValue(undefined);
		process.env.REDPANDA_BROKERS = "localhost:19092";
	});

	describe("constructor", () => {
		it("should create client with default brokers", () => {
			const client = new KafkaClient();
			expect(client).toBeInstanceOf(KafkaClient);
		});

		it("should create client with custom brokers", () => {
			const client = new KafkaClient(["broker1:9092", "broker2:9092"], "custom-client");
			expect(client).toBeInstanceOf(KafkaClient);
		});
	});

	describe("getProducer", () => {
		it("should create and connect producer on first call", async () => {
			const client = new KafkaClient();
			const producer = await client.getProducer();

			expect(producer).toBeDefined();
			expect(mockKafka.producer).toHaveBeenCalledWith({
				"bootstrap.servers": "localhost:19092",
				"client.id": "engram-producer",
				"allow.auto.create.topics": true,
			});
			expect(mockProducerConnect).toHaveBeenCalledTimes(1);
		});

		it("should reuse existing producer on subsequent calls", async () => {
			const client = new KafkaClient();
			const producer1 = await client.getProducer();
			const producer2 = await client.getProducer();

			expect(producer1).toBe(producer2);
			expect(mockProducerConnect).toHaveBeenCalledTimes(1);
		});

		it("should handle connection errors", async () => {
			const client = new KafkaClient();
			mockProducerConnect.mockRejectedValueOnce(new Error("Connection failed"));

			await expect(client.getProducer()).rejects.toThrow("Connection failed");
		});
	});

	describe("getConsumer", () => {
		it("should create and connect consumer", async () => {
			const client = new KafkaClient();
			const consumer = await client.getConsumer({ groupId: "test-group" });

			expect(consumer).toBeDefined();
			expect(mockKafka.consumer).toHaveBeenCalledWith({
				"bootstrap.servers": "localhost:19092",
				"group.id": "test-group",
				"auto.offset.reset": "earliest",
				"enable.auto.commit": true,
				"session.timeout.ms": 120000,
				"max.poll.interval.ms": 180000,
			});
			expect(mockConsumerConnect).toHaveBeenCalledTimes(1);
		});

		it("should track multiple consumers", async () => {
			const client = new KafkaClient();
			const consumer1 = await client.getConsumer({ groupId: "group1" });
			const consumer2 = await client.getConsumer({ groupId: "group2" });

			expect(consumer1).not.toBe(consumer2);
			expect(mockConsumerConnect).toHaveBeenCalledTimes(2);
		});

		it("should handle connection errors", async () => {
			const client = new KafkaClient();
			mockConsumerConnect.mockRejectedValueOnce(new Error("Connection failed"));

			await expect(client.getConsumer({ groupId: "test-group" })).rejects.toThrow(
				"Connection failed",
			);
		});

		it("should synchronize consumer creation", async () => {
			const client = new KafkaClient();

			// Simulate slow connection
			mockConsumerConnect.mockImplementation(
				() => new Promise((resolve) => setTimeout(resolve, 50)),
			);

			// Start two concurrent consumer creations
			const promise1 = client.getConsumer({ groupId: "group1" });
			const promise2 = client.getConsumer({ groupId: "group2" });

			await Promise.all([promise1, promise2]);

			expect(mockConsumerConnect).toHaveBeenCalledTimes(2);
		});
	});

	describe("consumer API wrapper", () => {
		it("should provide connect method", async () => {
			const client = new KafkaClient();
			const consumer = await client.getConsumer({ groupId: "test-group" });

			mockConsumerConnect.mockClear();
			await consumer.connect();

			expect(mockConsumerConnect).toHaveBeenCalledTimes(1);
		});

		it("should provide disconnect method", async () => {
			const client = new KafkaClient();
			const consumer = await client.getConsumer({ groupId: "test-group" });

			await consumer.disconnect();

			expect(mockConsumerDisconnect).toHaveBeenCalledTimes(1);
		});

		it("should provide subscribe method", async () => {
			const client = new KafkaClient();
			const consumer = await client.getConsumer({ groupId: "test-group" });

			await consumer.subscribe({ topic: "test-topic", fromBeginning: true });

			expect(mockConsumerSubscribe).toHaveBeenCalledWith({ topics: ["test-topic"] });
		});

		it("should provide run method", async () => {
			const client = new KafkaClient();
			const consumer = await client.getConsumer({ groupId: "test-group" });

			const messageHandler = vi.fn();
			const runOptions = {
				eachMessage: messageHandler,
			};

			consumer.run(runOptions);

			expect(mockConsumerRun).toHaveBeenCalledWith(runOptions);
		});
	});

	describe("createConsumer (deprecated)", () => {
		it("should create consumer with groupId", async () => {
			const client = new KafkaClient();
			const consumer = await client.createConsumer("legacy-group");

			expect(consumer).toBeDefined();
			expect(mockKafka.consumer).toHaveBeenCalledWith(
				expect.objectContaining({
					"group.id": "legacy-group",
				}),
			);
		});
	});

	describe("sendEvent", () => {
		it("should send message to topic with key", async () => {
			const client = new KafkaClient();
			const message = { type: "test", data: "payload" };

			await client.sendEvent("test-topic", "test-key", message);

			expect(mockProducerSend).toHaveBeenCalledWith({
				topic: "test-topic",
				messages: [
					{
						key: "test-key",
						value: JSON.stringify(message),
					},
				],
			});
		});

		it("should auto-connect producer if not connected", async () => {
			const client = new KafkaClient();
			await client.sendEvent("test-topic", "key", { data: "test" });

			expect(mockProducerConnect).toHaveBeenCalledTimes(1);
		});

		it("should handle send errors", async () => {
			const client = new KafkaClient();
			mockProducerSend.mockRejectedValueOnce(new Error("Send failed"));

			await expect(client.sendEvent("test-topic", "key", { data: "test" })).rejects.toThrow(
				"Send failed",
			);
		});

		it("should stringify complex objects", async () => {
			const client = new KafkaClient();
			const complexMessage = {
				nested: { array: [1, 2, 3] },
				nullValue: null,
				boolValue: true,
			};

			await client.sendEvent("test-topic", "key", complexMessage);

			expect(mockProducerSend).toHaveBeenCalledWith({
				topic: "test-topic",
				messages: [
					{
						key: "key",
						value: JSON.stringify(complexMessage),
					},
				],
			});
		});
	});

	describe("disconnect", () => {
		it("should disconnect all consumers and producer", async () => {
			const client = new KafkaClient();

			await client.getProducer();
			await client.getConsumer({ groupId: "group1" });
			await client.getConsumer({ groupId: "group2" });

			await client.disconnect();

			expect(mockConsumerDisconnect).toHaveBeenCalledTimes(2);
			expect(mockProducerDisconnect).toHaveBeenCalledTimes(1);
		});

		it("should be idempotent when no connections exist", async () => {
			const client = new KafkaClient();

			await client.disconnect();

			expect(mockConsumerDisconnect).not.toHaveBeenCalled();
			expect(mockProducerDisconnect).not.toHaveBeenCalled();
		});

		it("should synchronize disconnect operations", async () => {
			const client = new KafkaClient();

			await client.getConsumer({ groupId: "group1" });

			// Simulate slow disconnect
			mockConsumerDisconnect.mockImplementation(
				() => new Promise((resolve) => setTimeout(resolve, 50)),
			);

			// Start two concurrent disconnects
			const promise1 = client.disconnect();
			const promise2 = client.disconnect();

			await Promise.all([promise1, promise2]);

			// Should only disconnect once
			expect(mockConsumerDisconnect).toHaveBeenCalledTimes(1);
		});

		it("should handle disconnect errors gracefully", async () => {
			const client = new KafkaClient();

			await client.getProducer();
			mockProducerDisconnect.mockRejectedValueOnce(new Error("Disconnect failed"));

			await expect(client.disconnect()).rejects.toThrow("Disconnect failed");
		});

		it("should clear consumers array after disconnect", async () => {
			const client = new KafkaClient();

			await client.getConsumer({ groupId: "group1" });
			await client.disconnect();

			// Create new consumer after disconnect
			mockConsumerConnect.mockClear();
			await client.getConsumer({ groupId: "group2" });

			expect(mockConsumerConnect).toHaveBeenCalledTimes(1);
		});

		it("should reset producer after disconnect", async () => {
			const client = new KafkaClient();

			await client.getProducer();
			await client.disconnect();

			// Get producer again after disconnect
			mockProducerConnect.mockClear();
			await client.getProducer();

			expect(mockProducerConnect).toHaveBeenCalledTimes(1);
		});
	});

	describe("createKafkaClient factory", () => {
		it("should create client with default brokers", () => {
			const client = createKafkaClient("test-client");
			expect(client).toBeInstanceOf(KafkaClient);
		});

		it("should use REDPANDA_BROKERS env var", () => {
			process.env.REDPANDA_BROKERS = "broker1:9092,broker2:9092";
			const client = createKafkaClient("test-client");
			expect(client).toBeInstanceOf(KafkaClient);
		});

		it("should fallback to localhost when env var not set", () => {
			delete process.env.REDPANDA_BROKERS;
			const client = createKafkaClient("test-client");
			expect(client).toBeInstanceOf(KafkaClient);
		});
	});
});
