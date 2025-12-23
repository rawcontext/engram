import { type JetStreamClient, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection, type Subscription } from "@nats-io/transport-node";
import type { Consumer, ConsumerConfig, Message, MessageClient, Producer } from "./interfaces";

// Re-export types
export type { Consumer, Message, Producer } from "./interfaces";

// =============================================================================
// Pub/Sub Types (for real-time updates, replaces Redis pub/sub)
// =============================================================================

export interface SessionUpdate {
	type:
		| "lineage"
		| "timeline"
		| "node_created"
		| "graph_node_created"
		| "session_created"
		| "session_updated"
		| "session_closed";
	sessionId: string;
	data: unknown;
	timestamp: number;
}

export interface ConsumerStatusUpdate {
	type: "consumer_ready" | "consumer_disconnected" | "consumer_heartbeat";
	groupId: string;
	serviceId: string;
	timestamp: number;
}

// Connection timeout for NATS pub/sub (5 seconds)
const NATS_CONNECT_TIMEOUT_MS = 5000;

// Subject mappings for pub/sub (Core NATS, not JetStream)
const PUBSUB_SUBJECTS = {
	sessionUpdates: (sessionId: string) => `observatory.session.${sessionId}.updates`,
	sessionsGlobal: "observatory.sessions.updates",
	consumersStatus: "observatory.consumers.status",
} as const;

export interface NatsPubSubPublisher {
	connect: () => Promise<void>;
	publishSessionUpdate: (
		sessionId: string,
		update: Omit<SessionUpdate, "sessionId" | "timestamp">,
	) => Promise<void>;
	publishGlobalSessionEvent: (
		eventType: "session_created" | "session_updated" | "session_closed",
		sessionData: unknown,
	) => Promise<void>;
	publishConsumerStatus: (
		eventType: "consumer_ready" | "consumer_disconnected" | "consumer_heartbeat",
		groupId: string,
		serviceId: string,
	) => Promise<void>;
	disconnect: () => Promise<void>;
}

export interface NatsPubSubSubscriber {
	connect: () => Promise<void>;
	subscribe: <T = SessionUpdate>(
		channelOrSessionId: string,
		callback: (message: T) => void,
	) => Promise<() => Promise<void>>;
	subscribeToConsumerStatus: (
		callback: (message: ConsumerStatusUpdate) => void,
	) => Promise<() => Promise<void>>;
	disconnect: () => Promise<void>;
}

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

// =============================================================================
// NATS Core Pub/Sub (for real-time WebSocket updates)
// =============================================================================

/**
 * Creates a NATS Core pub/sub publisher.
 * Uses ephemeral Core NATS (not JetStream) for real-time updates.
 * Matches the RedisPublisher interface for drop-in replacement.
 */
export function createNatsPubSubPublisher(): NatsPubSubPublisher {
	let nc: NatsConnection | null = null;
	let connectPromise: Promise<NatsConnection> | null = null;

	const ensureConnected = async (): Promise<NatsConnection> => {
		if (nc && !nc.isClosed()) return nc;

		if (connectPromise) {
			return connectPromise;
		}

		connectPromise = (async () => {
			try {
				const url = process.env.NATS_URL || "nats://localhost:4222";
				const newNc = await connect({ servers: url, timeout: NATS_CONNECT_TIMEOUT_MS });
				nc = newNc;
				console.log("[NATS PubSub Publisher] Connected");
				return newNc;
			} catch (err) {
				connectPromise = null;
				throw err;
			}
		})();

		try {
			const result = await connectPromise;
			return result;
		} finally {
			connectPromise = null;
		}
	};

	const pubsubConnect = async (): Promise<void> => {
		await ensureConnected();
	};

	const publishSessionUpdate = async (
		sessionId: string,
		update: Omit<SessionUpdate, "sessionId" | "timestamp">,
	): Promise<void> => {
		const conn = await ensureConnected();
		const subject = PUBSUB_SUBJECTS.sessionUpdates(sessionId);
		const message: SessionUpdate = {
			...update,
			sessionId,
			timestamp: Date.now(),
		};
		conn.publish(subject, JSON.stringify(message));
	};

	const publishGlobalSessionEvent = async (
		eventType: "session_created" | "session_updated" | "session_closed",
		sessionData: unknown,
	): Promise<void> => {
		const conn = await ensureConnected();
		const message: SessionUpdate = {
			type: eventType,
			sessionId: "",
			data: sessionData,
			timestamp: Date.now(),
		};
		conn.publish(PUBSUB_SUBJECTS.sessionsGlobal, JSON.stringify(message));
	};

	const publishConsumerStatus = async (
		eventType: "consumer_ready" | "consumer_disconnected" | "consumer_heartbeat",
		groupId: string,
		serviceId: string,
	): Promise<void> => {
		const conn = await ensureConnected();
		const message: ConsumerStatusUpdate = {
			type: eventType,
			groupId,
			serviceId,
			timestamp: Date.now(),
		};
		conn.publish(PUBSUB_SUBJECTS.consumersStatus, JSON.stringify(message));
	};

	const disconnect = async (): Promise<void> => {
		try {
			if (nc && !nc.isClosed()) {
				await nc.drain();
				await nc.close();
			}
		} finally {
			nc = null;
			connectPromise = null;
		}
	};

	return {
		connect: pubsubConnect,
		publishSessionUpdate,
		publishGlobalSessionEvent,
		publishConsumerStatus,
		disconnect,
	};
}

/**
 * Creates a NATS Core pub/sub subscriber.
 * Uses ephemeral Core NATS (not JetStream) for real-time updates.
 * Matches the Redis subscriber interface for drop-in replacement.
 */
export function createNatsPubSubSubscriber(): NatsPubSubSubscriber {
	let nc: NatsConnection | null = null;
	const subscriptions = new Map<
		string,
		{ sub: Subscription; callbacks: Set<(message: unknown) => void> }
	>();
	let subscriptionLock = Promise.resolve();

	const ensureConnected = async (): Promise<NatsConnection> => {
		if (nc && !nc.isClosed()) return nc;

		const url = process.env.NATS_URL || "nats://localhost:4222";
		nc = await connect({ servers: url, timeout: NATS_CONNECT_TIMEOUT_MS });
		console.log("[NATS PubSub Subscriber] Connected");
		return nc;
	};

	const subConnect = async (): Promise<void> => {
		await ensureConnected();
	};

	const subscribe = async <T = SessionUpdate>(
		channelOrSessionId: string,
		callback: (message: T) => void,
	): Promise<() => Promise<void>> => {
		await subscriptionLock;

		const operationPromise = (async () => {
			const conn = await ensureConnected();

			// Support both session-specific subjects and global subjects
			const subject = channelOrSessionId.includes(".")
				? channelOrSessionId // Already a full subject (e.g., "observatory.sessions.updates")
				: PUBSUB_SUBJECTS.sessionUpdates(channelOrSessionId); // Session ID, build subject

			// Track callbacks per subject
			if (!subscriptions.has(subject)) {
				const sub = conn.subscribe(subject);
				const callbacks = new Set<(message: unknown) => void>();
				subscriptions.set(subject, { sub, callbacks });

				// Process messages asynchronously
				(async () => {
					try {
						for await (const msg of sub) {
							try {
								const parsed = JSON.parse(msg.string()) as T;
								const entry = subscriptions.get(subject);
								if (entry) {
									for (const cb of entry.callbacks) {
										cb(parsed);
									}
								}
							} catch (e) {
								console.error("[NATS PubSub Subscriber] Failed to parse message:", e);
							}
						}
					} catch (e) {
						// Subscription closed or connection error
						if (!nc?.isClosed()) {
							console.error("[NATS PubSub Subscriber] Subscription error:", e);
						}
					}
				})();
			}

			subscriptions.get(subject)?.callbacks.add(callback as (message: unknown) => void);

			// Return unsubscribe function
			return async () => {
				await subscriptionLock;

				const unsubPromise = (async () => {
					const entry = subscriptions.get(subject);
					if (entry) {
						entry.callbacks.delete(callback as (message: unknown) => void);
						if (entry.callbacks.size === 0) {
							subscriptions.delete(subject);
							entry.sub.unsubscribe();
						}
					}
				})();

				subscriptionLock = unsubPromise.then(
					() => {},
					() => {},
				);
				await unsubPromise;
			};
		})();

		subscriptionLock = operationPromise.then(
			() => {},
			() => {},
		);
		return operationPromise;
	};

	const subscribeToConsumerStatus = async (
		callback: (message: ConsumerStatusUpdate) => void,
	): Promise<() => Promise<void>> => {
		return subscribe<ConsumerStatusUpdate>(PUBSUB_SUBJECTS.consumersStatus, callback);
	};

	const disconnect = async (): Promise<void> => {
		await subscriptionLock;

		const operationPromise = (async () => {
			try {
				// Unsubscribe from all subjects
				for (const [, entry] of subscriptions) {
					entry.sub.unsubscribe();
				}
				subscriptions.clear();

				if (nc && !nc.isClosed()) {
					await nc.drain();
					await nc.close();
				}
			} finally {
				nc = null;
				subscriptions.clear();
			}
		})();

		subscriptionLock = operationPromise.then(
			() => {},
			() => {},
		);
		await operationPromise;
	};

	return {
		connect: subConnect,
		subscribe,
		subscribeToConsumerStatus,
		disconnect,
	};
}
