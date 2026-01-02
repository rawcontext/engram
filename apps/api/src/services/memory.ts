import { createHash } from "node:crypto";
import { QdrantCollections, type TenantContext } from "@engram/common";
import type { Logger } from "@engram/logger";
import type { GraphClient, QueryParams, TenantAwareFalkorClient } from "@engram/storage";
import { ulid } from "ulid";
import { SearchClient } from "../clients/search";

// Allowed read-only Cypher keywords
const ALLOWED_CYPHER_PREFIXES = [
	"MATCH",
	"OPTIONAL MATCH",
	"WITH",
	"RETURN",
	"ORDER BY",
	"LIMIT",
	"SKIP",
	"WHERE",
	"UNWIND",
	"CALL",
];

// Disallowed write operations
const BLOCKED_CYPHER_KEYWORDS = [
	"CREATE",
	"MERGE",
	"DELETE",
	"DETACH",
	"SET",
	"REMOVE",
	"DROP",
	"ALTER",
	"CLEAR",
	"IMPORT",
	"EXPORT",
];

export interface MemoryServiceOptions {
	/** Default graph client for non-tenant operations */
	graphClient: GraphClient;
	/** URL for the search service */
	searchUrl: string;
	/** Logger instance */
	logger: Logger;
	/** Optional tenant-aware client for multi-tenant graph isolation */
	tenantClient?: TenantAwareFalkorClient;
}

export interface RememberInput {
	content: string;
	type?: "decision" | "context" | "insight" | "preference" | "fact";
	tags?: string[];
	project?: string;
}

export interface RecallFilters {
	type?: string;
	project?: string;
	after?: string;
	before?: string;
	vtEndAfter?: number;
}

export type RerankTier = "fast" | "accurate" | "code" | "llm";

export interface RerankOptions {
	rerank?: boolean;
	rerank_tier?: RerankTier;
}

export interface MemoryResult {
	id: string;
	content: string;
	type: string;
	tags: string[];
	score?: number;
	decayScore?: number;
	weightedScore?: number;
	createdAt: string;
	invalidated?: boolean;
	invalidatedAt?: number;
	replacedBy?: string | null;
}

export interface ContextItem {
	type: "memory" | "decision" | "file";
	content: string;
	relevance: number;
	source: string;
}

export interface AdminMemoryListOptions {
	limit: number;
	offset: number;
	type?: string;
	orgId?: string;
}

export interface AdminSessionListOptions {
	limit: number;
	offset: number;
	orgId?: string;
}

export interface AdminMemoryResult extends MemoryResult {
	orgId?: string;
	orgSlug?: string;
}

export interface AdminSessionResult {
	id: string;
	orgId?: string;
	orgSlug?: string;
	agentType?: string;
	workingDir?: string;
	createdAt: string;
	updatedAt?: string;
}

/**
 * Memory service for Cloud API
 *
 * Provides memory operations backed by FalkorDB and Qdrant via the search service.
 * Supports multi-tenant graph isolation when TenantAwareFalkorClient is provided.
 */
export class MemoryService {
	private graphClient: GraphClient;
	private tenantClient?: TenantAwareFalkorClient;
	private searchClient: SearchClient;
	private logger: Logger;

	constructor(options: MemoryServiceOptions) {
		this.graphClient = options.graphClient;
		this.tenantClient = options.tenantClient;
		this.searchClient = new SearchClient(options.searchUrl, options.logger);
		this.logger = options.logger;
	}

	/**
	 * Execute a query on the tenant-specific graph.
	 * Falls back to the default graph if no tenant context or client is available.
	 *
	 * @param cypher - Cypher query to execute
	 * @param params - Query parameters
	 * @param tenantContext - Optional tenant context for graph isolation
	 * @returns Query results
	 */
	private async tenantQuery<T>(
		cypher: string,
		params: Record<string, unknown>,
		tenantContext?: TenantContext,
	): Promise<T[]> {
		// Use tenant-specific graph when context is available
		if (this.tenantClient && tenantContext) {
			const graph = await this.tenantClient.ensureTenantGraph(tenantContext);
			// Cast params to QueryParams (compatible types for FalkorDB)
			const result = await graph.query(cypher, { params: params as QueryParams });
			return result.data as T[];
		}

		// Fall back to default graph
		return this.graphClient.query<T>(cypher, params);
	}

	/**
	 * Store a memory with deduplication
	 */
	async remember(
		input: RememberInput,
		tenantContext: TenantContext,
	): Promise<{
		id: string;
		stored: boolean;
		duplicate: boolean;
	}> {
		const contentHash = createHash("sha256").update(input.content).digest("hex");

		// Check for duplicates (tenant-scoped)
		const existing = await this.tenantQuery<{ id: string }>(
			"MATCH (m:Memory {content_hash: $hash}) WHERE m.vt_end > $now RETURN m.id as id LIMIT 1",
			{ hash: contentHash, now: Date.now() },
			tenantContext,
		);

		if (existing.length > 0) {
			return {
				id: existing[0].id,
				stored: false,
				duplicate: true,
			};
		}

		const id = ulid();
		const now = new Date().toISOString();
		const nowMs = Date.now();

		// Create memory in tenant-specific graph
		await this.tenantQuery(
			`CREATE (m:Memory {
				id: $id,
				content: $content,
				content_hash: $hash,
				type: $type,
				tags: $tags,
				project: $project,
				vt_start: $vtStart,
				vt_end: $vtEnd,
				tt_start: $ttStart,
				tt_end: $ttEnd,
				created_at: $createdAt
			})`,
			{
				id,
				content: input.content,
				hash: contentHash,
				type: input.type ?? "context",
				tags: input.tags ?? [],
				project: input.project ?? null,
				vtStart: nowMs,
				vtEnd: Number.MAX_SAFE_INTEGER,
				ttStart: nowMs,
				ttEnd: Number.MAX_SAFE_INTEGER,
				createdAt: now,
			},
			tenantContext,
		);

		this.logger.info(
			{ id, type: input.type, orgId: tenantContext.orgId },
			"Memory stored in tenant graph",
		);

		// Index memory for semantic search (non-blocking)
		// Include org_id for tenant-scoped search
		this.searchClient
			.indexMemory({
				id,
				content: input.content,
				type: input.type ?? "context",
				tags: input.tags,
				project: input.project,
				orgId: tenantContext.orgId,
			})
			.then(() => {
				this.logger.debug({ id }, "Memory indexed for search");
			})
			.catch((error) => {
				this.logger.warn({ id, error }, "Failed to index memory for search");
			});

		return {
			id,
			stored: true,
			duplicate: false,
		};
	}

	/**
	 * Search memories using hybrid retrieval with Qdrant vector search
	 */
	async recall(
		query: string,
		limit = 5,
		filters?: RecallFilters,
		rerankOptions?: RerankOptions,
		tenantContext?: TenantContext,
	): Promise<MemoryResult[]> {
		// Note: Qdrant search filters use semantic types (thought/code/doc),
		// not memory types (decision/context/insight/preference/fact).
		// Memory type filtering is applied post-search via resultMap filtering.

		// Build search filters for Qdrant
		const searchFilters: Record<string, unknown> = {};

		if (filters?.project) {
			searchFilters.project = filters.project;
		}

		// Build time range filter if after/before specified
		if (filters?.after || filters?.before) {
			searchFilters.time_range = {
				start: filters.after ? new Date(filters.after).getTime() : 0,
				end: filters.before ? new Date(filters.before).getTime() : Date.now(),
			};
		}

		// Apply vt_end filter - defaults to current time if not specified
		searchFilters.vt_end_after = filters?.vtEndAfter ?? Date.now();

		// Include org_id filter for tenant isolation in vector search
		if (tenantContext?.orgId) {
			searchFilters.org_id = tenantContext.orgId;
		}

		try {
			// Perform hybrid vector search via search service
			const searchResponse = await this.searchClient.search({
				text: query,
				limit: limit * 2, // Oversample for better recall
				threshold: 0.5,
				strategy: "hybrid",
				rerank: rerankOptions?.rerank ?? true,
				rerank_tier: rerankOptions?.rerank_tier ?? "fast",
				collection: QdrantCollections.MEMORY,
				filters: searchFilters,
			});

			this.logger.debug(
				{ count: searchResponse.results.length, took_ms: searchResponse.took_ms },
				"Vector search completed",
			);

			// Also perform keyword search in graph as fallback
			const vtEndAfter = filters?.vtEndAfter ?? Date.now();
			const graphConditions: string[] = ["m.vt_end > $vtEndAfter"];
			const graphParams: Record<string, unknown> = {
				query: query.toLowerCase(),
				vtEndAfter,
				limit,
			};

			if (filters?.type) {
				graphConditions.push("m.type = $type");
				graphParams.type = filters.type;
			}

			if (filters?.project) {
				graphConditions.push("m.project = $project");
				graphParams.project = filters.project;
			}

			if (filters?.after) {
				graphConditions.push("m.vt_start >= $after");
				graphParams.after = new Date(filters.after).getTime();
			}

			if (filters?.before) {
				graphConditions.push("m.vt_start <= $before");
				graphParams.before = new Date(filters.before).getTime();
			}

			const whereClause = graphConditions.join(" AND ");

			// Query tenant-specific graph for keyword fallback
			const graphResults = await this.tenantQuery<{
				id: string;
				content: string;
				type: string;
				tags: string[];
				created_at: string;
				vt_end: number;
			}>(
				`MATCH (m:Memory)
				WHERE ${whereClause} AND toLower(m.content) CONTAINS $query
				RETURN m.id as id, m.content as content, m.type as type, m.tags as tags, m.created_at as created_at, m.vt_end as vt_end
				ORDER BY m.vt_start DESC
				LIMIT $limit`,
				graphParams,
				tenantContext,
			);

			// Merge and dedupe results (prioritize vector search)
			const resultMap = new Map<string, MemoryResult>();
			const memoryIds = new Set<string>();

			// Add vector search results (higher priority)
			for (const result of searchResponse.results) {
				const payload = result.payload as {
					node_id?: string;
					content?: string;
					type?: string;
					tags?: string[];
					timestamp?: number;
					project?: string;
					vt_end?: number;
				};

				if (payload?.node_id && payload?.content) {
					const now = Date.now();
					const vtEnd = payload.vt_end ?? Number.MAX_SAFE_INTEGER;
					const isInvalidated = vtEnd < now;

					resultMap.set(payload.node_id, {
						id: payload.node_id,
						content: payload.content,
						type: payload.type ?? "unknown",
						tags: payload.tags ?? [],
						score: result.reranker_score ?? result.score,
						createdAt: payload.timestamp
							? new Date(payload.timestamp).toISOString()
							: new Date().toISOString(),
						invalidated: isInvalidated,
						invalidatedAt: isInvalidated ? vtEnd : undefined,
						replacedBy: undefined, // Will be filled in below
					});
					memoryIds.add(payload.node_id);
				}
			}

			// Add graph results (lower priority, won't override)
			for (const result of graphResults) {
				if (!resultMap.has(result.id)) {
					const now = Date.now();
					const isInvalidated = result.vt_end < now;

					resultMap.set(result.id, {
						id: result.id,
						content: result.content,
						type: result.type,
						tags: result.tags ?? [],
						score: 0.5, // Default score for keyword matches
						createdAt: result.created_at,
						invalidated: isInvalidated,
						invalidatedAt: isInvalidated ? result.vt_end : undefined,
						replacedBy: undefined, // Will be filled in below
					});
					memoryIds.add(result.id);
				}
			}

			// Fetch decay scores for all memories from graph
			const allMemoryIds = Array.from(memoryIds);
			if (allMemoryIds.length > 0) {
				const decayResults = await this.tenantQuery<{
					id: string;
					decay_score: number;
					pinned: boolean;
				}>(
					`MATCH (m:Memory)
					WHERE m.id IN $memoryIds
					RETURN m.id as id, m.decay_score as decay_score, m.pinned as pinned`,
					{ memoryIds: allMemoryIds },
					tenantContext,
				);

				// Apply decay weighting to results
				for (const decay of decayResults) {
					const memory = resultMap.get(decay.id);
					if (memory) {
						// Pinned memories get full weight (decay_score = 1.0)
						const effectiveDecayScore = decay.pinned ? 1.0 : (decay.decay_score ?? 1.0);
						memory.decayScore = effectiveDecayScore;
						memory.weightedScore = (memory.score ?? 0) * effectiveDecayScore;
					}
				}

				// Set defaults for memories without decay info (new memories default to 1.0)
				for (const memory of resultMap.values()) {
					if (memory.decayScore === undefined) {
						memory.decayScore = 1.0;
						memory.weightedScore = memory.score ?? 0;
					}
				}
			}

			// For invalidated memories, fetch replacement information
			const invalidatedMemories = Array.from(resultMap.values()).filter((m) => m.invalidated);
			if (invalidatedMemories.length > 0) {
				const invalidatedIds = invalidatedMemories.map((m) => m.id);

				// Query for REPLACES edges to find which memory replaced each invalidated one
				const replacementResults = await this.tenantQuery<{
					oldId: string;
					newId: string;
				}>(
					`MATCH (new:Memory)-[:REPLACES]->(old:Memory)
					WHERE old.id IN $invalidatedIds
					RETURN old.id as oldId, new.id as newId`,
					{ invalidatedIds },
					tenantContext,
				);

				// Update resultMap with replacement info
				for (const replacement of replacementResults) {
					const memory = resultMap.get(replacement.oldId);
					if (memory) {
						memory.replacedBy = replacement.newId;
					}
				}
			}

			// Apply type filter post-merge (Qdrant doesn't filter by memory type)
			let results = Array.from(resultMap.values());
			if (filters?.type) {
				results = results.filter((r) => r.type === filters.type);
			}

			// Sort by weighted score (decay-adjusted) and limit
			const finalResults = results
				.toSorted((a, b) => (b.weightedScore ?? b.score ?? 0) - (a.weightedScore ?? a.score ?? 0))
				.slice(0, limit);

			// Batch update access tracking for returned memories (non-blocking)
			if (finalResults.length > 0) {
				const memoryIds = finalResults.map((r) => r.id);
				this.updateAccessTracking(memoryIds, tenantContext).catch((error) => {
					this.logger.warn({ error, count: memoryIds.length }, "Failed to update access tracking");
				});
			}

			return finalResults;
		} catch (error) {
			// Fallback to keyword search if vector search fails
			this.logger.warn({ error }, "Vector search failed, falling back to keyword search");

			const graphConditions: string[] = ["m.vt_end > $now"];
			const graphParams: Record<string, unknown> = {
				query: query.toLowerCase(),
				now: Date.now(),
				limit: limit * 2, // Oversample by 2x for decay filtering
			};

			if (filters?.type) {
				graphConditions.push("m.type = $type");
				graphParams.type = filters.type;
			}

			if (filters?.project) {
				graphConditions.push("m.project = $project");
				graphParams.project = filters.project;
			}

			if (filters?.after) {
				graphConditions.push("m.vt_start >= $after");
				graphParams.after = new Date(filters.after).getTime();
			}

			if (filters?.before) {
				graphConditions.push("m.vt_start <= $before");
				graphParams.before = new Date(filters.before).getTime();
			}

			const whereClause = graphConditions.join(" AND ");

			// Query tenant-specific graph for keyword fallback (include decay fields)
			const results = await this.tenantQuery<{
				id: string;
				content: string;
				type: string;
				tags: string[];
				created_at: string;
				vt_end: number;
				decay_score: number | null;
				pinned: boolean | null;
			}>(
				`MATCH (m:Memory)
				WHERE ${whereClause} AND toLower(m.content) CONTAINS $query
				RETURN m.id as id, m.content as content, m.type as type, m.tags as tags,
				       m.created_at as created_at, m.vt_end as vt_end,
				       m.decay_score as decay_score, m.pinned as pinned
				ORDER BY m.vt_start DESC
				LIMIT $limit`,
				graphParams,
				tenantContext,
			);

			const now = Date.now();
			const mappedResults = results.map((r, i) => {
				const isInvalidated = r.vt_end < now;
				const baseScore = 1 - i * 0.1; // Simple rank-based scoring
				// Pinned memories get full weight, otherwise use decay_score (default 1.0)
				const effectiveDecayScore = r.pinned ? 1.0 : (r.decay_score ?? 1.0);
				return {
					id: r.id,
					content: r.content,
					type: r.type,
					tags: r.tags ?? [],
					score: baseScore,
					decayScore: effectiveDecayScore,
					weightedScore: baseScore * effectiveDecayScore,
					createdAt: r.created_at,
					invalidated: isInvalidated,
					invalidatedAt: isInvalidated ? r.vt_end : undefined,
					replacedBy: undefined as string | null | undefined,
				};
			});

			// Fetch replacement information for invalidated memories
			const invalidatedIds = mappedResults.filter((r) => r.invalidated).map((r) => r.id);
			if (invalidatedIds.length > 0) {
				const replacementResults = await this.tenantQuery<{
					oldId: string;
					newId: string;
				}>(
					`MATCH (new:Memory)-[:REPLACES]->(old:Memory)
					WHERE old.id IN $invalidatedIds
					RETURN old.id as oldId, new.id as newId`,
					{ invalidatedIds },
					tenantContext,
				);

				// Update results with replacement info
				for (const replacement of replacementResults) {
					const memory = mappedResults.find((m) => m.id === replacement.oldId);
					if (memory) {
						memory.replacedBy = replacement.newId;
					}
				}
			}

			// Sort by weighted score and limit
			const sortedResults = mappedResults
				.toSorted((a, b) => (b.weightedScore ?? b.score ?? 0) - (a.weightedScore ?? a.score ?? 0))
				.slice(0, limit);

			// Batch update access tracking for returned memories (non-blocking)
			if (sortedResults.length > 0) {
				const memoryIds = sortedResults.map((r) => r.id);
				this.updateAccessTracking(memoryIds, tenantContext).catch((error) => {
					this.logger.warn({ error, count: memoryIds.length }, "Failed to update access tracking");
				});
			}

			return sortedResults;
		}
	}

	/**
	 * Update access tracking for a batch of memories.
	 * Sets last_accessed to now and increments access_count.
	 */
	private async updateAccessTracking(
		memoryIds: string[],
		tenantContext?: TenantContext,
	): Promise<void> {
		if (memoryIds.length === 0) return;

		const now = Date.now();
		await this.tenantQuery(
			`MATCH (m:Memory)
			WHERE m.id IN $memoryIds AND m.vt_end > $now
			SET m.last_accessed = $now, m.access_count = COALESCE(m.access_count, 0) + 1`,
			{ memoryIds, now },
			tenantContext,
		);

		this.logger.debug({ count: memoryIds.length }, "Updated access tracking for memories");
	}

	/**
	 * Execute read-only Cypher query
	 */
	async query<T = unknown>(
		cypher: string,
		params?: Record<string, unknown>,
		tenantContext?: TenantContext,
	): Promise<T[]> {
		// Validate query is read-only
		const normalized = cypher.trim().toUpperCase();

		const startsWithAllowed = ALLOWED_CYPHER_PREFIXES.some((prefix) =>
			normalized.startsWith(prefix),
		);

		if (!startsWithAllowed) {
			throw new Error(`Query must start with one of: ${ALLOWED_CYPHER_PREFIXES.join(", ")}`);
		}

		const containsBlocked = BLOCKED_CYPHER_KEYWORDS.some((keyword) => normalized.includes(keyword));

		if (containsBlocked) {
			throw new Error("Write operations are not allowed via the API");
		}

		// Execute query on tenant-specific graph
		return this.tenantQuery<T>(cypher, params ?? {}, tenantContext);
	}

	/**
	 * Get comprehensive context for a task
	 */
	async getContext(
		task: string,
		_files?: string[],
		depth: "shallow" | "medium" | "deep" = "medium",
		tenantContext?: TenantContext,
	): Promise<ContextItem[]> {
		const limits = {
			shallow: 3,
			medium: 5,
			deep: 10,
		};

		const limit = limits[depth];
		const context: ContextItem[] = [];

		// Get relevant memories (tenant-scoped)
		const memories = await this.recall(task, limit, undefined, undefined, tenantContext);
		for (const memory of memories) {
			context.push({
				type: "memory",
				content: memory.content,
				relevance: memory.score ?? 0.5,
				source: `memory:${memory.id}`,
			});
		}

		// Get decisions about this topic (tenant-scoped)
		const decisions = await this.recall(
			`decisions about ${task}`,
			Math.ceil(limit / 2),
			{ type: "decision" },
			undefined,
			tenantContext,
		);
		for (const decision of decisions) {
			context.push({
				type: "decision",
				content: decision.content,
				relevance: decision.score ?? 0.5,
				source: `memory:${decision.id}`,
			});
		}

		// Sort by relevance and limit
		return context.toSorted((a, b) => b.relevance - a.relevance).slice(0, limit * 2);
	}

	/**
	 * List memories across all tenants (admin only).
	 * Does NOT filter by tenant - requires admin:read scope.
	 *
	 * NOTE: This is a placeholder implementation. In production, this would need to:
	 * 1. Query all tenant graphs (each tenant has engram_{orgSlug}_{orgId} graph)
	 * 2. Aggregate results across graphs
	 * 3. Or use a centralized metadata index for cross-tenant queries
	 *
	 * Current implementation only queries the current tenant's graph.
	 */
	async listMemoriesAdmin(options: AdminMemoryListOptions): Promise<AdminMemoryResult[]> {
		const { limit, offset, type, orgId } = options;

		const conditions: string[] = ["m.vt_end > $now"];
		const params: Record<string, unknown> = {
			now: Date.now(),
			limit,
			offset,
		};

		if (type) {
			conditions.push("m.type = $type");
			params.type = type;
		}

		if (orgId) {
			conditions.push("m.org_id = $orgId");
			params.orgId = orgId;
		}

		const whereClause = conditions.join(" AND ");

		// TODO: Implement proper cross-tenant querying
		// This currently only queries the default graph, not all tenant graphs
		const results = await this.graphClient.query<{
			id: string;
			content: string;
			type: string;
			tags: string[];
			created_at: string;
			org_id?: string;
			org_slug?: string;
		}>(
			`MATCH (m:Memory)
			WHERE ${whereClause}
			RETURN m.id as id, m.content as content, m.type as type, m.tags as tags,
			       m.created_at as created_at, m.org_id as org_id, m.org_slug as org_slug
			ORDER BY m.vt_start DESC
			SKIP $offset
			LIMIT $limit`,
			params,
		);

		return results.map((r) => ({
			id: r.id,
			content: r.content,
			type: r.type,
			tags: r.tags ?? [],
			createdAt: r.created_at,
			orgId: r.org_id,
			orgSlug: r.org_slug,
		}));
	}

	/**
	 * List sessions across all tenants (admin only).
	 * Does NOT filter by tenant - requires admin:read scope.
	 *
	 * NOTE: This is a placeholder implementation. In production, this would need to:
	 * 1. Query all tenant graphs (each tenant has engram_{orgSlug}_{orgId} graph)
	 * 2. Aggregate results across graphs
	 * 3. Or use a centralized metadata index for cross-tenant queries
	 *
	 * Current implementation only queries the current tenant's graph.
	 */
	async listSessionsAdmin(options: AdminSessionListOptions): Promise<AdminSessionResult[]> {
		const { limit, offset, orgId } = options;

		const conditions: string[] = ["s.vt_end > $now"];
		const params: Record<string, unknown> = {
			now: Date.now(),
			limit,
			offset,
		};

		if (orgId) {
			conditions.push("s.org_id = $orgId");
			params.orgId = orgId;
		}

		const whereClause = conditions.join(" AND ");

		// TODO: Implement proper cross-tenant querying
		// This currently only queries the default graph, not all tenant graphs
		const results = await this.graphClient.query<{
			id: string;
			org_id?: string;
			org_slug?: string;
			agent_type?: string;
			working_dir?: string;
			created_at: string;
			updated_at?: string;
		}>(
			`MATCH (s:Session)
			WHERE ${whereClause}
			RETURN s.id as id, s.org_id as org_id, s.org_slug as org_slug,
			       s.agent_type as agent_type, s.working_dir as working_dir,
			       s.created_at as created_at, s.updated_at as updated_at
			ORDER BY s.vt_start DESC
			SKIP $offset
			LIMIT $limit`,
			params,
		);

		return results.map((r) => ({
			id: r.id,
			orgId: r.org_id,
			orgSlug: r.org_slug,
			agentType: r.agent_type,
			workingDir: r.working_dir,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}
}
