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

// ToolCall -[TOUCHES]-> FileTouch (captures file operations from tool calls)
// NOTE: Previously Turn -[TOUCHES]-> FileTouch, now routed through ToolCall for lineage
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
// Reasoning → ToolCall causal link
// =============================================================================

// Reasoning -[TRIGGERS]-> ToolCall (causal link from reasoning to tool invocation)
// This captures WHY a tool was called - the preceding thinking block that led to it
export const TriggersEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("TRIGGERS"),
});

// =============================================================================
// MCP Self-Instrumentation
// =============================================================================

// Session -[SELF_INVOKES]-> ToolCall (MCP server self-instrumentation)
// Captures tool calls made through MCP without an intermediate Turn node
export const SelfInvokesEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("SELF_INVOKES"),
});

// =============================================================================
// Entity relationships
// =============================================================================

// Memory -[MENTIONS]-> Entity (entity references in memory content)
export const MentionsEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("MENTIONS"),
	context: z.string(), // how entity appears in memory
});

// Entity -[RELATED_TO]-> Entity (semantic relationships between entities)
export const RelatedToEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("RELATED_TO"),
	relationship: z.string(), // nature of relationship
	strength: z.number().min(0).max(1), // confidence score
});

// Entity -[DEPENDS_ON]-> Entity (dependency relationships)
export const DependsOnEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("DEPENDS_ON"),
	dependency_type: z.enum(["runtime", "build", "optional"]),
});

// Entity -[IMPLEMENTS]-> Entity (implementation relationships)
export const ImplementsEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("IMPLEMENTS"),
	implementation_type: z.string(), // e.g., 'pattern', 'interface'
});

// Entity -[PART_OF]-> Entity (containment relationships)
export const PartOfEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("PART_OF"),
	containment_type: z.string(), // e.g., 'package', 'module', 'project'
});

// =============================================================================
// Community relationships
// =============================================================================

// Entity -[MEMBER_OF]-> Community (community membership)
export const MemberOfEdgeSchema = BaseEdgeSchema.extend({
	type: z.literal("MEMBER_OF"),
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

	// Reasoning → ToolCall → FileTouch lineage
	TRIGGERS: "TRIGGERS", // Reasoning -> ToolCall
	TOUCHES: "TOUCHES", // ToolCall -> FileTouch

	// Tool relationships
	YIELDS: "YIELDS",

	// Code relationships
	MODIFIES: "MODIFIES",
	SNAPSHOT_OF: "SNAPSHOT_OF",

	// Versioning
	REPLACES: "REPLACES",
	SAME_AS: "SAME_AS",

	// MCP Self-Instrumentation
	SELF_INVOKES: "SELF_INVOKES",

	// Entity relationships
	MENTIONS: "MENTIONS",
	RELATED_TO: "RELATED_TO",
	DEPENDS_ON: "DEPENDS_ON",
	IMPLEMENTS: "IMPLEMENTS",
	PART_OF: "PART_OF",

	// Community relationships
	MEMBER_OF: "MEMBER_OF",
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
	SelfInvokesEdgeSchema,
	MentionsEdgeSchema,
	RelatedToEdgeSchema,
	DependsOnEdgeSchema,
	ImplementsEdgeSchema,
	PartOfEdgeSchema,
	MemberOfEdgeSchema,
]);

export type Edge = z.infer<typeof EdgeSchema>;
