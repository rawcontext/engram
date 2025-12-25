import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient, IMemoryRetriever } from "../services/interfaces";

interface SessionInfo {
	id: string;
	summary?: string;
	started_at: number;
}

interface HotFile {
	path: string;
	touchCount: number;
	lastAction: string;
}

function formatRelativeTime(epochMs: number): string {
	const now = Date.now();
	const diffMs = now - epochMs;
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays === 1) return "yesterday";
	return `${diffDays}d ago`;
}

export function registerPrimePrompt(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	client: IEngramClient,
	getSessionContext: () => { project?: string; workingDir?: string },
) {
	server.registerPrompt(
		"session-prime",
		{
			description:
				"Initialize a work session with context from memory. Retrieves recent sessions, decisions, insights, preferences, and frequently modified files. Just hit Enter.",
		},
		async () => {
			const sessionContext = getSessionContext();
			const now = Date.now();
			const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

			const sections: string[] = [];

			// 1. Recent Sessions in this project/working directory
			try {
				const sessionsQuery = sessionContext.workingDir
					? `MATCH (s:Session)
					   WHERE s.working_dir = $workingDir AND s.vt_end > $now
					   RETURN s.id AS id, s.summary AS summary, s.started_at AS started_at, s.agent_type AS agent_type
					   ORDER BY s.started_at DESC
					   LIMIT 5`
					: `MATCH (s:Session)
					   WHERE s.vt_end > $now
					   RETURN s.id AS id, s.summary AS summary, s.started_at AS started_at, s.agent_type AS agent_type
					   ORDER BY s.started_at DESC
					   LIMIT 5`;

				const sessions = await client.query<SessionInfo>(sessionsQuery, {
					workingDir: sessionContext.workingDir,
					now,
				});

				if (sessions.length > 0) {
					const sessionLines = sessions.map((s) => {
						const time = formatRelativeTime(s.started_at);
						const summary = s.summary || "No summary";
						return `- **${time}**: ${summary}`;
					});
					sections.push(`### Recent Sessions\n${sessionLines.join("\n")}`);
				}
			} catch {
				// Graph query failed, skip this section
			}

			// 2. Active Decisions
			const decisions = await memoryRetriever.recall("architectural decisions design choices", 5, {
				type: "decision",
				project: sessionContext.project,
			});

			if (decisions.length > 0) {
				const decisionLines = decisions.map((d) => `- ${d.content}`);
				sections.push(`### Active Decisions\n${decisionLines.join("\n")}`);
			}

			// 3. Recent Insights
			const insights = await memoryRetriever.recall("debugging discoveries learnings gotchas", 3, {
				type: "insight",
				project: sessionContext.project,
			});

			if (insights.length > 0) {
				const insightLines = insights.map((i) => `- ${i.content}`);
				sections.push(`### Recent Insights\n${insightLines.join("\n")}`);
			}

			// 4. Preferences
			const preferences = await memoryRetriever.recall("preferences coding style tools", 3, {
				type: "preference",
				project: sessionContext.project,
			});

			if (preferences.length > 0) {
				const prefLines = preferences.map((p) => `- ${p.content}`);
				sections.push(`### Your Preferences\n${prefLines.join("\n")}`);
			}

			// 5. Hot Files (frequently touched in the last week)
			try {
				const hotFilesQuery = `
					MATCH (ft:FileTouch)
					WHERE ft.vt_start > $oneWeekAgo AND ft.vt_end > $now
					WITH ft.file_path AS path, COUNT(*) AS touchCount, MAX(ft.vt_start) AS lastTouch, COLLECT(ft.action)[0] AS lastAction
					WHERE touchCount > 1
					RETURN path, touchCount, lastAction
					ORDER BY touchCount DESC
					LIMIT 8`;

				const hotFiles = await client.query<HotFile>(hotFilesQuery, { oneWeekAgo, now });

				if (hotFiles.length > 0) {
					const fileLines = hotFiles.map(
						(f) => `- \`${f.path}\` (${f.touchCount} touches, last: ${f.lastAction})`,
					);
					sections.push(`### Hot Files\n${fileLines.join("\n")}`);
				}
			} catch {
				// Graph query failed, skip this section
			}

			// Build the final output
			const projectInfo = sessionContext.project ? `**Project**: ${sessionContext.project}` : "";
			const dirInfo = sessionContext.workingDir
				? `**Directory**: ${sessionContext.workingDir}`
				: "";
			const header = [projectInfo, dirInfo].filter(Boolean).join(" | ");

			const contextContent =
				sections.length > 0
					? sections.join("\n\n")
					: "_No context found in memory yet. Start working and use `remember` to build up institutional knowledge._";

			return {
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: `## Session Context
${header ? `${header}\n` : ""}
${contextContent}

---

Ready to work. What would you like to focus on?`,
						},
					},
				],
			};
		},
	);
}
