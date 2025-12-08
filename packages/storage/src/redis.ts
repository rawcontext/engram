import { createClient, type RedisClientType } from "redis";

function getRedisUrl(): string {
	const url = process.env.REDIS_URL;
	if (!url) {
		throw new Error("REDIS_URL environment variable is required");
	}
	return url;
}

export interface SessionUpdate {
	type: "lineage" | "timeline" | "node_created";
	sessionId: string;
	data: unknown;
	timestamp: number;
}

export function createRedisPublisher() {
	let client: RedisClientType | null = null;
	let connecting = false;

	const connect = async () => {
		if (client?.isOpen) return client;
		if (connecting) {
			// Wait for existing connection attempt
			while (connecting) {
				await new Promise((r) => setTimeout(r, 50));
			}
			return client!;
		}

		connecting = true;
		try {
			client = createClient({ url: getRedisUrl() });
			client.on("error", (err) => console.error("[Redis Publisher] Error:", err));
			await client.connect();
			console.log("[Redis Publisher] Connected");
			return client;
		} finally {
			connecting = false;
		}
	};

	const publishSessionUpdate = async (sessionId: string, update: Omit<SessionUpdate, "sessionId" | "timestamp">) => {
		const conn = await connect();
		const channel = `session:${sessionId}:updates`;
		const message: SessionUpdate = {
			...update,
			sessionId,
			timestamp: Date.now(),
		};
		await conn.publish(channel, JSON.stringify(message));
	};

	const disconnect = async () => {
		if (client?.isOpen) {
			await client.quit();
			client = null;
		}
	};

	return {
		connect,
		publishSessionUpdate,
		disconnect,
	};
}

export function createRedisSubscriber() {
	let client: RedisClientType | null = null;
	const subscriptions = new Map<string, Set<(message: SessionUpdate) => void>>();

	const connect = async () => {
		if (client?.isOpen) return client;

		client = createClient({ url: getRedisUrl() });
		client.on("error", (err) => console.error("[Redis Subscriber] Error:", err));
		await client.connect();
		console.log("[Redis Subscriber] Connected");
		return client;
	};

	const subscribe = async (sessionId: string, callback: (message: SessionUpdate) => void) => {
		const conn = await connect();
		const channel = `session:${sessionId}:updates`;

		// Track callbacks per channel
		if (!subscriptions.has(channel)) {
			subscriptions.set(channel, new Set());

			// Subscribe to the channel (only once per channel)
			await conn.subscribe(channel, (message) => {
				try {
					const parsed = JSON.parse(message) as SessionUpdate;
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

		subscriptions.get(channel)!.add(callback);

		// Return unsubscribe function
		return async () => {
			const callbacks = subscriptions.get(channel);
			if (callbacks) {
				callbacks.delete(callback);
				if (callbacks.size === 0) {
					subscriptions.delete(channel);
					await conn.unsubscribe(channel);
				}
			}
		};
	};

	const disconnect = async () => {
		if (client?.isOpen) {
			// Unsubscribe from all channels
			for (const channel of subscriptions.keys()) {
				await client.unsubscribe(channel);
			}
			subscriptions.clear();
			await client.quit();
			client = null;
		}
	};

	return {
		connect,
		subscribe,
		disconnect,
	};
}
