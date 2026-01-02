import { z } from "zod";
import { BaseNodeSchema } from "./base";

// =============================================================================
// ConflictRelation Enum - Relationship types between memories
// =============================================================================
export const ConflictRelation = {
	/** Facts directly contradict each other - one must be invalidated */
	CONTRADICTION: "contradiction",
	/** New fact replaces old fact - invalidate the old memory */
	SUPERSEDES: "supersedes",
	/** New fact adds to old fact - keep both with a relationship */
	AUGMENTS: "augments",
	/** Facts are essentially the same - skip new memory to avoid duplication */
	DUPLICATE: "duplicate",
	/** Facts are unrelated - safe to keep both independently */
	INDEPENDENT: "independent",
} as const;

export type ConflictRelationValue = (typeof ConflictRelation)[keyof typeof ConflictRelation];

export const ConflictRelationEnum = z.enum([
	"contradiction",
	"supersedes",
	"augments",
	"duplicate",
	"independent",
]);

// =============================================================================
// ConflictDecisionNode: Audit trail for memory conflict resolution
// =============================================================================
export const ConflictDecisionNodeSchema = BaseNodeSchema.extend({
	labels: z.tuple([z.literal("ConflictDecision")]),

	// Memory references
	newMemoryId: z.string(), // ULID of the new memory being evaluated
	existingMemoryId: z.string(), // ULID of the existing memory candidate

	// Conflict analysis
	relation: ConflictRelationEnum, // Type of relationship between memories
	reason: z.string(), // Human-readable explanation of the decision

	// Model attribution
	modelUsed: z.string(), // e.g., "gemini-3-flash-preview", "mcp-sampling"

	// User confirmation
	userConfirmed: z.boolean(), // Whether user explicitly approved the action

	// Action taken
	actionTaken: z.enum(["keep_both", "invalidate_old", "skip_new", "merge"]),

	// Metadata
	timestamp: z.number(), // Epoch ms when decision was made
	orgId: z.string(), // Organization ID for multi-tenancy
});

export type ConflictDecisionNode = z.infer<typeof ConflictDecisionNodeSchema>;
