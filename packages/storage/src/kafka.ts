import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Kafka } = require("@confluentinc/kafka-javascript").KafkaJS;

// Define types for the Kafka consumer/producer since the library lacks proper TS types
type KafkaMessage = {
	key?: Buffer;
	value: Buffer;
	offset: string;
	timestamp?: string;
};

// Internal consumer type from the library
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

// Public consumer type with KafkaJS-compatible API
export type Consumer = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	subscribe(opts: { topic: string; fromBeginning?: boolean }): Promise<void>;
	run(opts: {
		eachMessage: (payload: {
			topic: string;
			partition: number;
			message: KafkaMessage;
		}) => Promise<void>;
	}): void;
};

export type Producer = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(opts: { topic: string; messages: Array<{ key: string; value: string }> }): Promise<void>;
};

export class KafkaClient {
	private kafka: unknown;
	private producer: Producer | null = null;
	private brokers: string;

	constructor(brokers: string[] = ["localhost:19092"], clientId: string = "soul-client") {
		this.brokers = brokers.join(",");
		this.kafka = new Kafka({});
	}

	public async getProducer(): Promise<Producer> {
		if (!this.producer) {
			// @ts-expect-error - accessing kafka instance
			this.producer = this.kafka.producer({
				"bootstrap.servers": this.brokers,
				"client.id": "engram-producer",
				"allow.auto.create.topics": true,
			}) as Producer;
			await this.producer.connect();
		}
		return this.producer;
	}

	public async createConsumer(groupId: string): Promise<Consumer> {
		// @ts-expect-error - accessing kafka instance
		const internalConsumer = this.kafka.consumer({
			"bootstrap.servers": this.brokers,
			"group.id": groupId,
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

		return wrappedConsumer;
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

	public async disconnect() {
		if (this.producer) {
			await this.producer.disconnect();
		}
	}
}

export const createKafkaClient = (clientId: string) => {
	// Use port 19092 for local dev - this is the external listener that advertises localhost:19092
	const brokers = (process.env.REDPANDA_BROKERS || "localhost:19092").split(",");
	return new KafkaClient(brokers, clientId);
};
