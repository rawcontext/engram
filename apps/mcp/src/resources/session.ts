import type { SessionNode, TurnNode } from "@engram/graph";
import type { GraphClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

interface SessionTranscript {
	id: string;
	title?: string;
	agent_type: string;
	working_dir?: string;
	started_at: string;
	turns: Array<{
		sequence: number;
		user_content: string;
		assistant_preview: string;
		tool_calls_count: number;
		files_touched: string[];
	}>;
	summary?: string;
}

/**
 * List sessions for resource enumeration
 */
async function listSessions(
	graphClient: GraphClient,
	limit = 50,
): Promise<Array<{ uri: string; name: string; description: string }>> {
	await graphClient.connect();

	const result = await graphClient.query(
		`MATCH (s:Session)
		 WHERE s.vt_end > $now
		 RETURN s
		 ORDER BY s.started_at DESC
		 LIMIT $limit`,
		{ now: Date.now(), limit },
	);

	if (!Array.isArray(result)) {
		return [];
	}

	return result.map((row) => {
		const session = (row as { s: { properties: SessionNode } }).s.properties;
		const date = new Date(session.started_at).toLocaleDateString();
		return {
			uri: `session://${session.id}/transcript`,
			name: session.title ?? `Session ${date}`,
			description: `${session.agent_type} session from ${date}${session.working_dir ? ` in ${session.working_dir}` : ""}`,
		};
	});
}

/**
 * Get session transcript with all turns
 */
async function getSessionTranscript(
	graphClient: GraphClient,
	sessionId: string,
): Promise<SessionTranscript | null> {
	await graphClient.connect();

	// Get session node
	const sessionResult = await graphClient.query(
		`MATCH (s:Session {id: $sessionId})
		 WHERE s.vt_end > $now
		 RETURN s`,
		{ sessionId, now: Date.now() },
	);

	if (!Array.isArray(sessionResult) || sessionResult.length === 0) {
		return null;
	}

	const session = (sessionResult[0] as { s: { properties: SessionNode } }).s.properties;

	// Get all turns for this session
	const turnsResult = await graphClient.query(
		`MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
		 WHERE t.vt_end > $now
		 RETURN t
		 ORDER BY t.sequence_index ASC`,
		{ sessionId, now: Date.now() },
	);

	const turns: SessionTranscript["turns"] = [];
	if (Array.isArray(turnsResult)) {
		for (const row of turnsResult) {
			const turn = (row as { t: { properties: TurnNode } }).t.properties;
			turns.push({
				sequence: turn.sequence_index,
				user_content: turn.user_content,
				assistant_preview: turn.assistant_preview,
				tool_calls_count: turn.tool_calls_count,
				files_touched: turn.files_touched,
			});
		}
	}

	return {
		id: session.id,
		title: session.title,
		agent_type: session.agent_type,
		working_dir: session.working_dir,
		started_at: new Date(session.started_at).toISOString(),
		turns,
		summary: session.summary,
	};
}

/**
 * Get latest session for a project or globally
 */
async function getLatestSession(
	graphClient: GraphClient,
	project?: string,
): Promise<string | null> {
	await graphClient.connect();

	let query = `MATCH (s:Session) WHERE s.vt_end > $now`;
	const params: Record<string, unknown> = { now: Date.now() };

	if (project) {
		// Try to match by working_dir containing project name
		query += ` AND s.working_dir CONTAINS $project`;
		params.project = project;
	}

	query += ` RETURN s.id ORDER BY s.started_at DESC LIMIT 1`;

	const result = await graphClient.query(query, params);

	if (!Array.isArray(result) || result.length === 0) {
		return null;
	}

	return (result[0] as { "s.id": string })["s.id"];
}

export function registerSessionResource(
	server: McpServer,
	graphClient: GraphClient,
	getSessionContext: () => { project?: string },
) {
	// Register transcript resource with template
	server.registerResource(
		"session-transcript",
		new ResourceTemplate("session://{session_id}/transcript", {
			list: async () => ({ resources: await listSessions(graphClient) }),
		}),
		{
			title: "Session Transcript",
			description: "Full conversation transcript for a session including all turns",
			mimeType: "application/json",
		},
		async (uri, { session_id }) => {
			let targetSessionId = session_id as string;

			// Handle "latest" as special case
			if (targetSessionId === "latest") {
				const context = getSessionContext();
				const latestId = await getLatestSession(graphClient, context.project);
				if (!latestId) {
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: "application/json",
								text: JSON.stringify({ error: "No sessions found" }),
							},
						],
					};
				}
				targetSessionId = latestId;
			}

			const transcript = await getSessionTranscript(graphClient, targetSessionId);

			if (!transcript) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify({ error: `Session not found: ${session_id}` }),
						},
					],
				};
			}

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(transcript, null, 2),
					},
				],
			};
		},
	);

	// Register session summary resource (lighter weight)
	server.registerResource(
		"session-summary",
		new ResourceTemplate("session://{session_id}/summary", {
			list: undefined, // Listed via transcript
		}),
		{
			title: "Session Summary",
			description: "High-level summary of a session",
			mimeType: "application/json",
		},
		async (uri, { session_id }) => {
			let targetSessionId = session_id as string;

			if (targetSessionId === "latest") {
				const context = getSessionContext();
				const latestId = await getLatestSession(graphClient, context.project);
				if (!latestId) {
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: "application/json",
								text: JSON.stringify({ error: "No sessions found" }),
							},
						],
					};
				}
				targetSessionId = latestId;
			}

			await graphClient.connect();

			const result = await graphClient.query(
				`MATCH (s:Session {id: $sessionId})
				 WHERE s.vt_end > $now
				 OPTIONAL MATCH (s)-[:HAS_TURN]->(t:Turn)
				 RETURN s, count(t) as turn_count`,
				{ sessionId: targetSessionId, now: Date.now() },
			);

			if (!Array.isArray(result) || result.length === 0) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify({ error: `Session not found: ${session_id}` }),
						},
					],
				};
			}

			const row = result[0] as { s: { properties: SessionNode }; turn_count: number };
			const session = row.s.properties;

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								id: session.id,
								title: session.title,
								agent_type: session.agent_type,
								working_dir: session.working_dir,
								started_at: new Date(session.started_at).toISOString(),
								turn_count: row.turn_count,
								summary: session.summary,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}
