/**
 * Types and interfaces for memory conflict detection
 *
 * Conflict detection identifies relationships between new and existing memories,
 * enabling intelligent deduplication, invalidation, and merging strategies.
 */

/**
 * Relationship types between a new memory and existing memory
 *
 * These relations guide how the system should handle memory conflicts:
 * - CONTRADICTION: Mutually exclusive facts (e.g., "X is true" vs "X is false")
 * - SUPERSEDES: New fact replaces old fact (e.g., updated preference, newer decision)
 * - AUGMENTS: New fact complements old fact (e.g., additional context, refinement)
 * - DUPLICATE: Semantically identical facts (e.g., paraphrased statements)
 * - INDEPENDENT: Facts are unrelated or orthogonal
 */
export enum ConflictRelation {
	/** Facts directly contradict each other - one must be invalidated */
	CONTRADICTION = "contradiction",
	/** New fact replaces old fact - invalidate the old memory */
	SUPERSEDES = "supersedes",
	/** New fact adds to old fact - keep both with a relationship */
	AUGMENTS = "augments",
	/** Facts are essentially the same - skip new memory to avoid duplication */
	DUPLICATE = "duplicate",
	/** Facts are unrelated - safe to keep both independently */
	INDEPENDENT = "independent",
}

/**
 * An existing memory that may conflict with a new memory
 *
 * Candidates are identified through vector similarity search and then
 * analyzed by an LLM to determine the actual relationship type.
 */
export interface ConflictCandidate {
	/** Unique identifier (ULID) of the existing memory */
	memoryId: string;
	/** Full text content of the existing memory */
	content: string;
	/** Memory type (decision, preference, insight, fact, context) */
	type: string;
	/** Valid-time start timestamp (when the fact became true) */
	vt_start: number;
	/** Valid-time end timestamp (when the fact was invalidated, or Infinity) */
	vt_end: number;
	/** Vector similarity score [0, 1] between new and existing memory */
	similarity: number;
}

/**
 * Result of conflict detection analysis for a single candidate
 *
 * Contains the LLM's assessment of the relationship between a new memory
 * and an existing candidate, including recommended action.
 */
export interface ConflictDetectionResult {
	/** The new memory being evaluated */
	newMemory: {
		/** Text content of the new memory */
		content: string;
		/** Memory type of the new memory */
		type: string;
	};
	/** The existing memory candidate being compared */
	candidate: ConflictCandidate;
	/** Type of relationship between new and existing memory */
	relation: ConflictRelation;
	/** Confidence score [0, 1] in the relationship classification */
	confidence: number;
	/** Human-readable explanation of the relationship */
	reasoning: string;
	/**
	 * Recommended action based on the relationship:
	 * - keep_both: Store both memories (INDEPENDENT, AUGMENTS)
	 * - invalidate_old: Set vt_end on old memory (CONTRADICTION, SUPERSEDES)
	 * - skip_new: Don't store the new memory (DUPLICATE)
	 * - merge: Combine into a single updated memory (future feature)
	 */
	suggestedAction: "keep_both" | "invalidate_old" | "skip_new" | "merge";
}
