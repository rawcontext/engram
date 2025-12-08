import { z } from "zod";
import { BitemporalSchema } from "./base";

// All edges are bitemporal
export const BaseEdgeSchema = BitemporalSchema.extend({
	type: z.string(), // e.g., 'NEXT', 'HAS_TURN'
});

// =============================================================================
// Session → Turn hierarchy
// =============================================================================

// Session -[HAS_TURN]-> Turn
export const HasTurnEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("HAS_TURN"),
});

// Turn -[NEXT]-> Turn (sequential ordering within session)
export const NextEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("NEXT"),
});

// =============================================================================
// Turn → children hierarchy
// =============================================================================

// Turn -[CONTAINS]-> Reasoning (thinking blocks within a turn)
export const ContainsEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("CONTAINS"),
});

// Turn -[INVOKES]-> ToolCall
export const InvokesEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("INVOKES"),
});

// Turn -[TOUCHES]-> FileTouch
export const TouchesEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("TOUCHES"),
});

// =============================================================================
// Tool relationships
// =============================================================================

// ToolCall -[YIELDS]-> Observation
export const YieldsEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("YIELDS"),
});

// =============================================================================
// Code artifact relationships
// =============================================================================

// DiffHunk -[MODIFIES]-> CodeArtifact
export const ModifiesEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("MODIFIES"),
});

// Snapshot -[SNAPSHOT_OF]-> VFS state
export const SnapshotOfEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("SNAPSHOT_OF"),
});

// =============================================================================
// Versioning & deduplication
// =============================================================================

// Node -[REPLACES]-> Node (new version replaces old)
export const ReplacesEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("REPLACES"),
});

// Node -[SAME_AS]-> Node (deduplication link)
export const SameAsEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("SAME_AS"),
});

// =============================================================================
// DEPRECATED: Legacy edges (kept for migration)
// =============================================================================

// DEPRECATED: Use HAS_TURN instead
export const TriggersEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("TRIGGERS"),
});

// DEPRECATED: Use CONTAINS/INVOKES instead
export const MotivatedByEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("MOTIVATED_BY"),
});

// =============================================================================
// Edge type constants for use in queries
// =============================================================================
export const EdgeTypes = {
	// Session hierarchy
	HAS_TURN: "HAS_TURN",
	NEXT: "NEXT",

	// Turn hierarchy
	CONTAINS: "CONTAINS",
	INVOKES: "INVOKES",
	TOUCHES: "TOUCHES",

	// Tool relationships
	YIELDS: "YIELDS",

	// Code relationships
	MODIFIES: "MODIFIES",
	SNAPSHOT_OF: "SNAPSHOT_OF",

	// Versioning
	REPLACES: "REPLACES",
	SAME_AS: "SAME_AS",

	// Deprecated
	TRIGGERS: "TRIGGERS",
	MOTIVATED_BY: "MOTIVATED_BY",
} as const;

// Union of all edge types
export const EdgeSchema = z.union([
	HasTurnEdgeSchema,
	NextEdgeSchema,
	ContainsEdgeSchema,
	InvokesEdgeSchema,
	TouchesEdgeSchema,
	YieldsEdgeSchema,
	ModifiesEdgeSchema,
	SnapshotOfEdgeSchema,
	ReplacesEdgeSchema,
	SameAsEdgeSchema,
	TriggersEdgeSchema,
	MotivatedByEdgeSchema,
]);

export type Edge = z.infer<typeof EdgeSchema>;
