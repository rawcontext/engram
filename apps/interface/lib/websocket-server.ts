import { createRequire } from "node:module";
import { createRedisSubscriber, type SessionUpdate } from "@engram/storage/redis";
import { WebSocket } from "ws";
import { getSessionLineage, getSessionsForWebSocket, getSessionTimeline } from "./graph-queries";

// Dynamic require for native Kafka module (avoids bundling issues)
const require = createRequire(import.meta.url);
const Kafka = require("@confluentinc/kafka-javascript");

const redisSubscriber = createRedisSubscriber();

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

/**
 * Handle WebSocket connection for consumer status streaming.
 * Polls Kafka Admin API every 3 seconds and pushes updates to clients.
 */
export async function handleConsumerStatusConnection(ws: WebSocket) {
	console.log("[WS] Client connected to consumer status");

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let lastStatus: string | null = null;

	const sendStatus = async () => {
		if (ws.readyState !== WebSocket.OPEN) return;

		try {
			const status = await checkConsumerGroups();
			const statusJson = JSON.stringify({ type: "status", data: status });

			// Only send if status changed (to reduce noise)
			if (statusJson !== lastStatus) {
				ws.send(statusJson);
				lastStatus = statusJson;
			}
		} catch (error) {
			console.error("[WS Consumer] Error fetching status:", error);
			// Send unknown status on error
			const unknownStatus = getUnknownStatus();
			ws.send(JSON.stringify({ type: "status", data: unknownStatus }));
		}
	};

	// Send initial status immediately
	await sendStatus();

	// Poll every 3 seconds
	intervalId = setInterval(sendStatus, 3000);

	ws.on("close", () => {
		console.log("[WS] Client disconnected from consumer status");
		if (intervalId) {
			clearInterval(intervalId);
		}
	});

	ws.on("message", async (message) => {
		try {
			const data = JSON.parse(message.toString());
			if (data.type === "refresh") {
				await sendStatus();
			}
		} catch (e) {
			console.error("[WS Consumer] Invalid message", e);
		}
	});
}
