/**
 * Graph Expansion Service
 *
 * Implements graph-aware retrieval by expanding vector search results
 * through entity relationships in the knowledge graph.
 *
 * The expansion follows a two-path approach:
 * 1. Vector results → MENTIONS → entities → RELATED_TO → entities → MENTIONS → memories
 * 2. Query entities → RELATED_TO → entities → MENTIONS → memories
 *
 * References:
 * - HybridRAG: https://arxiv.org/abs/2408.04948
 * - LightRAG: https://github.com/HKUDS/LightRAG
 */

import type { Entity, EntityRepository, Memory } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { EntityEmbeddingService } from "./entity-embedding";
import type { EntityExtractorService, ExtractedEntity } from "./entity-extractor";
import type { RecallResult } from "./interfaces";

/**
 * Options for graph expansion
 */
export interface GraphExpansionOptions {
	/** Maximum number of hops for BFS expansion (default: 2) */
	graphDepth?: number;
	/** Maximum entities to extract from query (default: 5) */
	maxQueryEntities?: number;
	/** Minimum embedding similarity threshold for entity matching (default: 0.7) */
	entityMatchThreshold?: number;
	/** Maximum memories to retrieve per entity (default: 10) */
	maxMemoriesPerEntity?: number;
}

/**
 * Result from graph expansion with source tracking
 */
export interface GraphExpandedResult extends RecallResult {
	/** Source of this result: 'vector' for original search, 'graph' for graph expansion */
	source: "vector" | "graph";
	/** Graph distance from query (0 for vector results, 1+ for graph-expanded) */
	graphDistance: number;
	/** Entity that led to this result (for graph-expanded results) */
	sourceEntity?: string;
}

/**
 * Service for graph-aware memory retrieval.
 *
 * Enhances vector search results by traversing entity relationships
 * to find semantically related memories that may not match directly.
 */
export class GraphExpansionService {
	private readonly entityExtractor: EntityExtractorService;
	private readonly entityEmbedding: EntityEmbeddingService;
	private readonly entityRepo: EntityRepository;
	private readonly logger: Logger;

	constructor(
		entityExtractor: EntityExtractorService,
		entityEmbedding: EntityEmbeddingService,
		entityRepo: EntityRepository,
		logger: Logger,
	) {
		this.entityExtractor = entityExtractor;
		this.entityEmbedding = entityEmbedding;
		this.entityRepo = entityRepo;
		this.logger = logger;
	}

	/**
	 * Expand vector search results through the knowledge graph.
	 *
	 * Combines vector search results with graph-traversed memories
	 * discovered through entity relationships.
	 *
	 * @param query - The original search query
	 * @param vectorResults - Initial vector search results
	 * @param options - Graph expansion options
	 * @returns Combined and deduplicated results with graph metadata
	 */
	async expand(
		query: string,
		vectorResults: RecallResult[],
		options: GraphExpansionOptions = {},
	): Promise<GraphExpandedResult[]> {
		const {
			graphDepth = 2,
			maxQueryEntities = 5,
			entityMatchThreshold = 0.7,
			maxMemoriesPerEntity = 10,
		} = options;

		const startTime = Date.now();

		this.logger.debug(
			{
				query: query.substring(0, 50),
				vectorResultCount: vectorResults.length,
				graphDepth,
			},
			"Starting graph expansion",
		);

		// Convert vector results to expanded format
		const expandedResults: Map<string, GraphExpandedResult> = new Map();
		for (const result of vectorResults) {
			expandedResults.set(result.id, {
				...result,
				source: "vector",
				graphDistance: 0,
			});
		}

		try {
			// Step 1: Extract entities from the query
			const queryEntities = await this.extractQueryEntities(query, maxQueryEntities);
			this.logger.debug({ count: queryEntities.length }, "Extracted query entities");

			if (queryEntities.length === 0) {
				// No entities to expand from
				return Array.from(expandedResults.values());
			}

			// Step 2: Find matching entities in the graph by embedding similarity
			const matchedEntities = await this.findMatchingEntities(
				queryEntities,
				entityMatchThreshold,
			);
			this.logger.debug({ count: matchedEntities.length }, "Found matching entities in graph");

			// Step 3: Expand through related entities (BFS)
			const relatedEntities = await this.expandRelatedEntities(matchedEntities, graphDepth);
			this.logger.debug({ count: relatedEntities.length }, "Found related entities via BFS");

			// Step 4: Get memories that mention these entities
			const allEntityIds = new Set([
				...matchedEntities.map((e) => e.id),
				...relatedEntities.map((e) => e.id),
			]);

			for (const entityId of allEntityIds) {
				const memories = await this.entityRepo.findMentioningMemories(entityId);

				// Limit memories per entity
				const limitedMemories = memories.slice(0, maxMemoriesPerEntity);

				for (const memory of limitedMemories) {
					// Skip if already in results
					if (expandedResults.has(memory.id)) {
						continue;
					}

					// Calculate graph distance
					const isDirectMatch = matchedEntities.some((e) => e.id === entityId);
					const graphDistance = isDirectMatch ? 1 : 2;

					// Find the entity name for source tracking
					const entity =
						matchedEntities.find((e) => e.id === entityId) ||
						relatedEntities.find((e) => e.id === entityId);

					expandedResults.set(memory.id, {
						id: memory.id,
						content: memory.content,
						score: 0.5 / graphDistance, // Base score decreases with distance
						type: memory.type,
						created_at: new Date(memory.vtStart).toISOString(),
						source: "graph",
						graphDistance,
						sourceEntity: entity?.name,
					});
				}
			}

			const tookMs = Date.now() - startTime;
			this.logger.debug(
				{
					totalResults: expandedResults.size,
					vectorResults: vectorResults.length,
					graphExpanded: expandedResults.size - vectorResults.length,
					tookMs,
				},
				"Graph expansion complete",
			);

			return Array.from(expandedResults.values());
		} catch (error) {
			this.logger.warn({ error }, "Graph expansion failed, returning vector results only");
			return Array.from(expandedResults.values());
		}
	}

	/**
	 * Rerank results considering both semantic relevance and graph distance.
	 *
	 * The scoring formula balances:
	 * - Original relevance score (from vector search or reranker)
	 * - Graph distance penalty (closer = higher score)
	 *
	 * @param results - Results with graph metadata
	 * @returns Sorted results by combined score
	 */
	rerank(results: GraphExpandedResult[]): GraphExpandedResult[] {
		// Scoring weights
		const RELEVANCE_WEIGHT = 0.7;
		const DISTANCE_WEIGHT = 0.3;

		// Normalize scores for comparison
		const maxScore = Math.max(...results.map((r) => r.score), 1);
		const maxDistance = Math.max(...results.map((r) => r.graphDistance), 1);

		const scored = results.map((result) => {
			const normalizedRelevance = result.score / maxScore;
			// Distance score: closer is better (invert and normalize)
			const normalizedDistance = 1 - result.graphDistance / (maxDistance + 1);

			const combinedScore =
				RELEVANCE_WEIGHT * normalizedRelevance + DISTANCE_WEIGHT * normalizedDistance;

			return {
				...result,
				score: combinedScore,
			};
		});

		// Sort by combined score descending
		return scored.sort((a, b) => b.score - a.score);
	}

	/**
	 * Extract entities from the search query.
	 */
	private async extractQueryEntities(
		query: string,
		maxEntities: number,
	): Promise<ExtractedEntity[]> {
		try {
			const extraction = await this.entityExtractor.extract(query, "query");
			return extraction.entities.slice(0, maxEntities);
		} catch (error) {
			this.logger.debug({ error }, "Failed to extract entities from query");
			return [];
		}
	}

	/**
	 * Find entities in the graph that match the extracted query entities.
	 */
	private async findMatchingEntities(
		queryEntities: ExtractedEntity[],
		threshold: number,
	): Promise<Entity[]> {
		const matched: Entity[] = [];

		for (const qe of queryEntities) {
			try {
				// First try exact name match
				const exactMatch = await this.entityRepo.findByName(qe.name);
				if (exactMatch) {
					matched.push(exactMatch);
					continue;
				}

				// Try alias match
				const aliasMatch = await this.entityRepo.findByAlias(qe.name);
				if (aliasMatch) {
					matched.push(aliasMatch);
					continue;
				}

				// Try embedding similarity
				const embedding = await this.entityEmbedding.embed({ name: qe.name });
				const similar = await this.entityRepo.findByEmbedding(embedding, 3, threshold);
				if (similar.length > 0) {
					matched.push(similar[0]);
				}
			} catch (error) {
				this.logger.debug({ entity: qe.name, error }, "Failed to find matching entity");
			}
		}

		return matched;
	}

	/**
	 * Expand from matched entities to related entities via BFS.
	 */
	private async expandRelatedEntities(
		startEntities: Entity[],
		depth: number,
	): Promise<Entity[]> {
		if (depth === 0 || startEntities.length === 0) {
			return [];
		}

		const related: Entity[] = [];
		const visited = new Set(startEntities.map((e) => e.id));

		for (const entity of startEntities) {
			try {
				const relatedEntities = await this.entityRepo.findRelatedEntities(entity.id, depth);
				for (const re of relatedEntities) {
					if (!visited.has(re.id)) {
						visited.add(re.id);
						related.push(re);
					}
				}
			} catch (error) {
				this.logger.debug({ entityId: entity.id, error }, "Failed to expand entity");
			}
		}

		return related;
	}
}
