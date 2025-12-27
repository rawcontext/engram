import {
	type ConsumerStatusUpdate,
	createNatsPubSubSubscriber,
	type SessionUpdate,
} from "@engram/storage/nats";
import { WebSocket } from "ws";
import { getSessionLineage, getSessionsForWebSocket, getSessionTimeline } from "./graph-queries";

const natsSubscriber = createNatsPubSubSubscriber();

// Separate subscriber for consumer status
const consumerStatusSubscriber = createNatsPubSubSubscriber();

// Global subject for session list updates (NATS uses dot notation)
const SESSIONS_SUBJECT = "observatory.sessions.updates";

export async function handleSessionConnection(ws: WebSocket, sessionId: string) {
	console.log(`[WS] Client connected to session ${sessionId}`);

	// Subscribe to NATS subject for real-time updates
	const unsubscribe = await natsSubscriber.subscribe(sessionId, (update: SessionUpdate) => {
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

	// Subscribe to global sessions subject for real-time updates
	const unsubscribe = await natsSubscriber.subscribe(SESSIONS_SUBJECT, (update: SessionUpdate) => {
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
 * Consumer group state from NATS JetStream.
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

// =============================================================================
// Consumer Status State Management (Event-Driven via NATS Pub/Sub)
// =============================================================================

/**
 * In-memory state for consumer groups, updated via NATS pub/sub events.
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
 * Handle incoming consumer status events from NATS pub/sub.
 */
function handleConsumerStatusEvent(event: ConsumerStatusUpdate) {
	const { type, groupId, serviceId, timestamp } = event;

	console.log(`[WS Consumer] NATS event: ${type} from ${groupId}/${serviceId}`);

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

// Initialize NATS subscription for consumer status (runs once at module load)
let consumerStatusSubscriptionInitialized = false;

async function initConsumerStatusSubscription() {
	if (consumerStatusSubscriptionInitialized) return;
	consumerStatusSubscriptionInitialized = true;

	try {
		await consumerStatusSubscriber.subscribeToConsumerStatus(handleConsumerStatusEvent);
		console.log("[WS Consumer] Subscribed to NATS consumer status subject");
	} catch (error) {
		console.error("[WS Consumer] Failed to subscribe to NATS:", error);
		consumerStatusSubscriptionInitialized = false;
	}
}

// Start timeout checker - marks consumers offline if no heartbeat
// Store interval ID for cleanup during HMR
let timeoutCheckerInterval: NodeJS.Timeout | null = null;

function startTimeoutChecker() {
	// Clear existing interval if present (HMR support)
	if (timeoutCheckerInterval) {
		clearInterval(timeoutCheckerInterval);
	}

	timeoutCheckerInterval = setInterval(() => {
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
}

// Start the timeout checker
startTimeoutChecker();

// Export cleanup function for HMR/testing
export function cleanupWebSocketServer(): void {
	if (timeoutCheckerInterval) {
		clearInterval(timeoutCheckerInterval);
		timeoutCheckerInterval = null;
	}
	connectedConsumerClients.clear();
	consumerStates.clear();
	consumerStatusSubscriptionInitialized = false;
}

/**
 * Handle WebSocket connection for consumer status streaming.
 * Uses NATS pub/sub for true event-driven updates (no polling).
 */
export async function handleConsumerStatusConnection(ws: WebSocket) {
	console.log("[WS] Client connected to consumer status");

	// Track this client
	connectedConsumerClients.add(ws);

	// Send current status immediately (before NATS subscription)
	// This ensures the client gets a response even if NATS is unavailable
	const status = buildConsumerStatusResponse();
	ws.send(JSON.stringify({ type: "status", data: status }));

	// Start NATS subscription in background (non-blocking)
	// Don't await - let it connect asynchronously
	initConsumerStatusSubscription().catch((err) => {
		console.error("[WS Consumer] Background NATS subscription failed:", err);
	});

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
