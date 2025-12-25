import type { MemoryNode } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IEngramClient } from "../services/interfaces";

/**
 * List memories for resource enumeration
 */
async function listMemories(
	client: IEngramClient,
	limit = 100,
): Promise<Array<{ uri: string; name: string; description: string }>> {
	const result = await client.query(
		`MATCH (m:Memory)
		 WHERE m.vt_end > $now
		 RETURN m
		 ORDER BY m.vt_start DESC
		 LIMIT $limit`,
		{ now: Date.now(), limit },
	);

	if (!Array.isArray(result)) {
		return [];
	}

	return result.map((row) => {
		const memory = (row as { m: { properties: MemoryNode } }).m.properties;
		const preview = memory.content.slice(0, 100) + (memory.content.length > 100 ? "..." : "");
		return {
			uri: `memory://${memory.id}`,
			name: `${memory.type}: ${preview}`,
			description: `Memory created ${new Date(memory.vt_start).toISOString()}`,
		};
	});
}

/**
 * Get a single memory by ID
 */
async function getMemory(client: IEngramClient, id: string): Promise<MemoryNode | null> {
	const result = await client.query(
		`MATCH (m:Memory {id: $id})
		 WHERE m.vt_end > $now
		 RETURN m`,
		{ id, now: Date.now() },
	);

	if (!Array.isArray(result) || result.length === 0) {
		return null;
	}

	return (result[0] as { m: { properties: MemoryNode } }).m.properties;
}

export function registerMemoryResource(server: McpServer, client: IEngramClient) {
	server.registerResource(
		"memory",
		new ResourceTemplate("memory://{id}", {
			list: async () => ({ resources: await listMemories(client) }),
		}),
		{
			title: "Memory",
			description: "Access stored memories from long-term memory",
			mimeType: "application/json",
		},
		async (uri, { id }) => {
			const memory = await getMemory(client, id as string);

			if (!memory) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify({ error: `Memory not found: ${id}` }),
						},
					],
				};
			}

			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(
							{
								id: memory.id,
								content: memory.content,
								type: memory.type,
								tags: memory.tags,
								source: memory.source,
								project: memory.project,
								created_at: new Date(memory.vt_start).toISOString(),
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
