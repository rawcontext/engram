import type { SessionNode, TurnNode } from "@engram/graph";
import type { GraphClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
 * Format session transcript for display
 */
function formatTranscript(transcript: SessionTranscript): string {
	const header = [
		`## Session: ${transcript.title ?? transcript.id}`,
		`- **Agent**: ${transcript.agent_type}`,
		`- **Started**: ${transcript.started_at}`,
		transcript.working_dir ? `- **Project**: ${transcript.working_dir}` : "",
		`- **Turns**: ${transcript.turns.length}`,
	]
		.filter(Boolean)
		.join("\n");

	if (transcript.summary) {
		return `${header}\n\n### Summary\n${transcript.summary}`;
	}

	// Format turns as a condensed transcript
	const turnsText = transcript.turns
		.map((turn, i) => {
			const userPreview = turn.user_content.slice(0, 200);
			const assistantPreview = turn.assistant_preview.slice(0, 300);
			const toolsInfo = turn.tool_calls_count > 0 ? ` [${turn.tool_calls_count} tool calls]` : "";
			const filesInfo =
				turn.files_touched.length > 0
					? ` [files: ${turn.files_touched.slice(0, 3).join(", ")}]`
					: "";

			return `**Turn ${i + 1}**${toolsInfo}${filesInfo}
> User: ${userPreview}${turn.user_content.length > 200 ? "..." : ""}
> Assistant: ${assistantPreview}${turn.assistant_preview.length > 300 ? "..." : ""}`;
		})
		.join("\n\n");

	return `${header}\n\n### Conversation\n\n${turnsText}`;
}

export function registerRecapPrompt(
	server: McpServer,
	graphClient: GraphClient,
	getSessionContext: () => { project?: string },
) {
	server.registerPrompt(
		"e-recap",
		{
			title: "/e recap",
			description:
				"Get a summary of a past session. Useful for reviewing what was accomplished or resuming work.",
			argsSchema: {
				session_id: z
					.string()
					.optional()
					.describe("Session ID to summarize. Leave empty for latest session."),
			},
		},
		async ({ session_id }) => {
			const sessionContext = getSessionContext();

			// Resolve session ID
			let targetSessionId = session_id;
			if (!targetSessionId) {
				targetSessionId =
					(await getLatestSession(graphClient, sessionContext.project)) ?? undefined;
			}

			if (!targetSessionId) {
				return {
					messages: [
						{
							role: "user" as const,
							content: {
								type: "text" as const,
								text: "No sessions found. There is no session history to recap.",
							},
						},
					],
				};
			}

			const transcript = await getSessionTranscript(graphClient, targetSessionId);

			if (!transcript) {
				return {
					messages: [
						{
							role: "user" as const,
							content: {
								type: "text" as const,
								text: `Session not found: ${targetSessionId}. The session may have been deleted or the ID is incorrect.`,
							},
						},
					],
				};
			}

			const formattedTranscript = formatTranscript(transcript);

			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `Please provide a summary of this session, highlighting:
1. Main objectives and what was accomplished
2. Key decisions made
3. Any unfinished work or next steps
4. Notable code changes or files modified

${formattedTranscript}`,
						},
					},
				],
			};
		},
	);
}
