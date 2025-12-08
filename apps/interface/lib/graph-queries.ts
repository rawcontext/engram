import {
	createFalkorClient,
	type FalkorEdge,
	type FalkorNode,
	type SessionNode,
} from "@engram/storage/falkor";

// Singleton FalkorDB client
const falkor = createFalkorClient();

// =============================================================================
// Type Definitions
// =============================================================================

// Explicit node structure from list comprehension
interface PathNodeExplicit {
	nodeId: number;
	nodeLabels: string[];
	nodeProps: Record<string, unknown>;
}

interface LineageRow {
	s?: SessionNode;
	path_nodes?: PathNodeExplicit[];
	path_edges?: FalkorEdge[];
}

interface SessionsRow {
	s?: SessionNode;
	eventCount?: number;
	lastEventAt?: number;
}

interface CountRow {
	cnt?: number;
	[key: number]: number | undefined;
}

interface PreviewRow {
	preview?: string;
	[key: number]: string | undefined;
}

interface TotalRow {
	total?: number;
	[key: number]: number | undefined;
}

export interface LineageNode {
	id: string;
	label: string;
	type?: string;
	[key: string]: unknown;
}

export interface LineageLink {
	source: string;
	target: string;
	type: string;
	properties?: Record<string, unknown>;
}

export interface LineageData {
	nodes: LineageNode[];
	links: LineageLink[];
}

export interface TimelineEvent {
	id: string;
	type: string;
	[key: string]: unknown;
}

export interface TimelineData {
	timeline: TimelineEvent[];
}

export interface SessionListItem {
	id: string;
	title: string | null;
	userId: string;
	startedAt: number;
	lastEventAt: number | null;
	eventCount: number;
	preview: string | null;
	isActive: boolean;
}

export interface SessionsData {
	active: SessionListItem[];
	recent: SessionListItem[];
	sessions: SessionListItem[];
	pagination?: {
		total: number;
		limit: number;
		offset: number;
		hasMore: boolean;
	};
}

// =============================================================================
// Edge Types (centralized constants)
// =============================================================================

/**
 * Edge types used in the Turn-based graph structure:
 * - HAS_TURN: Session -> Turn
 * - NEXT: Turn -> Turn (sequential linking)
 * - CONTAINS: Turn -> Reasoning
 * - INVOKES: Turn -> ToolCall
 * - TRIGGERS: Reasoning -> ToolCall (causal link)
 * - YIELDS: ToolCall -> Observation
 *
 * Note: File operations are stored as properties on ToolCall nodes (file_path, file_action)
 */
export const EDGE_TYPES = {
	HAS_TURN: "HAS_TURN",
	NEXT: "NEXT",
	CONTAINS: "CONTAINS",
	INVOKES: "INVOKES",
	TRIGGERS: "TRIGGERS",
	YIELDS: "YIELDS",
} as const;

// Combined edge pattern for path traversal (includes all lineage edges)
const LINEAGE_EDGE_PATTERN = "[:HAS_TURN|CONTAINS|INVOKES|TRIGGERS|YIELDS|NEXT*0..100]";

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get full lineage graph for a session
 * Returns all Turn, Reasoning, ToolCall, and Observation nodes connected to the session
 * Lineage: Reasoning -[TRIGGERS]-> ToolCall (file_path stored on ToolCall)
 */
export async function getSessionLineage(sessionId: string): Promise<LineageData> {
	await falkor.connect();

	// Query 1: Get the session and all connected nodes via path traversal
	// Note: We use list comprehension with labels() and properties() to ensure correct parsing
	// The FalkorDB JS client can misparse node labels from raw path node extraction
	const query = `
		MATCH (s:Session {id: $sessionId})
		OPTIONAL MATCH p = (s)-${LINEAGE_EDGE_PATTERN}->(n)
		RETURN s,
			[node in nodes(p) | {nodeId: id(node), nodeLabels: labels(node), nodeProps: properties(node)}] as path_nodes,
			relationships(p) as path_edges
	`;

	const res = await falkor.query<LineageRow>(query, { sessionId });

	// Query 2: Explicitly get HAS_TURN edges (path traversal may miss these in edge extraction)
	const hasTurnQuery = `
		MATCH (s:Session {id: $sessionId})-[r:HAS_TURN]->(t:Turn)
		RETURN s.id as sourceId, t.id as targetId, type(r) as relType
	`;
	const hasTurnRes = await falkor.query<{ sourceId: string; targetId: string; relType: string }>(
		hasTurnQuery,
		{ sessionId },
	);

	// Query 3: Explicitly get INVOKES edges (Turn -> ToolCall)
	const invokesQuery = `
		MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[r:INVOKES]->(tc:ToolCall)
		RETURN t.id as sourceId, tc.id as targetId, type(r) as relType
	`;
	const invokesRes = await falkor.query<{ sourceId: string; targetId: string; relType: string }>(
		invokesQuery,
		{ sessionId },
	);

	// Query 4: Explicitly get TRIGGERS edges (Reasoning -> ToolCall)
	const triggersQuery = `
		MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[:CONTAINS]->(r:Reasoning)-[e:TRIGGERS]->(tc:ToolCall)
		RETURN r.id as sourceId, tc.id as targetId, type(e) as relType
	`;
	const triggersRes = await falkor.query<{ sourceId: string; targetId: string; relType: string }>(
		triggersQuery,
		{ sessionId },
	);

	const internalIdToUuid = new Map<number, string>();
	const nodesMap = new Map<string, LineageNode>();
	const links: LineageLink[] = [];

	// Use a Set to track unique edges (prevent duplicates from multiple paths)
	const seenEdges = new Set<string>();

	if (res && Array.isArray(res)) {
		// First pass: collect all nodes
		for (const row of res) {
			// Session node
			const sessionNode = row.s;
			if (sessionNode) {
				const uuid = sessionNode.properties?.id as string | undefined;
				if (uuid) {
					internalIdToUuid.set(sessionNode.id, uuid);
					if (!nodesMap.has(uuid)) {
						nodesMap.set(uuid, {
							...sessionNode.properties,
							id: uuid,
							label: "Session",
							type: "session",
						});
					}
				}
			}

			// Path nodes - using explicit structure from list comprehension
			// Each node is: {nodeId: id(node), nodeLabels: labels(node), nodeProps: properties(node)}
			const pathNodes = row.path_nodes;
			if (Array.isArray(pathNodes)) {
				for (const n of pathNodes) {
					if (n && n.nodeProps) {
						const uuid = n.nodeProps.id as string | undefined;
						if (uuid) {
							internalIdToUuid.set(n.nodeId, uuid);
							if (!nodesMap.has(uuid)) {
								const label = n.nodeLabels?.[0] || "Unknown";
								nodesMap.set(uuid, {
									...n.nodeProps,
									id: uuid,
									label,
									type: label.toLowerCase(),
								});
							}
						}
					}
				}
			}
		}

		// Second pass: collect edges (deduplicated)
		for (const row of res) {
			const pathEdges = row.path_edges;
			if (Array.isArray(pathEdges)) {
				for (const e of pathEdges) {
					if (e) {
						const sourceUuid = internalIdToUuid.get(e.sourceId || e.srcNodeId);
						const targetUuid = internalIdToUuid.get(e.destinationId || e.destNodeId);
						const edgeType = e.relationshipType || e.relation || e.type || "";

						if (sourceUuid && targetUuid) {
							// Create unique key for edge deduplication
							const edgeKey = `${sourceUuid}->${targetUuid}:${edgeType}`;
							if (!seenEdges.has(edgeKey)) {
								seenEdges.add(edgeKey);
								links.push({
									source: sourceUuid,
									target: targetUuid,
									type: edgeType,
									properties: e.properties,
								});
							}
						}
					}
				}
			}
		}
	}

	// Helper to add edges from explicit queries
	const addExplicitEdges = (
		results: { sourceId: string; targetId: string; relType: string }[] | undefined,
		defaultType: string,
	) => {
		if (results && Array.isArray(results)) {
			for (const row of results) {
				const sourceId = row.sourceId;
				const targetId = row.targetId;
				const edgeType = row.relType || defaultType;

				if (sourceId && targetId) {
					const edgeKey = `${sourceId}->${targetId}:${edgeType}`;
					if (!seenEdges.has(edgeKey)) {
						seenEdges.add(edgeKey);
						links.push({
							source: sourceId,
							target: targetId,
							type: edgeType,
							properties: {},
						});
					}
				}
			}
		}
	};

	// Add explicit edges (these may be missed by path traversal edge extraction)
	addExplicitEdges(hasTurnRes, "HAS_TURN");
	addExplicitEdges(invokesRes, "INVOKES");
	addExplicitEdges(triggersRes, "TRIGGERS");

	return {
		nodes: Array.from(nodesMap.values()),
		links,
	};
}

/**
 * Get timeline of events for a session (Turns, Reasoning, and ToolCall nodes)
 * Returns a flat timeline that SessionReplay can process
 * File operations are stored as properties on ToolCall nodes (file_path, file_action)
 */
export async function getSessionTimeline(sessionId: string): Promise<TimelineData> {
	await falkor.connect();

	// Query 1: Get Turns
	const turnsQuery = `
		MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
		RETURN t
		ORDER BY t.sequence_index ASC
	`;
	const turnsResult = await falkor.query<{ t?: FalkorNode }>(turnsQuery, { sessionId });

	// Query 2: Get all Reasoning nodes for this session's Turns
	const reasoningQuery = `
		MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[:CONTAINS]->(r:Reasoning)
		RETURN t.id as turnId, r
		ORDER BY t.sequence_index ASC, r.sequence_index ASC
	`;
	const reasoningResult = await falkor.query<{ turnId?: string; r?: FalkorNode }>(reasoningQuery, {
		sessionId,
	});

	// Query 3: Get all ToolCall nodes for this session's Turns
	const toolCallQuery = `
		MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)-[:INVOKES]->(tc:ToolCall)
		RETURN t.id as turnId, tc
		ORDER BY t.sequence_index ASC, tc.sequence_index ASC
	`;
	const toolCallResult = await falkor.query<{ turnId?: string; tc?: FalkorNode }>(toolCallQuery, {
		sessionId,
	});

	// Build maps of turnId -> child nodes
	const reasoningByTurn = new Map<string, FalkorNode[]>();
	if (Array.isArray(reasoningResult)) {
		for (const row of reasoningResult) {
			const turnId = row.turnId;
			const reasoning = row.r;
			if (turnId && reasoning) {
				const list = reasoningByTurn.get(turnId) || [];
				list.push(reasoning);
				reasoningByTurn.set(turnId, list);
			}
		}
	}

	const toolCallByTurn = new Map<string, FalkorNode[]>();
	if (Array.isArray(toolCallResult)) {
		for (const row of toolCallResult) {
			const turnId = row.turnId;
			const toolCall = row.tc;
			if (turnId && toolCall) {
				const list = toolCallByTurn.get(turnId) || [];
				list.push(toolCall);
				toolCallByTurn.set(turnId, list);
			}
		}
	}

	const timeline: TimelineEvent[] = [];
	let turnIndex = 0;

	if (Array.isArray(turnsResult)) {
		for (const row of turnsResult) {
			const turn = row.t;
			if (!turn?.properties) continue;

			const props = turn.properties;
			const turnId = props.id as string;
			const vtStart = props.vt_start as number;
			const timestamp = vtStart ? new Date(vtStart).toISOString() : new Date().toISOString();
			turnIndex++;

			// Add turn header event
			timeline.push({
				id: `${turnId}-header`,
				type: "turn",
				content: `Turn ${turnIndex}`,
				timestamp,
				turnIndex,
				graphNodeId: turnId, // Actual graph node ID for highlighting
			});

			// Add user query event
			const userContent = props.user_content as string;
			if (userContent) {
				timeline.push({
					id: `${turnId}-query`,
					type: "thought",
					content: userContent,
					timestamp,
				});
			}

			// Add reasoning events (thinking blocks)
			const reasoningNodes = reasoningByTurn.get(turnId) || [];
			for (const r of reasoningNodes) {
				if (r?.properties) {
					// Reasoning nodes use 'preview' property for content
					const content = (r.properties.preview || r.properties.content) as string;
					if (content) {
						timeline.push({
							id: (r.properties.id as string) || `${turnId}-reasoning`,
							type: "thought",
							content: `<thinking>${content}</thinking>`,
							timestamp,
						});
					}
				}
			}

			// Add toolcall events (tool invocations with optional file info)
			const toolCallNodes = toolCallByTurn.get(turnId) || [];
			for (const tc of toolCallNodes) {
				if (tc?.properties) {
					const toolName = tc.properties.tool_name as string;
					const toolType = tc.properties.tool_type as string;
					const status = tc.properties.status as string;
					const argsPreview = tc.properties.arguments_preview as string;
					const filePath = tc.properties.file_path as string | null;
					const fileAction = tc.properties.file_action as string | null;
					if (toolName) {
						timeline.push({
							id: (tc.properties.id as string) || `${turnId}-toolcall`,
							type: "toolcall",
							content: toolName,
							timestamp,
							toolName,
							toolType,
							toolStatus: status,
							argumentsPreview: argsPreview,
							filePath,
							fileAction,
							graphNodeId: tc.properties.id as string,
						});
					}
				}
			}

			// Add assistant response event
			const assistantPreview = props.assistant_preview as string;
			if (assistantPreview) {
				timeline.push({
					id: `${turnId}-response`,
					type: "response",
					content: assistantPreview,
					timestamp,
					tokenCount: (props.output_tokens as number) || 0,
					graphNodeId: turnId, // Actual graph node ID for highlighting
				});
			}
		}
	}

	return { timeline };
}

/**
 * Get all sessions with metadata
 */
export async function getAllSessions(options: {
	limit?: number;
	offset?: number;
	activeThresholdMs?: number;
}): Promise<SessionsData> {
	const { limit = 50, offset = 0, activeThresholdMs = 60 * 1000 } = options;

	await falkor.connect();

	// Query sessions with turn count
	const cypher = `
		MATCH (s:Session)
		RETURN s
		ORDER BY s.started_at DESC
		SKIP ${offset} LIMIT ${limit}
	`;

	const result = await falkor.query<{ s?: SessionNode; [key: number]: SessionNode | undefined }>(
		cypher,
	);

	const sessions: SessionListItem[] = [];
	const now = Date.now();

	if (Array.isArray(result)) {
		for (const row of result) {
			const node = row.s || row[0];
			if (node?.properties) {
				const props = node.properties;
				const sessionId = props.id;

				// Get turn count
				const countQuery = `
					MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
					RETURN count(t) as cnt
				`;
				const countRes = await falkor.query<CountRow>(countQuery, { sessionId });
				const eventCount = countRes?.[0]?.cnt ?? countRes?.[0]?.[0] ?? 0;

				// Get preview from first turn
				const previewQuery = `
					MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
					RETURN t.assistant_preview as preview
					ORDER BY t.sequence_index ASC
					LIMIT 1
				`;
				const previewRes = await falkor.query<PreviewRow>(previewQuery, { sessionId });
				const preview = previewRes?.[0]?.preview ?? previewRes?.[0]?.[0] ?? null;

				const lastEventAt = props.last_event_at ?? null;
				const isActive = lastEventAt ? now - lastEventAt < activeThresholdMs : false;

				sessions.push({
					id: sessionId,
					title: props.title ?? null,
					userId: props.user_id ?? "unknown",
					startedAt: props.started_at ?? 0,
					lastEventAt,
					eventCount,
					preview: preview ? truncatePreview(preview, 150) : null,
					isActive,
				});
			}
		}
	}

	// Get total count
	const countResult = await falkor.query<TotalRow>("MATCH (s:Session) RETURN count(s) as total");
	const total = countResult?.[0]?.total ?? countResult?.[0]?.[0] ?? sessions.length;

	// Separate active and recent
	const active = sessions.filter((s) => s.isActive);
	const recent = sessions.filter((s) => !s.isActive);

	return {
		active,
		recent,
		sessions,
		pagination: {
			total,
			limit,
			offset,
			hasMore: offset + sessions.length < total,
		},
	};
}

/**
 * Get sessions optimized for WebSocket (with aggregated counts)
 */
export async function getSessionsForWebSocket(
	limit = 50,
): Promise<{ active: SessionListItem[]; recent: SessionListItem[] }> {
	await falkor.connect();

	const cypher = `
		MATCH (s:Session)
		OPTIONAL MATCH (s)-[:HAS_TURN]->(t:Turn)
		WITH s, count(t) as eventCount, max(t.vt_start) as lastEventAt
		RETURN s, eventCount, lastEventAt
		ORDER BY COALESCE(s.started_at, s.last_event_at) DESC
		LIMIT $limit
	`;

	const result = await falkor.query<SessionsRow>(cypher, { limit });

	const active: SessionListItem[] = [];
	const recent: SessionListItem[] = [];
	const now = Date.now();
	const activeThreshold = 5 * 60 * 1000; // 5 minutes

	if (Array.isArray(result)) {
		for (const row of result) {
			const node = row.s;
			if (node?.properties) {
				const props = node.properties;
				const sessionStartedAt = props.started_at ?? now;
				const sessionLastEventAt = props.last_event_at ?? row.lastEventAt ?? sessionStartedAt;
				const isActive = now - sessionLastEventAt < activeThreshold;

				const session: SessionListItem = {
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

// =============================================================================
// Helpers
// =============================================================================

function truncatePreview(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength).trim()}...`;
}

/**
 * Ensure FalkorDB connection is established
 */
export async function ensureConnection(): Promise<void> {
	await falkor.connect();
}

/**
 * Get the FalkorDB client instance (for direct queries if needed)
 */
export function getFalkorClient() {
	return falkor;
}
