import { MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElicitationService } from "../capabilities";
import type { IMemoryRetriever } from "../services/interfaces";

export function registerRecallTool(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	_getSessionContext: () => { project?: string },
	elicitationService?: ElicitationService,
) {
	server.registerTool(
		"recall",
		{
			title: "Recall",
			description:
				"Search past memories using semantic similarity. Use PROACTIVELY: at session start to prime yourself with relevant prior knowledge, before making decisions to check for existing rationale, or when the user references 'before', 'last time', or 'remember when'. Returns memories ranked by relevance score.",
			inputSchema: {
				query: z
					.string()
					.describe(
						"Natural language search query. Be descriptive - 'authentication decisions' works better than 'auth'. Include context words that would appear in relevant memories.",
					),
				limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results"),
				filters: z
					.object({
						type: MemoryTypeEnum.or(z.literal("turn"))
							.optional()
							.describe(
								"Filter to specific memory types. Use 'decision' when looking for past rationale. Use 'preference' for user-specific settings. Use 'turn' to search raw conversation history from past sessions.",
							),
						project: z.string().optional().describe("Filter by project"),
						since: z.string().optional().describe("Filter by date (ISO format)"),
					})
					.optional()
					.describe("Optional filters"),
				rerank: z
					.boolean()
					.optional()
					.default(true)
					.describe(
						"Enable reranking to improve result relevance. Reranking uses a cross-encoder model to re-score initial vector search results. Disable for faster but less precise results.",
					),
				rerank_tier: z
					.enum(["fast", "accurate", "code", "llm"])
					.optional()
					.default("fast")
					.describe(
						"Reranker model tier. 'fast': FlashRank lightweight model, good for general queries. 'accurate': BGE cross-encoder, higher quality semantic matching. 'code': Jina code-optimized model, best for code snippets and technical content. 'llm': Gemini Flash, highest quality but uses LLM inference for scoring.",
					),
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
		async ({ query, limit, filters, rerank, rerank_tier, disambiguate }) => {
			// Note: Don't auto-apply project filter from session context
			// Memories may have been stored before roots were populated (with project: null)

			const memories = await memoryRetriever.recall(query, limit ?? 5, {
				...filters,
				rerank: rerank ?? true,
				rerank_tier: rerank_tier ?? "fast",
			});

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
