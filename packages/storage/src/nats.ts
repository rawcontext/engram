import { type JetStreamClient, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import type { Consumer, ConsumerConfig, Message, MessageClient, Producer } from "./interfaces";

// Re-export types
export type { Consumer, Message, Producer } from "./interfaces";

export class NatsClient implements MessageClient {
	private nc: NatsConnection | null = null;
	private js: JetStreamClient | null = null;
	private producers: Map<string, Producer> = new Map();
	private consumers: Consumer[] = [];
	private url: string;

	constructor(url: string = "localhost:4222") {
		this.url = url;
	}

	async connect(): Promise<void> {
		if (this.nc) return;
		this.nc = await connect({ servers: this.url });
		this.js = jetstream(this.nc);
	}

	private async ensureConnected(): Promise<void> {
		if (!this.nc || !this.js) {
			await this.connect();
		}
	}

	async getProducer(): Promise<Producer> {
		await this.ensureConnected();
		const js = this.js;
		if (!js) throw new Error("JetStream not connected");

		// Return a producer-like wrapper that uses JetStream publish
		const producer: Producer = {
			connect: async () => {},
			disconnect: async () => {},
			send: async (opts: { topic: string; messages: Array<{ key: string; value: string }> }) => {
				// Map topic names to NATS subjects
				const subject = this.topicToSubject(opts.topic);
				for (const msg of opts.messages) {
					await js.publish(subject, msg.value, {
						msgID: msg.key,
					});
				}
			},
		};

		return producer;
	}

	async getConsumer(config: ConsumerConfig): Promise<Consumer> {
		await this.ensureConnected();
		const nc = this.nc;
		const js = this.js;
		if (!nc || !js) throw new Error("NATS not connected");

		const jsm = await jetstreamManager(nc);

		// Create a wrapper that provides the Consumer API
		const consumer: Consumer = {
			connect: async () => {},
			disconnect: async () => {},
			subscribe: async (opts: { topic: string; fromBeginning?: boolean }) => {
				// Subscription is handled in run()
				// Store topic for later use
				(consumer as unknown as { _topic: string })._topic = opts.topic;
			},
			run: async (opts) => {
				const topic = (consumer as unknown as { _topic: string })._topic;
				const subject = this.topicToSubject(topic);
				const stream = this.subjectToStream(subject);

				// Ensure consumer exists
				try {
					await jsm.consumers.add(stream, {
						durable_name: config.groupId,
						filter_subject: subject,
						ack_policy: "explicit",
						deliver_policy: "all",
					});
				} catch (err) {
					// Consumer may already exist, that's fine
					const error = err as Error;
					if (!error.message?.includes("already exists")) {
						throw err;
					}
				}

				const c = await js.consumers.get(stream, config.groupId);
				const messages = await c.consume();

				for await (const msg of messages) {
					try {
						const headerKey = msg.headers?.get("key");
						const queueMessage: Message = {
							key: headerKey ? Buffer.from(headerKey) : undefined,
							value: Buffer.from(msg.data),
							offset: String(msg.seq),
							timestamp: String(Number(msg.info.timestampNanos) / 1_000_000),
						};

						await opts.eachMessage({
							topic,
							partition: 0,
							message: queueMessage,
						});

						msg.ack();
					} catch {
						msg.nak();
					}
				}
			},
		};

		this.consumers.push(consumer);
		return consumer;
	}

	/**
	 * Sends an event to a subject with a specific key for deduplication.
	 */
	async sendEvent(topic: string, key: string, message: unknown): Promise<void> {
		await this.ensureConnected();
		if (!this.js) throw new Error("JetStream not connected");
		const subject = this.topicToSubject(topic);
		await this.js.publish(subject, JSON.stringify(message), {
			msgID: key,
		});
	}

	async disconnect(): Promise<void> {
		if (this.nc) {
			await this.nc.drain();
			await this.nc.close();
			this.nc = null;
			this.js = null;
		}
		this.consumers = [];
		this.producers.clear();
	}

	/**
	 * Map topic names to NATS subjects.
	 * raw_events -> events.raw
	 * parsed_events -> events.parsed
	 * memory.turn_finalized -> memory.turns.finalized
	 * memory.node_created -> memory.nodes.created
	 * *.dead_letter -> dlq.*
	 */
	private topicToSubject(topic: string): string {
		const mappings: Record<string, string> = {
			raw_events: "events.raw",
			parsed_events: "events.parsed",
			"memory.turn_finalized": "memory.turns.finalized",
			"memory.node_created": "memory.nodes.created",
			"ingestion.dead_letter": "dlq.ingestion",
			"memory.dead_letter": "dlq.memory",
		};
		return mappings[topic] || topic.replace(/_/g, ".");
	}

	/**
	 * Determine which stream a subject belongs to.
	 */
	private subjectToStream(subject: string): string {
		if (subject.startsWith("events.")) return "EVENTS";
		if (subject.startsWith("memory.")) return "MEMORY";
		if (subject.startsWith("dlq.")) return "DLQ";
		throw new Error(`Unknown stream for subject: ${subject}`);
	}
}

export function createNatsClient(_clientId?: string): NatsClient {
	const url = process.env.NATS_URL || "nats://localhost:4222";
	return new NatsClient(url);
}
