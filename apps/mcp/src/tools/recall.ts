import { MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElicitationService } from "../capabilities";
import type { GraphExpansionService } from "../services/graph-expansion";
import type { IMemoryRetriever, RecallResult } from "../services/interfaces";

export interface RecallToolDependencies {
	/** Graph expansion service for entity-based retrieval (optional) */
	graphExpansion?: GraphExpansionService;
}

export function registerRecallTool(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	getSessionContext: () => { project?: string; orgId?: string; orgSlug?: string },
	elicitationService?: ElicitationService,
	dependencies?: RecallToolDependencies,
) {
	server.registerTool(
		"recall",
		{
			title: "Recall",
			description:
				"Search past memories using semantic similarity and knowledge graph traversal. Use PROACTIVELY: at session start to prime yourself with relevant prior knowledge, before making decisions to check for existing rationale, or when the user references 'before', 'last time', or 'remember when'. Returns memories ranked by relevance score.",
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
				includeInvalidated: z
					.boolean()
					.optional()
					.default(false)
					.describe(
						"Include invalidated (expired) memories in results. When true, shows all memories including those that have been superseded or deleted. When false (default), only shows currently valid memories.",
					),
				vtEndAfter: z
					.number()
					.int()
					.optional()
					.describe(
						"Filter by valid time end (returns only memories where vt_end > this timestamp in ms). Defaults to current time to exclude expired memories. Set to 0 to include all memories regardless of validity.",
					),
				disambiguate: z
					.boolean()
					.optional()
					.default(false)
					.describe("If multiple similar memories match, ask user to select one"),
				graphDepth: z
					.number()
					.int()
					.min(0)
					.max(3)
					.optional()
					.default(2)
					.describe(
						"Maximum hops for graph expansion through entity relationships. 0 disables graph expansion (vector-only). Default is 2, which finds memories connected through directly related entities.",
					),
				includeEntities: z
					.boolean()
					.optional()
					.default(true)
					.describe(
						"Enable graph expansion via entity relationships. When true, expands search through entities extracted from the query and their relationships in the knowledge graph. Finds semantically related memories that may not match the query directly.",
					),
			},
			outputSchema: {
				memories: z.array(
					z.object({
						id: z.string(),
						content: z.string(),
						score: z.number(),
						type: z.string(),
						created_at: z.string(),
						invalidated: z.boolean().optional(),
						invalidatedAt: z.number().optional(),
						replacedBy: z.string().nullable().optional(),
						source: z.enum(["vector", "graph"]).optional(),
						graphDistance: z.number().optional(),
						sourceEntity: z.string().optional(),
					}),
				),
				query: z.string(),
				count: z.number(),
				disambiguated: z.boolean().optional(),
				selectedId: z.string().optional(),
				graphExpanded: z.boolean().optional(),
			},
		},
		async ({
			query,
			limit,
			filters,
			rerank,
			rerank_tier,
			includeInvalidated,
			vtEndAfter,
			disambiguate,
			graphDepth,
			includeEntities,
		}) => {
			// Note: Don't auto-apply project filter from session context
			// Memories may have been stored before roots were populated (with project: null)

			const context = getSessionContext();

			// Determine vtEndAfter based on includeInvalidated flag
			// If includeInvalidated is true, set to 0 to skip filtering
			// Otherwise, use provided vtEndAfter or default to current time
			const effectiveVtEndAfter = includeInvalidated ? 0 : (vtEndAfter ?? Date.now());

			// Determine effective limit - oversample if graph expansion is enabled
			const graphExpansionEnabled =
				(includeEntities ?? true) && (graphDepth ?? 2) > 0 && dependencies?.graphExpansion;
			const effectiveLimit = graphExpansionEnabled ? (limit ?? 5) * 2 : (limit ?? 5);

			// Step 1: Vector search
			let memories: RecallResult[] = await memoryRetriever.recall(query, effectiveLimit, {
				...filters,
				vtEndAfter: effectiveVtEndAfter,
				rerank: rerank ?? true,
				rerank_tier: rerank_tier ?? "fast",
				tenant:
					context.orgId && context.orgSlug
						? { orgId: context.orgId, orgSlug: context.orgSlug }
						: undefined,
			});

			// Step 2: Graph expansion (if enabled and service available)
			let graphExpanded = false;
			if (graphExpansionEnabled && dependencies?.graphExpansion) {
				const expanded = await dependencies.graphExpansion.expand(query, memories, {
					graphDepth: graphDepth ?? 2,
					maxQueryEntities: 5,
					entityMatchThreshold: 0.7,
					maxMemoriesPerEntity: 10,
				});

				// Rerank combined results
				const reranked = dependencies.graphExpansion.rerank(expanded);

				// Convert back to RecallResult format and limit
				memories = reranked.slice(0, limit ?? 5).map((r) => ({
					id: r.id,
					content: r.content,
					score: r.score,
					type: r.type,
					created_at: r.created_at,
					invalidated: r.invalidated,
					invalidatedAt: r.invalidatedAt,
					replacedBy: r.replacedBy,
					// Include graph metadata for transparency
					source: r.source,
					graphDistance: r.graphDistance,
					sourceEntity: r.sourceEntity,
				}));

				graphExpanded = true;
			} else {
				// No graph expansion - just limit the results
				memories = memories.slice(0, limit ?? 5);
			}

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
							// Format the selected memory with strikethrough if invalidated
							const formattedMemory = selectedMemory.invalidated
								? {
										...selectedMemory,
										content: selectedMemory.content
											.split("\n")
											.map((line) => `~~${line}~~`)
											.join("\n"),
									}
								: selectedMemory;

							const output = {
								memories: [formattedMemory],
								query,
								count: 1,
								disambiguated,
								selectedId,
								graphExpanded,
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

			// Format memories for text output (with strikethrough for invalidated)
			const formattedMemories = memories.map((m) => {
				if (m.invalidated) {
					// Wrap content in strikethrough markdown
					const strikethroughContent = m.content
						.split("\n")
						.map((line) => `~~${line}~~`)
						.join("\n");
					return {
						...m,
						content: strikethroughContent,
					};
				}
				return m;
			});

			const output = {
				memories: formattedMemories,
				query,
				count: memories.length,
				disambiguated,
				selectedId,
				graphExpanded,
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
