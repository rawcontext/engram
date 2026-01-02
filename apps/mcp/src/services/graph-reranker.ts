/**
 * Graph Reranker Service
 *
 * Modifies recall results by incorporating graph distance as a scoring factor.
 * Applied AFTER vector reranking to adjust final scores based on entity relationships.
 *
 * Scoring Formula:
 *   finalScore = relevance * (1 - graphWeight) + graphScore * graphWeight
 *
 * Graph Score Components:
 * - Hop Distance: Direct mention (1 hop) = 1.0, 2 hops = 0.7, 3+ hops = 0.5
 * - Entity Popularity: log(mention_count + 1) / log(max_count + 1)
 * - Relationship Type Weights: MENTIONS = 1.0, RELATED_TO = 0.8, etc.
 */

import type { Entity, EntityRepository, Memory } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { EntityExtractorService, ExtractedEntity } from "./entity-extractor";
import type { RecallResult } from "./interfaces";

/**
 * Configuration for graph reranking
 */
export interface GraphRerankerConfig {
	/** Weight for graph scoring (0-1, default: 0.3) */
	graphWeight: number;
	/** Maximum traversal depth (default: 2) */
	maxDepth: number;
	/** Minimum entity similarity threshold (default: 0.8) */
	entitySimilarityThreshold: number;
}

/**
 * Graph-scored result with additional graph metadata
 */
export interface GraphScoredResult extends RecallResult {
	/** Whether this result was found via vector search or graph expansion */
	source: "vector" | "graph";
	/** Number of hops from query entity to this memory */
	graphDistance?: number;
	/** Calculated graph score (0-1) */
	graphScore?: number;
	/** Entities that connected this memory to the query */
	connectingEntities?: string[];
}

/**
 * Internal structure for tracking graph connections
 */
interface GraphConnection {
	memoryId: string;
	distance: number;
	relationshipType: string;
	entityId: string;
	entityMentionCount: number;
}

/**
 * Relationship type weights for graph scoring
 */
const RELATIONSHIP_WEIGHTS: Record<string, number> = {
	MENTIONS: 1.0,
	RELATED_TO: 0.8,
	DEPENDS_ON: 0.9,
	IMPLEMENTS: 0.85,
	PART_OF: 0.75,
};

/**
 * Default configuration for graph reranking
 */
const DEFAULT_CONFIG: GraphRerankerConfig = {
	graphWeight: 0.3,
	maxDepth: 2,
	entitySimilarityThreshold: 0.8,
};

/**
 * GraphRerankerService applies graph-based scoring to recall results.
 *
 * The service:
 * 1. Extracts entities from the query
 * 2. Finds matching entities in the graph
 * 3. Traverses the graph to find connected memories
 * 4. Calculates graph scores based on hop distance, popularity, and relationship type
 * 5. Combines vector scores with graph scores using configurable weight
 */
export class GraphRerankerService {
	private readonly entityRepository: EntityRepository;
	private readonly entityExtractor: EntityExtractorService;
	private readonly logger: Logger;
	private readonly config: GraphRerankerConfig;

	constructor(
		entityRepository: EntityRepository,
		entityExtractor: EntityExtractorService,
		logger: Logger,
		config: Partial<GraphRerankerConfig> = {},
	) {
		this.entityRepository = entityRepository;
		this.entityExtractor = entityExtractor;
		this.logger = logger;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Apply graph reranking to recall results.
	 *
	 * @param query - The original search query
	 * @param results - Vector search results (already reranked)
	 * @param project - Optional project scope
	 * @returns Results with graph scores applied and reordered
	 */
	async rerank(
		query: string,
		results: RecallResult[],
		project?: string,
	): Promise<GraphScoredResult[]> {
		if (results.length === 0) {
			return [];
		}

		const startTime = Date.now();

		// Step 1: Extract entities from query
		const queryEntities = await this.extractQueryEntities(query);

		if (queryEntities.length === 0) {
			this.logger.debug({ query }, "No entities extracted from query, skipping graph reranking");
			return results.map((r) => ({ ...r, source: "vector" as const }));
		}

		this.logger.debug(
			{ query, entityCount: queryEntities.length, entities: queryEntities.map((e) => e.name) },
			"Extracted entities from query",
		);

		// Step 2: Find matching entities in the graph
		const matchedEntities = await this.findMatchingEntities(queryEntities, project);

		if (matchedEntities.length === 0) {
			this.logger.debug("No matching entities found in graph, skipping graph reranking");
			return results.map((r) => ({ ...r, source: "vector" as const }));
		}

		// Step 3: Find graph connections to memories
		const graphConnections = await this.findGraphConnections(matchedEntities, results);

		// Step 4: Calculate graph scores
		const graphScores = this.calculateGraphScores(graphConnections);

		// Step 5: Apply graph scoring to results
		const scoredResults = this.applyGraphScores(results, graphScores);

		const elapsed = Date.now() - startTime;
		this.logger.info(
			{
				query,
				resultCount: results.length,
				queryEntities: queryEntities.length,
				matchedEntities: matchedEntities.length,
				graphConnections: graphConnections.length,
				elapsedMs: elapsed,
			},
			"Graph reranking completed",
		);

		return scoredResults;
	}

	/**
	 * Extract entities from the query using the entity extractor.
	 */
	private async extractQueryEntities(query: string): Promise<ExtractedEntity[]> {
		try {
			const result = await this.entityExtractor.extract(query, "query");
			return result.entities;
		} catch (error) {
			this.logger.warn({ error, query }, "Failed to extract entities from query");
			return [];
		}
	}

	/**
	 * Find entities in the graph that match the extracted query entities.
	 */
	private async findMatchingEntities(
		queryEntities: ExtractedEntity[],
		project?: string,
	): Promise<Entity[]> {
		const matched: Entity[] = [];

		for (const extracted of queryEntities) {
			// Try exact name match first
			let entity = await this.entityRepository.findByName(extracted.name, project);

			// Try alias match if no exact match
			if (!entity) {
				entity = await this.entityRepository.findByAlias(extracted.name, project);
			}

			if (entity) {
				matched.push(entity);
			}
		}

		return matched;
	}

	/**
	 * Find graph connections from matched entities to memory results.
	 * Traverses MENTIONS edges and inter-entity relationships.
	 */
	private async findGraphConnections(
		entities: Entity[],
		results: RecallResult[],
	): Promise<GraphConnection[]> {
		const connections: GraphConnection[] = [];
		const resultIds = new Set(results.map((r) => r.id));

		for (const entity of entities) {
			// Direct mentions (1 hop)
			const mentioningMemories = await this.entityRepository.findMentioningMemories(entity.id);

			for (const memory of mentioningMemories) {
				if (resultIds.has(memory.id)) {
					connections.push({
						memoryId: memory.id,
						distance: 1,
						relationshipType: "MENTIONS",
						entityId: entity.id,
						entityMentionCount: entity.mentionCount ?? 1,
					});
				}
			}

			// Related entities (2+ hops)
			if (this.config.maxDepth >= 2) {
				const relatedEntities = await this.entityRepository.findRelatedEntities(
					entity.id,
					this.config.maxDepth - 1,
				);

				for (const related of relatedEntities) {
					const relatedMemories = await this.entityRepository.findMentioningMemories(related.id);

					for (const memory of relatedMemories) {
						if (resultIds.has(memory.id)) {
							// Check if we already have a closer connection
							const existing = connections.find((c) => c.memoryId === memory.id);
							if (!existing || existing.distance > 2) {
								connections.push({
									memoryId: memory.id,
									distance: 2,
									relationshipType: "RELATED_TO",
									entityId: related.id,
									entityMentionCount: related.mentionCount ?? 1,
								});
							}
						}
					}
				}
			}
		}

		return connections;
	}

	/**
	 * Calculate graph scores for each memory based on connections.
	 */
	private calculateGraphScores(
		connections: GraphConnection[],
	): Map<string, { score: number; distance: number; entities: string[] }> {
		const scores = new Map<string, { score: number; distance: number; entities: string[] }>();

		// Find max mention count for normalization
		const maxMentionCount = Math.max(...connections.map((c) => c.entityMentionCount), 1);

		// Group connections by memory ID
		const connectionsByMemory = new Map<string, GraphConnection[]>();
		for (const conn of connections) {
			const existing = connectionsByMemory.get(conn.memoryId) ?? [];
			existing.push(conn);
			connectionsByMemory.set(conn.memoryId, existing);
		}

		// Calculate score for each memory
		for (const [memoryId, memoryConns] of connectionsByMemory) {
			// Use best (closest) connection for distance
			const bestConn = memoryConns.reduce((a, b) => (a.distance < b.distance ? a : b));

			// Calculate component scores
			const hopScore = this.calculateHopScore(bestConn.distance);
			const popularityScore = this.calculatePopularityScore(
				bestConn.entityMentionCount,
				maxMentionCount,
			);
			const typeScore = RELATIONSHIP_WEIGHTS[bestConn.relationshipType] ?? 0.8;

			// Combine scores (weighted average)
			const graphScore = hopScore * 0.5 + popularityScore * 0.25 + typeScore * 0.25;

			scores.set(memoryId, {
				score: graphScore,
				distance: bestConn.distance,
				entities: memoryConns.map((c) => c.entityId),
			});
		}

		return scores;
	}

	/**
	 * Calculate hop distance score.
	 * Direct mention (1 hop) = 1.0, 2 hops = 0.7, 3+ hops = 0.5
	 */
	private calculateHopScore(distance: number): number {
		if (distance === 1) return 1.0;
		if (distance === 2) return 0.7;
		return 0.5;
	}

	/**
	 * Calculate entity popularity score using log normalization.
	 */
	private calculatePopularityScore(mentionCount: number, maxMentionCount: number): number {
		return Math.log(mentionCount + 1) / Math.log(maxMentionCount + 1);
	}

	/**
	 * Apply graph scores to results and reorder.
	 */
	private applyGraphScores(
		results: RecallResult[],
		graphScores: Map<string, { score: number; distance: number; entities: string[] }>,
	): GraphScoredResult[] {
		const scoredResults: GraphScoredResult[] = results.map((result) => {
			const graphData = graphScores.get(result.id);

			if (!graphData) {
				// No graph connection - keep original score
				return {
					...result,
					source: "vector" as const,
				};
			}

			// Apply graph weight formula: finalScore = relevance * (1 - w) + graphScore * w
			const finalScore =
				result.score * (1 - this.config.graphWeight) + graphData.score * this.config.graphWeight;

			return {
				...result,
				score: finalScore,
				source: "graph" as const,
				graphDistance: graphData.distance,
				graphScore: graphData.score,
				connectingEntities: graphData.entities,
			};
		});

		// Sort by final score descending
		scoredResults.sort((a, b) => b.score - a.score);

		return scoredResults;
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(config: Partial<GraphRerankerConfig>): void {
		Object.assign(this.config, config);
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): GraphRerankerConfig {
		return { ...this.config };
	}
}
