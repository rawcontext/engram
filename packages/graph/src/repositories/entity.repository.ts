import type { CreateEntityInput, Entity, Memory, UpdateEntityInput } from "./types";

/**
 * EntityRepository abstracts data access for Entity nodes.
 *
 * Entities are named concepts, tools, technologies, patterns, files, people,
 * or projects extracted from conversations and memories. They enable
 * entity-based retrieval and knowledge graph construction.
 *
 * This interface decouples business logic from the underlying graph database,
 * enabling:
 * - Unit testing with mock implementations
 * - Swapping storage backends without changing consumers
 * - Clear separation of concerns
 */
export interface EntityRepository {
	// =============================================================================
	// CRUD Operations
	// =============================================================================

	/**
	 * Find an entity by its internal ULID.
	 * @param id - The internal entity ID (ULID)
	 * @returns The entity or null if not found
	 */
	findById(id: string): Promise<Entity | null>;

	/**
	 * Find an entity by its canonical name.
	 * @param name - The canonical entity name
	 * @param project - Optional project scope filter
	 * @returns The entity or null if not found
	 */
	findByName(name: string, project?: string): Promise<Entity | null>;

	/**
	 * Find entities by type.
	 * @param type - The entity type (tool, concept, pattern, file, person, project, technology)
	 * @param project - Optional project scope filter
	 * @returns Array of entities of the specified type
	 */
	findByType(type: string, project?: string): Promise<Entity[]>;

	/**
	 * Find an entity by alias.
	 * Searches through the aliases array for a match.
	 * @param alias - The alias to search for
	 * @param project - Optional project scope filter
	 * @returns The entity or null if not found
	 */
	findByAlias(alias: string, project?: string): Promise<Entity | null>;

	/**
	 * Create a new entity.
	 * @param input - Entity creation parameters
	 * @returns The created entity with generated ID and timestamps
	 */
	create(input: CreateEntityInput): Promise<Entity>;

	/**
	 * Update an existing entity.
	 * Creates a new bitemporal version (old version is preserved with closed tt_end).
	 * @param id - The entity ID to update
	 * @param updates - Partial entity fields to update
	 * @returns The updated entity
	 * @throws Error if entity not found
	 */
	update(id: string, updates: UpdateEntityInput): Promise<Entity>;

	/**
	 * Soft delete an entity (closes its transaction time).
	 * The entity is preserved for historical queries but won't appear in findActive().
	 * @param id - The entity ID to delete
	 * @throws Error if entity not found
	 */
	delete(id: string): Promise<void>;

	/**
	 * Increment the mention count for an entity.
	 * This is called when the entity is referenced in a new memory or turn.
	 * @param id - The entity ID
	 * @throws Error if entity not found
	 */
	incrementMentionCount(id: string): Promise<void>;

	// =============================================================================
	// Similarity Search
	// =============================================================================

	/**
	 * Find entities by embedding similarity.
	 * @param embedding - The query embedding vector
	 * @param limit - Maximum number of results to return
	 * @param threshold - Optional minimum similarity threshold (0-1)
	 * @returns Array of similar entities sorted by similarity (descending)
	 */
	findByEmbedding(embedding: number[], limit: number, threshold?: number): Promise<Entity[]>;

	/**
	 * Find entities similar to a given entity.
	 * Uses the entity's embedding to find similar entities.
	 * @param id - The entity ID to find similar entities for
	 * @param limit - Maximum number of results to return
	 * @returns Array of similar entities sorted by similarity (descending)
	 * @throws Error if entity not found or has no embedding
	 */
	findSimilarEntities(id: string, limit: number): Promise<Entity[]>;

	// =============================================================================
	// Edge Operations
	// =============================================================================

	/**
	 * Create a MENTIONS edge from a Memory to an Entity.
	 * Used when extracting entities from memory content.
	 * @param memoryId - The memory ID
	 * @param entityId - The entity ID
	 * @param context - Optional context snippet showing how the entity was mentioned
	 */
	createMentionsEdge(memoryId: string, entityId: string, context?: string): Promise<void>;

	/**
	 * Create a relationship between two entities.
	 * @param fromId - Source entity ID
	 * @param toId - Target entity ID
	 * @param type - Relationship type
	 * @param props - Optional relationship properties
	 */
	createRelationship(
		fromId: string,
		toId: string,
		type: "RELATED_TO" | "DEPENDS_ON" | "IMPLEMENTS" | "PART_OF",
		props?: Record<string, unknown>,
	): Promise<void>;

	// =============================================================================
	// Graph Traversal
	// =============================================================================

	/**
	 * Find all entities related to a given entity.
	 * Traverses RELATED_TO, DEPENDS_ON, IMPLEMENTS, and PART_OF edges.
	 * @param id - The entity ID
	 * @param depth - Optional traversal depth (default: 1)
	 * @returns Array of related entities
	 */
	findRelatedEntities(id: string, depth?: number): Promise<Entity[]>;

	/**
	 * Find all memories that mention a given entity.
	 * Traverses MENTIONS edges from the entity.
	 * @param id - The entity ID
	 * @returns Array of memories that mention this entity
	 */
	findMentioningMemories(id: string): Promise<Memory[]>;

	/**
	 * Find all entities within a project.
	 * @param project - The project identifier
	 * @returns Array of entities scoped to the specified project
	 */
	findByProject(project: string): Promise<Entity[]>;
}
