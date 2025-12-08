import {
	createFalkorClient,
	type FalkorEdge,
	type FalkorNode,
	type SessionNode,
	type SessionProperties,
	type ThoughtNode,
} from "@engram/storage/falkor";
import { createRedisSubscriber, type SessionUpdate } from "@engram/storage/redis";
import { WebSocket } from "ws";

const falkor = createFalkorClient();
const redisSubscriber = createRedisSubscriber();

// Global channel for session list updates
const SESSIONS_CHANNEL = "sessions:updates";

// Typed query result interfaces
interface LineageRow {
	s?: SessionNode;
	path_nodes?: FalkorNode[];
	path_edges?: FalkorEdge[];
}

interface TimelineRow {
	t?: ThoughtNode;
}

interface SessionsRow {
	s?: SessionNode;
	eventCount?: number;
	lastEventAt?: number;
}

interface LineageNode {
	id: string;
	label: string;
	type?: string;
	[key: string]: unknown;
}

interface LineageLink {
	source: string;
	target: string;
	type: string;
	properties?: Record<string, unknown>;
}

export async function handleSessionConnection(ws: WebSocket, sessionId: string) {
	console.log(`[WS] Client connected to session ${sessionId}`);

	// Subscribe to Redis channel for real-time updates
	const unsubscribe = await redisSubscriber.subscribe(sessionId, (update: SessionUpdate) => {
		if (ws.readyState !== WebSocket.OPEN) return;

		// Forward the update to the WebSocket client
		// The client can handle incremental updates or request full refresh
		ws.send(
			JSON.stringify({
				type: "update",
				data: update,
			}),
		);
	});

	// Send initial data (one-time fetch)
	try {
		await falkor.connect();

		// Fetch initial lineage
		const lineageData = await getFullLineage(sessionId);
		if (lineageData.nodes.length > 0) {
			ws.send(JSON.stringify({ type: "lineage", data: lineageData }));
		}

		// Fetch initial timeline
		const timelineData = await getFullTimeline(sessionId);
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

			// Client can request a full refresh if needed
			if (data.type === "refresh") {
				await falkor.connect();
				const lineageData = await getFullLineage(sessionId);
				ws.send(JSON.stringify({ type: "lineage", data: lineageData }));

				const timelineData = await getFullTimeline(sessionId);
				ws.send(JSON.stringify({ type: "replay", data: timelineData }));
			}
		} catch (e) {
			console.error("[WS] Invalid message", e);
		}
	});
}

// Helpers to fetch full data
async function getFullLineage(sessionId: string) {
	const query = `
      MATCH (s:Session {id: $sessionId})
      OPTIONAL MATCH p = (s)-[:TRIGGERS|NEXT*0..100]->(n)
      RETURN s, nodes(p) as path_nodes, relationships(p) as path_edges
    `;
	const res = await falkor.query<LineageRow>(query, { sessionId });

	const internalIdToUuid = new Map<number, string>();
	const nodes: LineageNode[] = [];
	const links: LineageLink[] = [];

	if (res && Array.isArray(res)) {
		for (const row of res) {
			const sessionNode = row.s;
			if (sessionNode) {
				const uuid = sessionNode.properties?.id as string | undefined;
				if (uuid) {
					internalIdToUuid.set(sessionNode.id, uuid);
					if (!nodes.find((n) => n.id === uuid)) {
						nodes.push({ ...sessionNode.properties, id: uuid, label: "Session", type: "session" });
					}
				}
			}

			const pathNodes = row.path_nodes;
			if (Array.isArray(pathNodes)) {
				for (const n of pathNodes) {
					if (n) {
						const uuid = n.properties?.id as string | undefined;
						if (uuid) {
							internalIdToUuid.set(n.id, uuid);
							if (!nodes.find((x) => x.id === uuid)) {
								const label = n.labels?.[0] || "Unknown";
								nodes.push({ ...n.properties, id: uuid, label, type: label.toLowerCase() });
							}
						}
					}
				}
			}
		}

		// Now process edges
		for (const row of res) {
			const pathEdges = row.path_edges;
			if (Array.isArray(pathEdges)) {
				for (const e of pathEdges) {
					if (e) {
						const sourceUuid = internalIdToUuid.get(e.sourceId || e.srcNodeId);
						const targetUuid = internalIdToUuid.get(e.destinationId || e.destNodeId);

						if (sourceUuid && targetUuid) {
							links.push({
								source: sourceUuid,
								target: targetUuid,
								type: e.relationshipType || e.relation || "",
								properties: e.properties,
							});
						}
					}
				}
			}
		}
	}

	return {
		nodes,
		links,
	};
}

async function getFullTimeline(sessionId: string) {
	const cypher = `
        MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)
        RETURN t
        ORDER BY t.vt_start ASC
    `;
	const result = await falkor.query<TimelineRow>(cypher, { sessionId });
	const timeline: Record<string, unknown>[] = [];
	if (Array.isArray(result)) {
		for (const row of result) {
			const node = row.t;
			if (node && node.properties) {
				timeline.push({ ...node.properties, id: node.properties.id, type: "thought" });
			}
		}
	}
	return { timeline };
}

// Fetch all sessions for the homepage
async function getAllSessions(limit = 50) {
	const cypher = `
        MATCH (s:Session)
        OPTIONAL MATCH (s)-[:TRIGGERS]->(n)
        WITH s, count(n) as eventCount, max(n.vt_start) as lastEventAt
        RETURN s, eventCount, lastEventAt
        ORDER BY COALESCE(s.started_at, s.startedAt, s.lastEventAt) DESC
        LIMIT $limit
    `;
	const result = await falkor.query<SessionsRow>(cypher, { limit });

	interface SessionItem {
		id: string;
		title?: string | null;
		userId: string;
		startedAt: number;
		lastEventAt: number;
		eventCount: number;
		preview?: string | null;
		isActive: boolean;
	}

	const active: SessionItem[] = [];
	const recent: SessionItem[] = [];
	const now = Date.now();
	const activeThreshold = 5 * 60 * 1000; // 5 minutes

	if (Array.isArray(result)) {
		for (const row of result) {
			const node = row.s;
			if (node && node.properties) {
				const props = node.properties;
				const sessionStartedAt = props.started_at ?? now;
				const sessionLastEventAt = props.last_event_at ?? row.lastEventAt ?? sessionStartedAt;
				const isActive = now - sessionLastEventAt < activeThreshold;

				const session = {
					id: props.id,
					title: props.title ?? null,
					userId: props.user_id ?? "unknown",
					startedAt: sessionStartedAt,
					lastEventAt: sessionLastEventAt,
					eventCount: row.eventCount ?? 0,
					preview: props.preview ?? null,
					isActive,
				};

				if (isActive) {
					active.push(session);
				} else {
					recent.push(session);
				}
			}
		}
	}

	return { active, recent };
}

// Handle global sessions list WebSocket connection
export async function handleSessionsConnection(ws: WebSocket) {
	console.log("[WS] Client connected to sessions list");

	// Subscribe to global sessions channel for real-time updates
	const unsubscribe = await redisSubscriber.subscribe(SESSIONS_CHANNEL, (update: SessionUpdate) => {
		if (ws.readyState !== WebSocket.OPEN) return;

		// Forward session events to the WebSocket client
		// The update.type will be 'session_created', 'session_updated', or 'session_closed'
		ws.send(
			JSON.stringify({
				type: update.type,
				data: update.data,
			}),
		);
	});

	// Send initial session list
	try {
		await falkor.connect();
		const sessionsData = await getAllSessions();
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

			// Client can request a full refresh
			if (data.type === "refresh" || data.type === "subscribe") {
				await falkor.connect();
				const sessionsData = await getAllSessions();
				ws.send(JSON.stringify({ type: "sessions", data: sessionsData }));
			}
		} catch (e) {
			console.error("[WS] Invalid message", e);
		}
	});
}
