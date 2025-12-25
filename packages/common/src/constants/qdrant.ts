/**
 * Qdrant collection names and constants.
 *
 * @module @engram/common/constants/qdrant
 */

/**
 * Qdrant collection names.
 *
 * These are the canonical collection names used throughout Engram.
 * Always import from this module rather than hardcoding collection names.
 */
export const QdrantCollections = {
	/**
	 * Collection for explicit memories stored via remember/recall.
	 * Contains decisions, facts, insights, preferences created by agents.
	 * Uses text_dense (384-dim BGE) and text_sparse (BM25) vectors.
	 */
	MEMORY: "engram_memory",

	/**
	 * Collection for turn-level conversation data.
	 * Contains complete assistant turns from agent sessions.
	 * Uses turn_dense (384-dim BGE), turn_sparse (BM25), and turn_colbert vectors.
	 */
	TURNS: "engram_turns",
} as const;

/**
 * Type for valid collection names.
 */
export type QdrantCollectionName = (typeof QdrantCollections)[keyof typeof QdrantCollections];

/**
 * Vector field names for the memory collection.
 */
export const MemoryVectorFields = {
	DENSE: "text_dense",
	SPARSE: "text_sparse",
} as const;

/**
 * Vector field names for the turns collection.
 */
export const TurnsVectorFields = {
	DENSE: "turn_dense",
	SPARSE: "turn_sparse",
	COLBERT: "turn_colbert",
} as const;
