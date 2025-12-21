import { createRequire } from "node:module";
import type { Consumer, ConsumerConfig, KafkaMessage, MessageClient, Producer } from "./interfaces";

// Re-export types for backward compatibility
export type { Consumer, KafkaMessage, Producer } from "./interfaces";

const require = createRequire(import.meta.url);
const { Kafka } = require("@confluentinc/kafka-javascript").KafkaJS;

// Internal consumer type from the library (different from public interface)
type InternalConsumer = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	subscribe(opts: { topics: string[] }): Promise<void>;
	run(opts: {
		eachMessage: (payload: {
			topic: string;
			partition: number;
			message: KafkaMessage;
		}) => Promise<void>;
	}): void;
};

export class KafkaClient implements MessageClient {
	private kafka: unknown;
	private producer: Producer | null = null;
	private consumers: Consumer[] = [];
	private consumersLock = Promise.resolve();
	private brokers: string;

	constructor(brokers: string[] = ["localhost:19092"], _clientId: string = "engram-client") {
		this.brokers = brokers.join(",");
		this.kafka = new Kafka({});
	}

	public async getProducer(): Promise<Producer> {
		if (!this.producer) {
			const kafka = this.kafka as { producer: (config: Record<string, unknown>) => Producer };
			this.producer = kafka.producer({
				"bootstrap.servers": this.brokers,
				"client.id": "engram-producer",
				"allow.auto.create.topics": true,
			});
			await this.producer.connect();
		}
		return this.producer;
	}

	/**
	 * Create a new consumer with the specified configuration.
	 * Implements MessageClient interface.
	 * @param config - Consumer configuration including group ID
	 */
	public async getConsumer(config: ConsumerConfig): Promise<Consumer> {
		// Synchronize consumer creation to prevent race conditions
		await this.consumersLock;

		const operationPromise = (async () => {
			const kafka = this.kafka as {
				consumer: (config: Record<string, unknown>) => InternalConsumer;
			};
			const internalConsumer = kafka.consumer({
				"bootstrap.servers": this.brokers,
				"group.id": config.groupId,
				"auto.offset.reset": "earliest",
				"enable.auto.commit": true,
				"session.timeout.ms": 120000, // 2 minutes
				"max.poll.interval.ms": 180000, // 3 minutes
			}) as InternalConsumer;
			await internalConsumer.connect();

			// Wrap to provide KafkaJS-compatible API
			const wrappedConsumer: Consumer = {
				connect: () => internalConsumer.connect(),
				disconnect: () => internalConsumer.disconnect(),
				subscribe: (opts: { topic: string; fromBeginning?: boolean }) =>
					internalConsumer.subscribe({ topics: [opts.topic] }),
				run: (opts) => internalConsumer.run(opts),
			};

			this.consumers.push(wrappedConsumer);
			return wrappedConsumer;
		})();

		this.consumersLock = operationPromise.then(
			() => {},
			() => {},
		);
		return operationPromise;
	}

	/**
	 * @deprecated Use getConsumer(config) instead
	 */
	public async createConsumer(groupId: string): Promise<Consumer> {
		return this.getConsumer({ groupId });
	}

	/**
	 * Sends an event to a topic with a specific key to ensure partitioning order.
	 * This effectively acts as the Stream Multiplexer/De-multiplexer entry point.
	 */
	public async sendEvent(topic: string, key: string, message: unknown): Promise<void> {
		const producer = await this.getProducer();
		await producer.send({
			topic,
			messages: [
				{
					key, // Ensures all events with same key go to same partition
					value: JSON.stringify(message),
				},
			],
		});
	}

	public async disconnect(): Promise<void> {
		// Synchronize disconnect to prevent race conditions
		await this.consumersLock;

		const operationPromise = (async () => {
			// Disconnect all consumers
			for (const consumer of this.consumers) {
				await consumer.disconnect();
			}
			this.consumers = [];

			// Disconnect producer
			if (this.producer) {
				await this.producer.disconnect();
				this.producer = null;
			}
		})();

		this.consumersLock = operationPromise.then(
			() => {},
			() => {},
		);
		await operationPromise;
	}
}

export const createKafkaClient = (clientId: string) => {
	// Use port 19092 for local dev - this is the external listener that advertises localhost:19092
	const brokers = (process.env.REDPANDA_BROKERS || "localhost:19092").split(",");
	return new KafkaClient(brokers, clientId);
};
