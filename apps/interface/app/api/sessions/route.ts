import { createFalkorClient, type FalkorNode } from "@engram/storage/falkor";
import { apiError, apiSuccess } from "@lib/api-response";

const falkor = createFalkorClient();

interface SessionRow {
	s?: FalkorNode;
	[key: number]: FalkorNode | undefined;
}

// Session is "active" if last event was within this many milliseconds
const ACTIVE_THRESHOLD_MS = 60 * 1000; // 60 seconds

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

/**
 * List all sessions with metadata
 * @queryParams limit - Max sessions to return (default 50)
 * @queryParams offset - Pagination offset (default 0)
 */
export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
		const offset = parseInt(searchParams.get("offset") || "0");

		await falkor.connect();

		// Query sessions - simple first, then enrich with counts
		const cypher = `
			MATCH (s:Session)
			RETURN s
			ORDER BY s.startedAt DESC
			SKIP ${offset} LIMIT ${limit}
		`;

		const result = await falkor.query(cypher);

		const sessions: SessionListItem[] = [];
		if (Array.isArray(result)) {
			for (const r of result) {
				const row = r as SessionRow;
				// FalkorDB returns {s: {id, labels, properties}} structure
				const node = row.s || row[0];
				if (node) {
					// Properties are nested under node.properties
					const props = node.properties || {};
					const sessionId = props.id as string;

					// Get event count for this session
					const countQuery = `
						MATCH (s:Session {id: $sessionId})-[:TRIGGERS|NEXT*0..]->(t:Thought)
						RETURN count(t) as cnt
					`;
					const countRes = await falkor.query(countQuery, { sessionId });
					// FalkorDB returns {cnt: X} format
					const eventCount = (countRes?.[0]?.cnt ?? countRes?.[0]?.[0] ?? 0) as number;

					// Get preview from first thought
					const previewQuery = `
						MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought)
						RETURN t.preview as preview
						LIMIT 1
					`;
					const previewRes = await falkor.query(previewQuery, { sessionId });
					const preview = (previewRes?.[0]?.preview ?? previewRes?.[0]?.[0] ?? null) as
						| string
						| null;

					const lastEventAt = (props.lastEventAt || null) as number | null;
					const now = Date.now();
					const isActive = lastEventAt ? now - lastEventAt < ACTIVE_THRESHOLD_MS : false;

					sessions.push({
						id: sessionId,
						title: (props.title || null) as string | null,
						userId: (props.userId || props.user_id || "unknown") as string,
						startedAt: (props.startedAt || props.started_at || 0) as number,
						lastEventAt,
						eventCount: eventCount,
						preview: preview ? truncatePreview(preview, 150) : null,
						isActive,
					});
				}
			}
		}

		// Separate active and recent sessions
		const activeSessions = sessions.filter((s) => s.isActive);
		const recentSessions = sessions.filter((s) => !s.isActive);

		// Get total count for pagination
		const countResult = await falkor.query("MATCH (s:Session) RETURN count(s) as total");
		const total = (countResult?.[0]?.total ?? countResult?.[0]?.[0] ?? sessions.length) as number;

		return apiSuccess({
			active: activeSessions,
			recent: recentSessions,
			sessions, // Keep for backwards compatibility
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + sessions.length < total,
			},
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return apiError(message, "SESSIONS_QUERY_FAILED");
	}
}

function truncatePreview(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength).trim() + "...";
}
