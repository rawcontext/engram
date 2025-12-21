import { MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElicitationService } from "../capabilities";
import type { MemoryRetriever } from "../services/memory-retriever";

export function registerRecallTool(
	server: McpServer,
	memoryRetriever: MemoryRetriever,
	getSessionContext: () => { project?: string },
	elicitationService?: ElicitationService,
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
				disambiguate: z
					.boolean()
					.optional()
					.default(false)
					.describe("If multiple similar memories match, ask user to select one"),
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
				disambiguated: z.boolean().optional(),
				selectedId: z.string().optional(),
			},
		},
		async ({ query, limit, filters, disambiguate }) => {
			const context = getSessionContext();

			// Apply project filter from context if not explicitly provided
			const effectiveFilters = {
				...filters,
				project: filters?.project ?? context.project,
			};

			const memories = await memoryRetriever.recall(query, limit ?? 5, effectiveFilters);

			// If disambiguation is requested and we have multiple similar results, ask user to select
			let selectedId: string | undefined;
			let disambiguated = false;

			if (
				disambiguate &&
				elicitationService?.enabled &&
				memories.length > 1 &&
				memories.length <= 10
			) {
				// Check if the top results have similar scores (within 10% of top score)
				const topScore = memories[0].score;
				const similarMemories = memories.filter((m) => m.score >= topScore * 0.9);

				if (similarMemories.length > 1) {
					const result = await elicitationService.selectMemory(
						`Multiple similar memories found for: "${query}"\nPlease select the most relevant one:`,
						similarMemories.map((m) => ({
							id: m.id,
							preview: m.content,
							type: m.type,
						})),
					);

					if (result.accepted && result.content) {
						selectedId = result.content.selectedId;
						disambiguated = true;
						// Filter to only the selected memory
						const selectedMemory = memories.find((m) => m.id === selectedId);
						if (selectedMemory) {
							const output = {
								memories: [selectedMemory],
								query,
								count: 1,
								disambiguated,
								selectedId,
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
						}
					}
				}
			}

			const output = {
				memories,
				query,
				count: memories.length,
				disambiguated,
				selectedId,
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
