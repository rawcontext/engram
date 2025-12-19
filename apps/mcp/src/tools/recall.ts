import { MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryRetriever } from "../services/memory-retriever";

export function registerRecallTool(
	server: McpServer,
	memoryRetriever: MemoryRetriever,
	getSessionContext: () => { project?: string },
) {
	server.registerTool(
		"engram_recall",
		{
			title: "Recall",
			description: "Search long-term memory using natural language",
			inputSchema: {
				query: z.string().describe("Natural language search query"),
				limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results"),
				filters: z
					.object({
						type: MemoryTypeEnum.or(z.literal("turn")).optional().describe("Filter by memory type"),
						project: z.string().optional().describe("Filter by project"),
						since: z.string().optional().describe("Filter by date (ISO format)"),
					})
					.optional()
					.describe("Optional filters"),
			},
			outputSchema: {
				memories: z.array(
					z.object({
						id: z.string(),
						content: z.string(),
						score: z.number(),
						type: z.string(),
						created_at: z.string(),
					}),
				),
				query: z.string(),
				count: z.number(),
			},
		},
		async ({ query, limit, filters }) => {
			const context = getSessionContext();

			// Apply project filter from context if not explicitly provided
			const effectiveFilters = {
				...filters,
				project: filters?.project ?? context.project,
			};

			const memories = await memoryRetriever.recall(query, limit ?? 5, effectiveFilters);

			const output = {
				memories,
				query,
				count: memories.length,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(output, null, 2),
					},
				],
				structuredContent: output,
			};
		},
	);
}
