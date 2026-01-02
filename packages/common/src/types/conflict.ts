/**
 * Shared types for memory conflict detection and resolution.
 *
 * These types are used by both the MCP server (conflict detection) and
 * the audit logging system.
 */

/**
 * Relationship types between a new memory and existing memory.
 *
 * These relations guide how the system should handle memory conflicts:
 * - CONTRADICTION: Mutually exclusive facts (e.g., "X is true" vs "X is false")
 * - SUPERSEDES: New fact replaces old fact (e.g., updated preference, newer decision)
 * - AUGMENTS: New fact complements old fact (e.g., additional context, refinement)
 * - DUPLICATE: Semantically identical facts (e.g., paraphrased statements)
 * - INDEPENDENT: Facts are unrelated or orthogonal
 */
export type ConflictRelation =
	| "contradiction"
	| "supersedes"
	| "augments"
	| "duplicate"
	| "independent";

/**
 * Enum version for backwards compatibility with MCP server.
 */
export const ConflictRelationEnum = {
	CONTRADICTION: "contradiction",
	SUPERSEDES: "supersedes",
	AUGMENTS: "augments",
	DUPLICATE: "duplicate",
	INDEPENDENT: "independent",
} as const;

/**
 * Suggested action based on conflict relationship.
 */
export type ConflictSuggestedAction = "keep_both" | "invalidate_old" | "skip_new" | "merge";
