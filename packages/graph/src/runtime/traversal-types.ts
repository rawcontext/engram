/**
 * Traversal Builder Types
 *
 * Type definitions for the graph traversal builder runtime.
 * Supports fluent API construction of Cypher path patterns with:
 * - Edge type filtering
 * - Direction specification
 * - Variable-length path expressions
 * - Edge property conditions
 * - Bitemporal traversal constraints
 */

import type { Operator } from "./types";

// =============================================================================
// Edge Direction
// =============================================================================

/**
 * Direction of edge traversal.
 *
 * - `outgoing`: (a)-[e]->(b) - traverse from source to target
 * - `incoming`: (a)<-[e]-(b) - traverse from target to source
 * - `any`: (a)-[e]-(b) - traverse in either direction
 */
export type EdgeDirection = "outgoing" | "incoming" | "any";

// =============================================================================
// Path Length Specification
// =============================================================================

/**
 * Variable-length path specification.
 *
 * Used to generate Cypher patterns like:
 * - `*1..5` (min 1, max 5 hops)
 * - `*3` (exactly 3 hops)
 * - `*..10` (0 to 10 hops)
 * - `*1..` (1 or more hops)
 */
export interface PathLength {
	/** Minimum number of hops (default: 1) */
	min?: number;
	/** Maximum number of hops (undefined = unlimited) */
	max?: number;
}

// =============================================================================
// Edge Condition
// =============================================================================

/**
 * Condition applied to edge properties.
 */
export interface EdgeCondition {
	/** The edge property name */
	field: string;
	/** Comparison operator */
	operator: Operator;
	/** Parameter name for the value */
	paramName: string;
}

/**
 * Raw Cypher condition for edge filtering.
 */
export interface RawEdgeCondition {
	/** Raw Cypher expression */
	cypher: string;
}

/**
 * Union of edge condition types.
 */
export type AnyEdgeCondition = EdgeCondition | RawEdgeCondition;

/**
 * Type guard for RawEdgeCondition.
 */
export function isRawEdgeCondition(condition: AnyEdgeCondition): condition is RawEdgeCondition {
	return "cypher" in condition;
}

// =============================================================================
// Traversal Step
// =============================================================================

/**
 * A single step in a graph traversal.
 *
 * Represents the pattern: (source)-[edge]->(target)
 */
export interface TraversalStep {
	/** Edge type(s) to traverse (e.g., "HAS_TURN", ["INVOKES", "CONTAINS"]) */
	edgeTypes: string[];
	/** Direction of traversal */
	direction: EdgeDirection;
	/** Variable-length path spec (optional) */
	pathLength?: PathLength;
	/** Alias for the edge variable in Cypher (e.g., "e", "rel") */
	edgeAlias?: string;
	/** Target node label (optional, for MATCH pattern) */
	targetLabel?: string;
	/** Alias for the target node variable */
	targetAlias: string;
	/** Conditions on edge properties */
	edgeConditions: AnyEdgeCondition[];
	/** Conditions on target node properties */
	targetConditions: Record<string, unknown>;
}

// =============================================================================
// Traversal Path
// =============================================================================

/**
 * Complete traversal path specification.
 *
 * Represents a full path pattern like:
 * (s:Session)-[:HAS_TURN]->(t:Turn)-[:INVOKES]->(tc:ToolCall)
 */
export interface TraversalPath {
	/** Starting node label */
	startLabel: string;
	/** Starting node alias */
	startAlias: string;
	/** Conditions on the starting node */
	startConditions: Record<string, unknown>;
	/** Sequence of traversal steps */
	steps: TraversalStep[];
}

// =============================================================================
// Return Specification
// =============================================================================

/**
 * Specification for what to return from a traversal query.
 */
export interface ReturnSpec {
	/** Node/edge aliases to return */
	aliases: string[];
	/** Whether to return distinct results */
	distinct?: boolean;
	/** Properties to project (alias -> property name or "*" for all) */
	projections?: Record<string, string | "*">;
}

// =============================================================================
// Traversal Result Types
// =============================================================================

/**
 * Result of a path traversal with edge data.
 */
export interface PathResult<TStart, TEnd, TEdge = Record<string, unknown>> {
	/** Starting node */
	start: TStart;
	/** Ending node */
	end: TEnd;
	/** Edge connecting them (for single-hop traversals) */
	edge?: TEdge;
	/** Full path (for multi-hop traversals) */
	path?: Array<{
		node: TStart | TEnd;
		edge?: TEdge;
	}>;
}

/**
 * Result when returning just the target nodes.
 */
export interface TraversalResult<T> {
	/** The matching nodes */
	nodes: T[];
}

// =============================================================================
// Bitemporal Traversal Options
// =============================================================================

/**
 * Options for bitemporal constraints on traversals.
 */
export interface BitemporalTraversalOptions {
	/**
	 * Point in valid time to query.
	 * Filters edges where vt_start <= timestamp < vt_end
	 */
	validTime?: number;
	/**
	 * Point in transaction time to query.
	 * Filters edges where tt_start <= timestamp < tt_end
	 */
	transactionTime?: number | "current";
	/**
	 * Apply bitemporal constraints to which parts of the traversal.
	 * @default { nodes: true, edges: true }
	 */
	apply?: {
		nodes?: boolean;
		edges?: boolean;
	};
}
