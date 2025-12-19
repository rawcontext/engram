import { createHash } from "node:crypto";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { ulid } from "ulid";

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
	qdrantUrl: string;
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
 * Provides memory operations backed by FalkorDB and Qdrant.
 */
export class MemoryService {
	private graphClient: GraphClient;
	private qdrantUrl: string;
	private logger: Logger;

	constructor(options: MemoryServiceOptions) {
		this.graphClient = options.graphClient;
		this.qdrantUrl = options.qdrantUrl;
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

		return {
			id,
			stored: true,
			duplicate: false,
		};
	}

	/**
	 * Search memories using hybrid retrieval
	 */
	async recall(query: string, limit = 5, filters?: RecallFilters): Promise<MemoryResult[]> {
		// Build filter conditions
		const conditions: string[] = ["m.vt_end > $now"];
		const params: Record<string, unknown> = {
			query: `%${query}%`,
			now: Date.now(),
			limit,
		};

		if (filters?.type) {
			conditions.push("m.type = $type");
			params.type = filters.type;
		}

		if (filters?.project) {
			conditions.push("m.project = $project");
			params.project = filters.project;
		}

		if (filters?.after) {
			conditions.push("m.vt_start >= $after");
			params.after = new Date(filters.after).getTime();
		}

		if (filters?.before) {
			conditions.push("m.vt_start <= $before");
			params.before = new Date(filters.before).getTime();
		}

		const whereClause = conditions.join(" AND ");

		// Simple keyword search (TODO: integrate Qdrant for vector search)
		const results = await this.graphClient.query<{
			id: string;
			content: string;
			type: string;
			tags: string[];
			created_at: string;
		}>(
			`MATCH (m:Memory)
			WHERE ${whereClause} AND m.content CONTAINS $query
			RETURN m.id as id, m.content as content, m.type as type, m.tags as tags, m.created_at as created_at
			ORDER BY m.vt_start DESC
			LIMIT $limit`,
			params,
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
		files?: string[],
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

		// Sort by relevance
		context.sort((a, b) => b.relevance - a.relevance);

		return context.slice(0, limit * 2);
	}
}
