import { MemoryTypeEnum } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElicitationService } from "../capabilities";
import type { ICommunityRetriever } from "../services/community-retriever";
import type { GraphExpansionService } from "../services/graph-expansion";
import type { GraphRerankerService } from "../services/graph-reranker";
import type { IMemoryRetriever, RecallResult } from "../services/interfaces";

export interface RecallToolOptions {
	/** Graph expansion service for entity-based retrieval (optional) */
	graphExpansion?: GraphExpansionService;
	/** Graph reranker service for entity-based scoring (optional) */
	graphReranker?: GraphRerankerService;
	/** Community retriever for including community summaries (optional) */
	communityRetriever?: ICommunityRetriever;
}

export function registerRecallTool(
	server: McpServer,
	memoryRetriever: IMemoryRetriever,
	getSessionContext: () => { project?: string; orgId?: string; orgSlug?: string },
	elicitationService?: ElicitationService,
	options?: RecallToolOptions,
) {
	const graphExpansion = options?.graphExpansion;
	const graphReranker = options?.graphReranker;
	const communityRetriever = options?.communityRetriever;
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
				graphRerank: z
					.boolean()
					.optional()
					.default(true)
					.describe(
						"Enable graph-based reranking using entity relationships. When enabled, results are boosted based on their connection to entities mentioned in the query. Disable for pure vector-based ranking.",
					),
				graphWeight: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.default(0.3)
					.describe(
						"Weight for graph-based scoring (0-1). Higher values give more influence to entity relationships. Formula: finalScore = vectorScore * (1 - weight) + graphScore * weight",
					),
				includeCommunities: z
					.boolean()
					.optional()
					.default(true)
					.describe(
						"Include relevant community summaries in results. When enabled, searches community embeddings and prepends high-scoring community summaries that provide context about related entity clusters.",
					),
				communityLimit: z
					.number()
					.int()
					.min(1)
					.max(5)
					.optional()
					.default(3)
					.describe("Maximum number of community summaries to include (default: 3)."),
				communityThreshold: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.default(0.5)
					.describe(
						"Minimum similarity score for including a community (default: 0.5). Higher values return fewer but more relevant communities.",
					),
			},
			outputSchema: {
				communities: z
					.array(
						z.object({
							id: z.string(),
							name: z.string(),
							summary: z.string(),
							score: z.number(),
							keywords: z.array(z.string()).optional(),
						}),
					)
					.optional(),
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
						graphScore: z.number().optional(),
						connectingEntities: z.array(z.string()).optional(),
					}),
				),
				query: z.string(),
				count: z.number(),
				disambiguated: z.boolean().optional(),
				selectedId: z.string().optional(),
				graphExpanded: z.boolean().optional(),
				graphReranked: z.boolean().optional(),
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
			graphRerank,
			graphWeight,
			includeCommunities,
			communityLimit,
			communityThreshold,
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
				(includeEntities ?? true) && (graphDepth ?? 2) > 0 && graphExpansion;
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
			if (graphExpansionEnabled && graphExpansion) {
				const expanded = await graphExpansion.expand(query, memories, {
					graphDepth: graphDepth ?? 2,
					maxQueryEntities: 5,
					entityMatchThreshold: 0.7,
					maxMemoriesPerEntity: 10,
				});

				// Rerank combined results
				const reranked = graphExpansion.rerank(expanded);

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

			// Step 3: Graph reranking (if enabled and service is available)
			const shouldGraphRerank = (graphRerank ?? true) && graphReranker && memories.length > 0;
			let graphReranked = false;

			if (shouldGraphRerank) {
				try {
					// Update graph weight if specified
					if (graphWeight !== undefined) {
						graphReranker.updateConfig({ graphWeight });
					}

					// Apply graph reranking
					const graphScoredResults = await graphReranker.rerank(
						query,
						memories,
						filters?.project ?? context.project,
					);

					// Map back to RecallResult format with graph metadata
					memories = graphScoredResults.map((r) => ({
						...r,
						source: r.source,
						graphDistance: r.graphDistance,
						graphScore: r.graphScore,
						connectingEntities: r.connectingEntities,
					}));

					graphReranked = true;
				} catch (error) {
					// Graph reranking is optional - log and continue with vector results
					console.error("Graph reranking failed, using vector results:", error);
				}
			}

			// Step 4: Community search (if enabled and service available)
			let communities: Array<{
				id: string;
				name: string;
				summary: string;
				score: number;
				keywords?: string[];
			}> = [];

			if ((includeCommunities ?? true) && communityRetriever) {
				try {
					const communityResults = await communityRetriever.search(query, {
						project: filters?.project ?? context.project,
						limit: communityLimit ?? 3,
						threshold: communityThreshold ?? 0.5,
					});

					communities = communityResults.map((c) => ({
						id: c.id,
						name: c.name,
						summary: c.summary,
						score: c.score,
						keywords: c.keywords.length > 0 ? c.keywords : undefined,
					}));
				} catch (error) {
					// Community search is optional - log and continue
					console.error("Community search failed:", error);
				}
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
								communities: communities.length > 0 ? communities : undefined,
								memories: [formattedMemory],
								query,
								count: 1,
								disambiguated,
								selectedId,
								graphExpanded,
								graphReranked,
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
				communities: communities.length > 0 ? communities : undefined,
				memories: formattedMemories,
				query,
				count: memories.length,
				disambiguated,
				selectedId,
				graphExpanded,
				graphReranked,
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
