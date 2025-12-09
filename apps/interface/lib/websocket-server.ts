import { createRequire } from "node:module";
import {
	createRedisSubscriber,
	type ConsumerStatusUpdate,
	type SessionUpdate,
} from "@engram/storage/redis";
import { WebSocket } from "ws";
import { getSessionLineage, getSessionsForWebSocket, getSessionTimeline } from "./graph-queries";

// Dynamic require for native Kafka module (avoids bundling issues)
const require = createRequire(import.meta.url);
const Kafka = require("@confluentinc/kafka-javascript");

const redisSubscriber = createRedisSubscriber();

// Separate subscriber for consumer status (Redis subscribers can only subscribe, not do other ops)
const consumerStatusSubscriber = createRedisSubscriber();

// Global channel for session list updates
const SESSIONS_CHANNEL = "sessions:updates";

export async function handleSessionConnection(ws: WebSocket, sessionId: string) {
	console.log(`[WS] Client connected to session ${sessionId}`);

	// Subscribe to Redis channel for real-time updates
	const unsubscribe = await redisSubscriber.subscribe(sessionId, (update: SessionUpdate) => {
		if (ws.readyState !== WebSocket.OPEN) return;

		// Forward the update to the WebSocket client
		ws.send(
			JSON.stringify({
				type: "update",
				data: update,
			}),
		);
	});

	// Send initial data
	try {
		const lineageData = await getSessionLineage(sessionId);
		if (lineageData.nodes.length > 0) {
			ws.send(JSON.stringify({ type: "lineage", data: lineageData }));
		}

		const timelineData = await getSessionTimeline(sessionId);
		if (timelineData.timeline.length > 0) {
			ws.send(JSON.stringify({ type: "replay", data: timelineData }));
		}
	} catch (error) {
		console.error("[WS] Initial fetch error:", error);
	}

	ws.on("close", async () => {
		console.log(`[WS] Client disconnected from session ${sessionId}`);
		await unsubscribe();
	});

	ws.on("message", async (message) => {
		try {
			const data = JSON.parse(message.toString());

			if (data.type === "refresh") {
				const lineageData = await getSessionLineage(sessionId);
				ws.send(JSON.stringify({ type: "lineage", data: lineageData }));

				const timelineData = await getSessionTimeline(sessionId);
				ws.send(JSON.stringify({ type: "replay", data: timelineData }));
			}
		} catch (e) {
			console.error("[WS] Invalid message", e);
		}
	});
}

export async function handleSessionsConnection(ws: WebSocket) {
	console.log("[WS] Client connected to sessions list");

	// Subscribe to global sessions channel for real-time updates
	const unsubscribe = await redisSubscriber.subscribe(SESSIONS_CHANNEL, (update: SessionUpdate) => {
		if (ws.readyState !== WebSocket.OPEN) return;

		ws.send(
			JSON.stringify({
				type: update.type,
				data: update.data,
			}),
		);
	});

	// Send initial session list
	try {
		const sessionsData = await getSessionsForWebSocket();
		ws.send(JSON.stringify({ type: "sessions", data: sessionsData }));
	} catch (error) {
		console.error("[WS] Initial sessions fetch error:", error);
		ws.send(JSON.stringify({ type: "error", message: "Failed to fetch sessions" }));
	}

	ws.on("close", async () => {
		console.log("[WS] Client disconnected from sessions list");
		await unsubscribe();
	});

	ws.on("message", async (message) => {
		try {
			const data = JSON.parse(message.toString());

			if (data.type === "refresh" || data.type === "subscribe") {
				const sessionsData = await getSessionsForWebSocket();
				ws.send(JSON.stringify({ type: "sessions", data: sessionsData }));
			}
		} catch (e) {
			console.error("[WS] Invalid message", e);
		}
	});
}

// =============================================================================
// Consumer Status WebSocket
// =============================================================================

/**
 * Consumer groups to monitor.
 */
const CONSUMER_GROUPS = ["ingestion-group", "memory-group", "search-group", "control-group"];

/**
 * Consumer group state from Kafka Admin API.
 */
const ConsumerGroupStates = {
	UNKNOWN: 0,
	PREPARING_REBALANCE: 1,
	COMPLETING_REBALANCE: 2,
	STABLE: 3,
	DEAD: 4,
	EMPTY: 5,
} as const;

type ConsumerGroupState = (typeof ConsumerGroupStates)[keyof typeof ConsumerGroupStates];

interface ConsumerGroupStatus {
	groupId: string;
	state: ConsumerGroupState;
	stateName: string;
	memberCount: number;
	isReady: boolean;
}

interface ConsumerStatusResponse {
	groups: ConsumerGroupStatus[];
	allReady: boolean;
	readyCount: number;
	totalCount: number;
	timestamp: number;
}

interface GroupDescription {
	groupId: string;
	state: ConsumerGroupState;
	members: unknown[];
	error?: { message: string };
}

type AdminClient = {
	connect: () => void;
	disconnect: () => void;
	describeGroups: (
		groupIds: string[],
		options: Record<string, unknown>,
		callback: (err: Error | null, descriptions: unknown) => void,
	) => void;
};

function getStateName(state: ConsumerGroupState): string {
	const names: Record<ConsumerGroupState, string> = {
		[ConsumerGroupStates.UNKNOWN]: "UNKNOWN",
		[ConsumerGroupStates.PREPARING_REBALANCE]: "PREPARING_REBALANCE",
		[ConsumerGroupStates.COMPLETING_REBALANCE]: "COMPLETING_REBALANCE",
		[ConsumerGroupStates.STABLE]: "STABLE",
		[ConsumerGroupStates.DEAD]: "DEAD",
		[ConsumerGroupStates.EMPTY]: "EMPTY",
	};
	return names[state] ?? "UNKNOWN";
}

function isGroupReady(description: GroupDescription): boolean {
	return description.state === ConsumerGroupStates.STABLE && description.members.length >= 1;
}

async function checkConsumerGroups(): Promise<ConsumerStatusResponse> {
	const brokers = process.env.REDPANDA_BROKERS || "localhost:19092";

	const admin: AdminClient = Kafka.AdminClient.create({
		"client.id": "consumer-ws-checker",
		"bootstrap.servers": brokers,
	});
	admin.connect();

	try {
		const result = await new Promise<unknown>((resolve, reject) => {
			admin.describeGroups(CONSUMER_GROUPS, { timeout: 5000 }, (err, res) => {
				if (err) reject(err);
				else resolve(res);
			});
		});

		// Handle different response formats
		let descriptions: GroupDescription[];
		if (Array.isArray(result)) {
			descriptions = result as GroupDescription[];
		} else if (result && typeof result === "object" && "groups" in result) {
			descriptions = (result as { groups: GroupDescription[] }).groups;
		} else {
			throw new Error(`Unexpected response format: ${typeof result}`);
		}

		const groups = descriptions.map((desc) => ({
			groupId: desc.groupId,
			state: desc.state,
			stateName: getStateName(desc.state),
			memberCount: desc.members?.length ?? 0,
			isReady: isGroupReady(desc),
		}));

		const readyCount = groups.filter((g) => g.isReady).length;

		return {
			groups,
			allReady: readyCount === groups.length,
			readyCount,
			totalCount: groups.length,
			timestamp: Date.now(),
		};
	} finally {
		admin.disconnect();
	}
}

function getUnknownStatus(): ConsumerStatusResponse {
	return {
		groups: CONSUMER_GROUPS.map((groupId) => ({
			groupId,
			state: 0 as ConsumerGroupState,
			stateName: "UNKNOWN",
			memberCount: 0,
			isReady: false,
		})),
		allReady: false,
		readyCount: 0,
		totalCount: CONSUMER_GROUPS.length,
		timestamp: Date.now(),
	};
}

// =============================================================================
// Consumer Status State Management (Event-Driven via Redis Pub/Sub)
// =============================================================================

/**
 * In-memory state for consumer groups, updated via Redis pub/sub events.
 * Services publish heartbeats every 10 seconds; if no heartbeat received
 * within 30 seconds, the consumer is considered offline.
 */
interface ConsumerState {
	groupId: string;
	serviceId: string;
	lastHeartbeat: number;
	isReady: boolean;
}

const consumerStates = new Map<string, ConsumerState>();
const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds without heartbeat = offline
const connectedConsumerClients = new Set<WebSocket>();

/**
 * Build current status response from in-memory state.
 */
function buildConsumerStatusResponse(): ConsumerStatusResponse {
	const now = Date.now();
	const groups: ConsumerGroupStatus[] = CONSUMER_GROUPS.map((groupId) => {
		const state = consumerStates.get(groupId);
		const isOnline = state && now - state.lastHeartbeat < HEARTBEAT_TIMEOUT_MS;

		return {
			groupId,
			state: isOnline ? ConsumerGroupStates.STABLE : ConsumerGroupStates.UNKNOWN,
			stateName: isOnline ? "STABLE" : "OFFLINE",
			memberCount: isOnline ? 1 : 0,
			isReady: !!isOnline,
		};
	});

	const readyCount = groups.filter((g) => g.isReady).length;

	return {
		groups,
		allReady: readyCount === groups.length,
		readyCount,
		totalCount: groups.length,
		timestamp: now,
	};
}

/**
 * Broadcast current status to all connected WebSocket clients.
 */
function broadcastConsumerStatus() {
	const status = buildConsumerStatusResponse();
	const message = JSON.stringify({ type: "status", data: status });

	for (const client of connectedConsumerClients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

/**
 * Handle incoming consumer status events from Redis pub/sub.
 */
function handleConsumerStatusEvent(event: ConsumerStatusUpdate) {
	const { type, groupId, serviceId, timestamp } = event;

	console.log(`[WS Consumer] Redis event: ${type} from ${groupId}/${serviceId}`);

	if (type === "consumer_ready" || type === "consumer_heartbeat") {
		consumerStates.set(groupId, {
			groupId,
			serviceId,
			lastHeartbeat: timestamp,
			isReady: true,
		});
		broadcastConsumerStatus();
	} else if (type === "consumer_disconnected") {
		consumerStates.delete(groupId);
		broadcastConsumerStatus();
	}
}

// Initialize Redis subscription for consumer status (runs once at module load)
let consumerStatusSubscriptionInitialized = false;

async function initConsumerStatusSubscription() {
	if (consumerStatusSubscriptionInitialized) return;
	consumerStatusSubscriptionInitialized = true;

	try {
		await consumerStatusSubscriber.subscribeToConsumerStatus(handleConsumerStatusEvent);
		console.log("[WS Consumer] Subscribed to Redis consumer status channel");
	} catch (error) {
		console.error("[WS Consumer] Failed to subscribe to Redis:", error);
		consumerStatusSubscriptionInitialized = false;
	}
}

// Start timeout checker - marks consumers offline if no heartbeat
setInterval(() => {
	const now = Date.now();
	let changed = false;

	for (const [groupId, state] of consumerStates) {
		if (now - state.lastHeartbeat >= HEARTBEAT_TIMEOUT_MS && state.isReady) {
			state.isReady = false;
			changed = true;
			console.log(`[WS Consumer] ${groupId} timed out (no heartbeat)`);
		}
	}

	if (changed) {
		broadcastConsumerStatus();
	}
}, 5000); // Check every 5 seconds

/**
 * Handle WebSocket connection for consumer status streaming.
 * Uses Redis pub/sub for true event-driven updates (no polling).
 */
export async function handleConsumerStatusConnection(ws: WebSocket) {
	console.log("[WS] Client connected to consumer status");

	// Ensure Redis subscription is active
	await initConsumerStatusSubscription();

	// Track this client
	connectedConsumerClients.add(ws);

	// Send current status immediately
	const status = buildConsumerStatusResponse();
	ws.send(JSON.stringify({ type: "status", data: status }));

	ws.on("close", () => {
		console.log("[WS] Client disconnected from consumer status");
		connectedConsumerClients.delete(ws);
	});

	ws.on("message", async (message) => {
		try {
			const data = JSON.parse(message.toString());
			if (data.type === "refresh") {
				// On refresh request, send current state
				const currentStatus = buildConsumerStatusResponse();
				ws.send(JSON.stringify({ type: "status", data: currentStatus }));
			}
		} catch (e) {
			console.error("[WS Consumer] Invalid message", e);
		}
	});
}
