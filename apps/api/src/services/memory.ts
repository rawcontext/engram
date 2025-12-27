import { createHash } from "node:crypto";
import { QdrantCollections } from "@engram/common";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
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
	graphClient: GraphClient;
	searchUrl: string;
	logger: Logger;
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
	createdAt: string;
}

export interface ContextItem {
	type: "memory" | "decision" | "file";
	content: string;
	relevance: number;
	source: string;
}

/**
 * Memory service for Cloud API
 *
 * Provides memory operations backed by FalkorDB and Qdrant via the search service.
 */
export class MemoryService {
	private graphClient: GraphClient;
	private searchClient: SearchClient;
	private logger: Logger;

	constructor(options: MemoryServiceOptions) {
		this.graphClient = options.graphClient;
		this.searchClient = new SearchClient(options.searchUrl, options.logger);
		this.logger = options.logger;
	}

	/**
	 * Store a memory with deduplication
	 */
	async remember(input: RememberInput): Promise<{
		id: string;
		stored: boolean;
		duplicate: boolean;
	}> {
		const contentHash = createHash("sha256").update(input.content).digest("hex");

		// Check for duplicates
		const existing = await this.graphClient.query<{ id: string }>(
			"MATCH (m:Memory {content_hash: $hash}) WHERE m.vt_end > $now RETURN m.id as id LIMIT 1",
			{ hash: contentHash, now: Date.now() },
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

		await this.graphClient.query(
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
		);

		this.logger.info({ id, type: input.type }, "Memory stored");

		// Index memory for semantic search (non-blocking)
		this.searchClient
			.indexMemory({
				id,
				content: input.content,
				type: input.type ?? "context",
				tags: input.tags,
				project: input.project,
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
			const graphConditions: string[] = ["m.vt_end > $now"];
			const graphParams: Record<string, unknown> = {
				query: query.toLowerCase(),
				now: Date.now(),
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

			const graphResults = await this.graphClient.query<{
				id: string;
				content: string;
				type: string;
				tags: string[];
				created_at: string;
			}>(
				`MATCH (m:Memory)
				WHERE ${whereClause} AND toLower(m.content) CONTAINS $query
				RETURN m.id as id, m.content as content, m.type as type, m.tags as tags, m.created_at as created_at
				ORDER BY m.vt_start DESC
				LIMIT $limit`,
				graphParams,
			);

			// Merge and dedupe results (prioritize vector search)
			const resultMap = new Map<string, MemoryResult>();

			// Add vector search results (higher priority)
			for (const result of searchResponse.results) {
				const payload = result.payload as {
					node_id?: string;
					content?: string;
					type?: string;
					tags?: string[];
					timestamp?: number;
					project?: string;
				};

				if (payload?.node_id && payload?.content) {
					resultMap.set(payload.node_id, {
						id: payload.node_id,
						content: payload.content,
						type: payload.type ?? "unknown",
						tags: payload.tags ?? [],
						score: result.reranker_score ?? result.score,
						createdAt: payload.timestamp
							? new Date(payload.timestamp).toISOString()
							: new Date().toISOString(),
					});
				}
			}

			// Add graph results (lower priority, won't override)
			for (const result of graphResults) {
				if (!resultMap.has(result.id)) {
					resultMap.set(result.id, {
						id: result.id,
						content: result.content,
						type: result.type,
						tags: result.tags ?? [],
						score: 0.5, // Default score for keyword matches
						createdAt: result.created_at,
					});
				}
			}

			// Apply type filter post-merge (Qdrant doesn't filter by memory type)
			let results = Array.from(resultMap.values());
			if (filters?.type) {
				results = results.filter((r) => r.type === filters.type);
			}

			// Sort by score and limit
			return results.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
		} catch (error) {
			// Fallback to keyword search if vector search fails
			this.logger.warn({ error }, "Vector search failed, falling back to keyword search");

			const graphConditions: string[] = ["m.vt_end > $now"];
			const graphParams: Record<string, unknown> = {
				query: query.toLowerCase(),
				now: Date.now(),
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

			const results = await this.graphClient.query<{
				id: string;
				content: string;
				type: string;
				tags: string[];
				created_at: string;
			}>(
				`MATCH (m:Memory)
				WHERE ${whereClause} AND toLower(m.content) CONTAINS $query
				RETURN m.id as id, m.content as content, m.type as type, m.tags as tags, m.created_at as created_at
				ORDER BY m.vt_start DESC
				LIMIT $limit`,
				graphParams,
			);

			return results.map((r, i) => ({
				id: r.id,
				content: r.content,
				type: r.type,
				tags: r.tags ?? [],
				score: 1 - i * 0.1, // Simple rank-based scoring
				createdAt: r.created_at,
			}));
		}
	}

	/**
	 * Execute read-only Cypher query
	 */
	async query<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
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

		return this.graphClient.query<T>(cypher, params);
	}

	/**
	 * Get comprehensive context for a task
	 */
	async getContext(
		task: string,
		_files?: string[],
		depth: "shallow" | "medium" | "deep" = "medium",
	): Promise<ContextItem[]> {
		const limits = {
			shallow: 3,
			medium: 5,
			deep: 10,
		};

		const limit = limits[depth];
		const context: ContextItem[] = [];

		// Get relevant memories
		const memories = await this.recall(task, limit);
		for (const memory of memories) {
			context.push({
				type: "memory",
				content: memory.content,
				relevance: memory.score ?? 0.5,
				source: `memory:${memory.id}`,
			});
		}

		// Get decisions about this topic
		const decisions = await this.recall(`decisions about ${task}`, Math.ceil(limit / 2), {
			type: "decision",
		});
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
}
