import type { FileTouchNode, SessionNode } from "@engram/graph";
import type { GraphClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

interface FileHistoryEntry {
	action: string;
	session_id?: string;
	session_date?: string;
	agent_type?: string;
	diff_preview?: string;
	lines_added?: number;
	lines_removed?: number;
	timestamp: string;
}

interface FileHistory {
	path: string;
	history: FileHistoryEntry[];
	total_touches: number;
}

/**
 * Get file history across all sessions
 */
async function getFileHistory(
	graphClient: GraphClient,
	filePath: string,
	limit = 20,
): Promise<FileHistory> {
	await graphClient.connect();

	// Decode the path (URL encoded in the URI)
	const decodedPath = decodeURIComponent(filePath);

	// Query file touches linked to sessions through turns
	const result = await graphClient.query(
		`MATCH (ft:FileTouch {file_path: $filePath})
		 WHERE ft.vt_end > $now
		 OPTIONAL MATCH (t:Turn)-[:TOUCHES]->(ft)
		 OPTIONAL MATCH (s:Session)-[:HAS_TURN]->(t)
		 RETURN ft, s
		 ORDER BY ft.vt_start DESC
		 LIMIT $limit`,
		{ filePath: decodedPath, now: Date.now(), limit },
	);

	const history: FileHistoryEntry[] = [];

	if (Array.isArray(result)) {
		for (const row of result) {
			const typedRow = row as {
				ft: { properties: FileTouchNode };
				s?: { properties: SessionNode };
			};
			const touch = typedRow.ft.properties;
			const session = typedRow.s?.properties;

			history.push({
				action: touch.action,
				session_id: session?.id,
				session_date: session ? new Date(session.started_at).toISOString() : undefined,
				agent_type: session?.agent_type,
				diff_preview: touch.diff_preview,
				lines_added: touch.lines_added,
				lines_removed: touch.lines_removed,
				timestamp: new Date(touch.vt_start).toISOString(),
			});
		}
	}

	// Get total count
	const countResult = await graphClient.query(
		`MATCH (ft:FileTouch {file_path: $filePath})
		 WHERE ft.vt_end > $now
		 RETURN count(ft) as total`,
		{ filePath: decodedPath, now: Date.now() },
	);

	const totalTouches =
		Array.isArray(countResult) && countResult.length > 0
			? (countResult[0] as { total: number }).total
			: 0;

	return {
		path: decodedPath,
		history,
		total_touches: totalTouches,
	};
}

/**
 * List recently touched files for resource enumeration
 */
async function listRecentFiles(
	graphClient: GraphClient,
	limit = 50,
): Promise<Array<{ uri: string; name: string; description: string }>> {
	await graphClient.connect();

	// Get distinct file paths with recent touches
	const result = await graphClient.query(
		`MATCH (ft:FileTouch)
		 WHERE ft.vt_end > $now
		 WITH ft.file_path as path, max(ft.vt_start) as last_touch, count(*) as touch_count
		 RETURN path, last_touch, touch_count
		 ORDER BY last_touch DESC
		 LIMIT $limit`,
		{ now: Date.now(), limit },
	);

	if (!Array.isArray(result)) {
		return [];
	}

	return result.map((row) => {
		const typedRow = row as { path: string; last_touch: number; touch_count: number };
		const encodedPath = encodeURIComponent(typedRow.path);
		return {
			uri: `file-history://${encodedPath}`,
			name: typedRow.path,
			description: `${typedRow.touch_count} changes, last: ${new Date(typedRow.last_touch).toLocaleDateString()}`,
		};
	});
}

export function registerFileHistoryResource(server: McpServer, graphClient: GraphClient) {
	server.registerResource(
		"file-history",
		new ResourceTemplate("file-history://{path}", {
			list: async () => ({ resources: await listRecentFiles(graphClient) }),
		}),
		{
			title: "File History",
			description: "History of changes to a file across all sessions",
			mimeType: "application/json",
		},
		async (uri, { path }) => {
			const history = await getFileHistory(graphClient, path as string);

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(history, null, 2),
					},
				],
			};
		},
	);
}
