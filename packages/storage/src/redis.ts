import { createClient, type RedisClientType } from "redis";

function getRedisUrl(): string {
	const url = process.env.REDIS_URL;
	if (!url) {
		throw new Error("REDIS_URL environment variable is required");
	}
	return url;
}

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

// Global channel for homepage session list updates
const SESSIONS_CHANNEL = "sessions:updates";

// Global channel for consumer status updates
const CONSUMERS_CHANNEL = "consumers:status";

export function createRedisPublisher() {
	let client: ReturnType<typeof createClient> | null = null;
	let connectPromise: Promise<ReturnType<typeof createClient>> | null = null;

	const connect = async () => {
		// Return existing open client
		if (client?.isOpen) return client;

		// If already connecting, wait for that attempt
		if (connectPromise) {
			return connectPromise;
		}

		// Start new connection attempt
		connectPromise = (async () => {
			try {
				const newClient = createClient({ url: getRedisUrl() });
				newClient.on("error", (err) => console.error("[Redis Publisher] Error:", err));
				await newClient.connect();
				client = newClient;
				console.log("[Redis Publisher] Connected");
				return newClient;
			} catch (err) {
				// Reset state on failure so next call can retry
				connectPromise = null;
				throw err;
			}
		})();

		try {
			const result = await connectPromise;
			return result;
		} finally {
			// Clear promise after completion (success or failure)
			connectPromise = null;
		}
	};

	const publishSessionUpdate = async (
		sessionId: string,
		update: Omit<SessionUpdate, "sessionId" | "timestamp">,
	) => {
		const conn = await connect();
		const channel = `session:${sessionId}:updates`;
		const message: SessionUpdate = {
			...update,
			sessionId,
			timestamp: Date.now(),
		};
		await conn.publish(channel, JSON.stringify(message));
	};

	// Publish to the global sessions channel for homepage updates
	const publishGlobalSessionEvent = async (
		eventType: "session_created" | "session_updated" | "session_closed",
		sessionData: unknown,
	) => {
		const conn = await connect();
		const message: SessionUpdate = {
			type: eventType,
			sessionId: "", // Global event, not tied to specific session
			data: sessionData,
			timestamp: Date.now(),
		};
		await conn.publish(SESSIONS_CHANNEL, JSON.stringify(message));
	};

	// Publish consumer status event (ready/disconnected/heartbeat)
	const publishConsumerStatus = async (
		eventType: "consumer_ready" | "consumer_disconnected" | "consumer_heartbeat",
		groupId: string,
		serviceId: string,
	) => {
		const conn = await connect();
		const message: ConsumerStatusUpdate = {
			type: eventType,
			groupId,
			serviceId,
			timestamp: Date.now(),
		};
		await conn.publish(CONSUMERS_CHANNEL, JSON.stringify(message));
	};

	const disconnect = async () => {
		try {
			if (client?.isOpen) {
				await client.quit();
			}
		} finally {
			client = null;
			connectPromise = null;
		}
	};

	return {
		connect,
		publishSessionUpdate,
		publishGlobalSessionEvent,
		publishConsumerStatus,
		disconnect,
	};
}

// Type for RedisPublisher return
export type RedisPublisher = ReturnType<typeof createRedisPublisher>;

export function createRedisSubscriber() {
	let client: RedisClientType | null = null;
	const subscriptions = new Map<string, Set<(message: unknown) => void>>();
	let subscriptionLock = Promise.resolve();

	const connect = async () => {
		if (client?.isOpen) return client;

		client = createClient({ url: getRedisUrl() });
		client.on("error", (err) => console.error("[Redis Subscriber] Error:", err));
		await client.connect();
		console.log("[Redis Subscriber] Connected");
		return client;
	};

	const subscribe = async <T = SessionUpdate>(
		channelOrSessionId: string,
		callback: (message: T) => void,
	) => {
		// Synchronize subscription operations to prevent race conditions
		await subscriptionLock;

		const operationPromise = (async () => {
			const conn = await connect();
			// Support both session-specific channels and global channels
			const channel = channelOrSessionId.includes(":")
				? channelOrSessionId // Already a full channel name (e.g., "sessions:updates")
				: `session:${channelOrSessionId}:updates`; // Session ID, build channel name

			// Track callbacks per channel
			if (!subscriptions.has(channel)) {
				subscriptions.set(channel, new Set());

				// Subscribe to the channel (only once per channel)
				await conn.subscribe(channel, (message) => {
					try {
						const parsed = JSON.parse(message) as T;
						const callbacks = subscriptions.get(channel);
						if (callbacks) {
							for (const cb of callbacks) {
								cb(parsed);
							}
						}
					} catch (e) {
						console.error("[Redis Subscriber] Failed to parse message:", e);
					}
				});
			}

			subscriptions.get(channel)?.add(callback as (message: unknown) => void);

			// Return unsubscribe function
			return async () => {
				// Synchronize unsubscribe operations as well
				await subscriptionLock;

				const unsubPromise = (async () => {
					const callbacks = subscriptions.get(channel);
					if (callbacks) {
						callbacks.delete(callback as (message: unknown) => void);
						if (callbacks.size === 0) {
							subscriptions.delete(channel);
							await conn.unsubscribe(channel);
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

	// Subscribe specifically to consumer status updates
	const subscribeToConsumerStatus = async (callback: (message: ConsumerStatusUpdate) => void) => {
		return subscribe<ConsumerStatusUpdate>(CONSUMERS_CHANNEL, callback);
	};

	const disconnect = async () => {
		// Synchronize disconnect to prevent race conditions
		await subscriptionLock;

		const operationPromise = (async () => {
			try {
				if (client?.isOpen) {
					// Unsubscribe from all channels
					for (const channel of subscriptions.keys()) {
						await client.unsubscribe(channel);
					}
					subscriptions.clear();
					await client.quit();
				}
			} finally {
				client = null;
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
		connect,
		subscribe,
		subscribeToConsumerStatus,
		disconnect,
	};
}
