import { z } from "zod";

// =============================================================================
// Bitemporal Types - Source of Truth
// =============================================================================

/**
 * Bitemporal properties for graph nodes.
 * Supports both valid time (when data is true in reality) and
 * transaction time (when data was recorded in the system).
 *
 * - vt_start/vt_end: Valid time interval (epoch ms)
 * - tt_start/tt_end: Transaction time interval (epoch ms)
 */
export const BitemporalSchema = z.object({
	vt_start: z.number(),
	vt_end: z.number(),
	tt_start: z.number(),
	tt_end: z.number(),
});

export type Bitemporal = z.infer<typeof BitemporalSchema>;

/**
 * @deprecated Use Bitemporal instead
 */
export type BitemporalProperties = Bitemporal;

// =============================================================================
// Base Node Schema
// =============================================================================

/**
 * Base schema for all graph nodes.
 * All nodes have a unique ULID and labels, plus bitemporal properties.
 */
export const BaseNodeSchema = z
	.object({
		id: z.string().ulid(), // Unique Node ID
		labels: z.array(z.string()), // e.g., ['Turn', 'Session']
	})
	.merge(BitemporalSchema);

export type BaseNode = z.infer<typeof BaseNodeSchema>;

// =============================================================================
// FalkorDB Node Wrapper Types
// =============================================================================

/**
 * Wrapper type for FalkorDB node with typed properties.
 * This represents the raw structure returned by FalkorDB queries.
 *
 * Note: This is a convenience re-export. For direct FalkorDB operations,
 * import FalkorNode from @engram/storage instead.
 */
export interface FalkorNodeWrapper<T extends Record<string, unknown> = Record<string, unknown>> {
	id: number; // FalkorDB internal node ID
	labels: string[];
	properties: T;
}

/**
 * Wrapper type for FalkorDB edge with typed properties.
 */
export interface FalkorEdgeWrapper<T extends Record<string, unknown> = Record<string, unknown>> {
	id: number;
	relationshipType?: string;
	relation?: string;
	type?: string;
	sourceId?: number;
	srcNodeId?: number;
	destinationId?: number;
	destNodeId?: number;
	properties: T;
}

// =============================================================================
// Re-exports for Backward Compatibility
// =============================================================================

// These are re-exported from storage for backward compatibility.
// New code should import FalkorNode/FalkorEdge directly from @engram/storage.
// Re-export domain property types from storage for backward compatibility.
// These are deprecated - use Zod-inferred types from ./nodes.ts instead.
// Re-export composed FalkorNode types with aliases to avoid naming conflicts.
// Prefer using Zod-inferred types from ./nodes.ts for domain logic.
export type {
	FalkorEdge,
	FalkorNode,
	FalkorResult,
	FalkorRow,
	FileTouchNode as FalkorFileTouchNode,
	// Deprecated property types - use Zod schemas in nodes.ts
	FileTouchProperties,
	ObservationNode as FalkorObservationNode,
	ObservationProperties,
	QueryParam,
	QueryParams,
	ReasoningNode as FalkorReasoningNode,
	ReasoningProperties,
	SessionNode as FalkorSessionNode,
	SessionProperties,
	ThoughtNode as FalkorThoughtNode,
	ThoughtProperties,
	ToolCallNode as FalkorToolCallNode,
	ToolCallProperties,
	TurnNode as FalkorTurnNode,
	TurnProperties,
} from "@engram/storage/falkor";
