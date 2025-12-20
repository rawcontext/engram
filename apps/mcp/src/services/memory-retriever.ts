import type { MemoryNode, MemoryType } from "@engram/graph";
import { createLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type GraphClient } from "@engram/storage";
import { SearchPyClient } from "../clients/search-py";

export interface RecallFilters {
	type?: MemoryType | "turn";
	project?: string;
	since?: string; // ISO date string
	sessionId?: string;
}

export interface RecallResult {
	id: string;
	content: string;
	score: number;
	type: string;
	created_at: string;
	source?: string;
	project?: string;
}

export interface MemoryRetrieverOptions {
	graphClient?: GraphClient;
	searchPyClient?: SearchPyClient;
	logger?: Logger;
	searchPyUrl?: string;
}

/**
 * Map memory types to Qdrant search types
 * Memory types: decision, context, insight, preference, fact, turn
 * Search types: thought, code, doc
 */
function mapMemoryTypeToSearchType(
	memoryType?: MemoryType | "turn",
): "thought" | "code" | "doc" | undefined {
	if (!memoryType) return undefined;
	// "turn" maps to "thought" (conversation turns are thoughts)
	if (memoryType === "turn") return "thought";
	// All other memory types are treated as "doc" (document/knowledge)
	return "doc";
}

export class MemoryRetriever {
	private graphClient: GraphClient;
	private searchPyClient: SearchPyClient | null;
	private logger: Logger;

	constructor(options?: MemoryRetrieverOptions) {
		this.graphClient = options?.graphClient ?? createFalkorClient();
		const searchPyUrl = options?.searchPyUrl ?? "http://localhost:5002";
		this.searchPyClient =
			options?.searchPyClient ??
			new SearchPyClient(
				searchPyUrl,
				options?.logger ?? createLogger({ component: "SearchPyClient" }),
			);
		this.logger = options?.logger ?? createLogger({ component: "MemoryRetriever" });
	}

	async connect(): Promise<void> {
		await this.graphClient.connect();
	}

	async recall(query: string, limit = 5, filters?: RecallFilters): Promise<RecallResult[]> {
		this.logger.debug({ query, limit, filters }, "Starting recall");

		// Map memory type to search type for Qdrant
		const searchType = mapMemoryTypeToSearchType(filters?.type);

		// Search in Qdrant for semantic matches using search-py service
		const searchResults = this.searchPyClient
			? (
					await this.searchPyClient.search({
						text: query,
						limit: limit * 2, // Oversample for better recall
						rerank: true,
						rerank_tier: "fast",
						strategy: "hybrid",
						filters: {
							session_id: filters?.sessionId,
							type: searchType,
						},
					})
				).results
			: [];

		this.logger.debug({ count: searchResults.length }, "Search returned");

		// Also search Memory nodes in graph directly
		await this.connect();

		let graphCypher = `
			MATCH (m:Memory)
			WHERE m.vt_end > $now
			AND m.content CONTAINS $queryLower
		`;
		const graphParams: Record<string, unknown> = {
			now: Date.now(),
			queryLower: query.toLowerCase(),
		};

		if (filters?.type && filters.type !== "turn") {
			graphCypher += " AND m.type = $type";
			graphParams.type = filters.type;
		}

		if (filters?.project) {
			graphCypher += " AND m.project = $project";
			graphParams.project = filters.project;
		}

		graphCypher += " RETURN m ORDER BY m.vt_start DESC LIMIT $limit";
		graphParams.limit = limit;

		const graphResults = await this.graphClient.query(graphCypher, graphParams);
		this.logger.debug(
			{ count: Array.isArray(graphResults) ? graphResults.length : 0 },
			"Graph search returned",
		);

		// Merge and dedupe results
		const resultMap = new Map<string, RecallResult>();

		// Add Qdrant results
		for (const result of searchResults) {
			const payload = result.payload as {
				node_id?: string;
				content?: string;
				type?: string;
				timestamp?: number;
				session_id?: string;
			};

			if (payload?.node_id && payload?.content) {
				resultMap.set(payload.node_id, {
					id: payload.node_id,
					content: payload.content,
					score: result.score,
					type: payload.type ?? "unknown",
					created_at: payload.timestamp
						? new Date(payload.timestamp).toISOString()
						: new Date().toISOString(),
					source: payload.session_id,
				});
			}
		}

		// Add graph results (lower priority, won't override)
		if (Array.isArray(graphResults)) {
			for (const row of graphResults) {
				const memory = (row as { m: { properties: MemoryNode } }).m?.properties;
				if (memory?.id && !resultMap.has(memory.id)) {
					resultMap.set(memory.id, {
						id: memory.id,
						content: memory.content,
						score: 0.5, // Default score for keyword matches
						type: memory.type,
						created_at: new Date(memory.vt_start).toISOString(),
						source: memory.source,
						project: memory.project,
					});
				}
			}
		}

		// Sort by score and limit
		return Array.from(resultMap.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}
}
