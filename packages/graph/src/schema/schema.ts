/**
 * Schema composition for combining node and edge definitions into a complete graph schema.
 *
 * This module provides the defineSchema() function that combines node and edge definitions,
 * validates references, and provides full type inference for the complete schema structure.
 *
 * Inspired by Drizzle ORM's schema composition and Prisma's relationship validation.
 *
 * @example
 * ```typescript
 * import { defineSchema } from '@engram/graph/schema';
 * import { MemoryNode, SessionNode, TurnNode } from './nodes';
 * import { HasTurn, Mentions, Replaces } from './edges';
 *
 * export const schema = defineSchema({
 *   nodes: {
 *     Memory: MemoryNode,
 *     Session: SessionNode,
 *     Turn: TurnNode,
 *   },
 *   edges: {
 *     HAS_TURN: HasTurn,
 *     MENTIONS: Mentions,
 *     REPLACES: Replaces,
 *   },
 * });
 *
 * // Inferred types
 * type Schema = typeof schema;
 * type NodeTypes = keyof Schema['nodes']; // 'Memory' | 'Session' | 'Turn'
 * type EdgeTypes = keyof Schema['edges']; // 'HAS_TURN' | 'MENTIONS' | 'REPLACES'
 * ```
 */

import type { EdgeDefinition } from "./edge";
import type { NodeDefinition } from "./node";

// =============================================================================
// Schema Definition Types
// =============================================================================

/**
 * Schema configuration combining node and edge definitions.
 */
export interface SchemaConfig<
	TNodes extends Record<string, NodeDefinition<any, any>>,
	TEdges extends Record<string, EdgeDefinition<any>>,
> {
	/**
	 * Node definitions keyed by their label/type name.
	 *
	 * @example
	 * ```typescript
	 * nodes: {
	 *   Memory: MemoryNode,
	 *   Session: SessionNode,
	 *   Turn: TurnNode,
	 * }
	 * ```
	 */
	nodes: TNodes;

	/**
	 * Edge definitions keyed by their relationship type name.
	 *
	 * @example
	 * ```typescript
	 * edges: {
	 *   HAS_TURN: HasTurn,
	 *   MENTIONS: Mentions,
	 *   REPLACES: Replaces,
	 * }
	 * ```
	 */
	edges: TEdges;
}

/**
 * Complete schema definition with validation and runtime metadata access.
 */
export interface Schema<
	TNodes extends Record<string, NodeDefinition<any, any>>,
	TEdges extends Record<string, EdgeDefinition<any>>,
> {
	/**
	 * Node definitions by label.
	 */
	readonly nodes: TNodes;

	/**
	 * Edge definitions by relationship type.
	 */
	readonly edges: TEdges;

	/**
	 * Validation errors found during schema composition.
	 * Empty array if schema is valid.
	 */
	readonly validationErrors: string[];

	/**
	 * Check if the schema is valid (no validation errors).
	 */
	isValid(): boolean;

	/**
	 * Get all node labels.
	 */
	getNodeLabels(): string[];

	/**
	 * Get all edge types.
	 */
	getEdgeTypes(): string[];

	/**
	 * Get a node definition by label.
	 */
	getNode<K extends keyof TNodes>(label: K): TNodes[K] | undefined;

	/**
	 * Get an edge definition by type.
	 */
	getEdge<K extends keyof TEdges>(type: K): TEdges[K] | undefined;

	/**
	 * Get all edges that originate from a given node label.
	 */
	getEdgesFrom(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }>;

	/**
	 * Get all edges that target a given node label.
	 */
	getEdgesTo(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }>;

	/**
	 * Get all edges connected to a given node label (either from or to).
	 */
	getEdgesFor(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }>;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validation errors that can occur during schema composition.
 */
export class SchemaValidationError extends Error {
	constructor(
		_message: string,
		public readonly errors: string[],
	) {
		super(`Schema validation failed:\n  - ${errors.join("\n  - ")}`);
		this.name = "SchemaValidationError";
	}
}

/**
 * Validate edge references against node labels.
 * Returns array of validation error messages.
 */
function validateEdgeReferences<
	TNodes extends Record<string, NodeDefinition<any, any>>,
	TEdges extends Record<string, EdgeDefinition<any>>,
>(nodes: TNodes, edges: TEdges): string[] {
	const errors: string[] = [];
	const nodeLabels = Object.keys(nodes);

	for (const [edgeType, edgeDef] of Object.entries(edges)) {
		const from = edgeDef.getFrom();
		const to = edgeDef.getTo();

		// Check 'from' reference
		if (!nodeLabels.includes(from)) {
			errors.push(
				`Edge '${edgeType}' references unknown source node '${from}'. Available nodes: ${nodeLabels.join(", ")}`,
			);
		}

		// Check 'to' reference
		if (!nodeLabels.includes(to)) {
			errors.push(
				`Edge '${edgeType}' references unknown target node '${to}'. Available nodes: ${nodeLabels.join(", ")}`,
			);
		}
	}

	return errors;
}

/**
 * Validate node names are valid identifiers.
 * Returns array of validation error messages.
 */
function validateNodeNames<TNodes extends Record<string, NodeDefinition<any, any>>>(
	nodes: TNodes,
): string[] {
	const errors: string[] = [];
	const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

	for (const nodeLabel of Object.keys(nodes)) {
		if (!identifierPattern.test(nodeLabel)) {
			errors.push(
				`Node label '${nodeLabel}' is not a valid identifier. Must match pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
			);
		}
	}

	return errors;
}

/**
 * Validate edge names are valid identifiers.
 * Returns array of validation error messages.
 */
function validateEdgeNames<TEdges extends Record<string, EdgeDefinition<any>>>(
	edges: TEdges,
): string[] {
	const errors: string[] = [];
	const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

	for (const edgeType of Object.keys(edges)) {
		if (!identifierPattern.test(edgeType)) {
			errors.push(
				`Edge type '${edgeType}' is not a valid identifier. Must match pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
			);
		}
	}

	return errors;
}

/**
 * Check for duplicate names between nodes and edges (case-insensitive).
 * Returns array of validation warnings.
 */
function checkDuplicateNames<
	TNodes extends Record<string, NodeDefinition<any, any>>,
	TEdges extends Record<string, EdgeDefinition<any>>,
>(nodes: TNodes, edges: TEdges): string[] {
	const warnings: string[] = [];
	const nodeLabelsLower = Object.keys(nodes).map((label) => label.toLowerCase());

	for (const edgeType of Object.keys(edges)) {
		if (nodeLabelsLower.includes(edgeType.toLowerCase())) {
			warnings.push(
				`Edge type '${edgeType}' has the same name as a node (case-insensitive). This may cause confusion.`,
			);
		}
	}

	return warnings;
}

// =============================================================================
// Schema Factory
// =============================================================================

/**
 * Define a complete graph schema combining node and edge definitions.
 *
 * This function validates that:
 * - All edge 'from' and 'to' references exist in the nodes
 * - Node and edge names are valid identifiers
 * - No duplicate names exist
 *
 * The returned schema object provides runtime access to all definitions and
 * maintains full type inference for TypeScript.
 *
 * @param config - Schema configuration with nodes and edges
 * @param options - Optional validation options
 * @returns Complete schema with validation and metadata access
 * @throws SchemaValidationError if validation fails and strict mode is enabled
 *
 * @example
 * ```typescript
 * import { defineSchema, node, edge, field } from '@engram/graph/schema';
 *
 * const MemoryNode = node({
 *   content: field.string(),
 *   type: field.enum(['decision', 'context', 'insight'] as const),
 * });
 *
 * const SessionNode = node({
 *   id: field.string(),
 *   agent_type: field.string(),
 * });
 *
 * const HasMemory = edge({
 *   from: 'Session',
 *   to: 'Memory',
 * });
 *
 * const schema = defineSchema({
 *   nodes: {
 *     Memory: MemoryNode,
 *     Session: SessionNode,
 *   },
 *   edges: {
 *     HAS_MEMORY: HasMemory,
 *   },
 * });
 *
 * // Type inference
 * type NodeTypes = keyof typeof schema.nodes; // 'Memory' | 'Session'
 * type EdgeTypes = keyof typeof schema.edges; // 'HAS_MEMORY'
 *
 * // Runtime access
 * console.log(schema.getNodeLabels()); // ['Memory', 'Session']
 * console.log(schema.isValid()); // true
 * const memoryEdges = schema.getEdgesFrom('Session'); // [{ type: 'HAS_MEMORY', edge: HasMemory }]
 * ```
 */
export function defineSchema<
	TNodes extends Record<string, NodeDefinition<any, any>>,
	TEdges extends Record<string, EdgeDefinition<any>>,
>(
	config: SchemaConfig<TNodes, TEdges>,
	options: {
		/**
		 * Throw an error if validation fails.
		 * @default false
		 */
		strict?: boolean;
	} = {},
): Schema<TNodes, TEdges> {
	const { nodes, edges } = config;
	const { strict = false } = options;

	// Collect all validation errors
	const validationErrors: string[] = [
		...validateNodeNames(nodes),
		...validateEdgeNames(edges),
		...validateEdgeReferences(nodes, edges),
		...checkDuplicateNames(nodes, edges),
	];

	// Throw in strict mode if there are errors
	if (strict && validationErrors.length > 0) {
		throw new SchemaValidationError("Schema validation failed", validationErrors);
	}

	// Create schema object
	const schema: Schema<TNodes, TEdges> = {
		nodes,
		edges,
		validationErrors,

		isValid(): boolean {
			return this.validationErrors.length === 0;
		},

		getNodeLabels(): string[] {
			return Object.keys(this.nodes);
		},

		getEdgeTypes(): string[] {
			return Object.keys(this.edges);
		},

		getNode<K extends keyof TNodes>(label: K): TNodes[K] | undefined {
			return this.nodes[label];
		},

		getEdge<K extends keyof TEdges>(type: K): TEdges[K] | undefined {
			return this.edges[type];
		},

		getEdgesFrom(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }> {
			const result: Array<{ type: string; edge: TEdges[keyof TEdges] }> = [];
			for (const [type, edgeDef] of Object.entries(this.edges)) {
				if (edgeDef.getFrom() === nodeLabel) {
					result.push({ type, edge: edgeDef as TEdges[keyof TEdges] });
				}
			}
			return result;
		},

		getEdgesTo(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }> {
			const result: Array<{ type: string; edge: TEdges[keyof TEdges] }> = [];
			for (const [type, edgeDef] of Object.entries(this.edges)) {
				if (edgeDef.getTo() === nodeLabel) {
					result.push({ type, edge: edgeDef as TEdges[keyof TEdges] });
				}
			}
			return result;
		},

		getEdgesFor(nodeLabel: string): Array<{ type: string; edge: TEdges[keyof TEdges] }> {
			const result: Array<{ type: string; edge: TEdges[keyof TEdges] }> = [];
			for (const [type, edgeDef] of Object.entries(this.edges)) {
				if (edgeDef.getFrom() === nodeLabel || edgeDef.getTo() === nodeLabel) {
					result.push({ type, edge: edgeDef as TEdges[keyof TEdges] });
				}
			}
			return result;
		},
	};

	return schema;
}

// =============================================================================
// Type Inference Helpers
// =============================================================================

/**
 * Extract node type names from a schema.
 *
 * @example
 * ```typescript
 * type NodeTypes = InferNodeTypes<typeof schema>;
 * // 'Memory' | 'Session' | 'Turn'
 * ```
 */
export type InferNodeTypes<S> = S extends Schema<infer TNodes, any> ? keyof TNodes : never;

/**
 * Extract edge type names from a schema.
 *
 * @example
 * ```typescript
 * type EdgeTypes = InferEdgeTypes<typeof schema>;
 * // 'HAS_TURN' | 'MENTIONS' | 'REPLACES'
 * ```
 */
export type InferEdgeTypes<S> = S extends Schema<any, infer TEdges> ? keyof TEdges : never;

/**
 * Extract the complete node definitions map from a schema.
 *
 * @example
 * ```typescript
 * type Nodes = InferNodes<typeof schema>;
 * // { Memory: NodeDefinition<...>, Session: NodeDefinition<...>, ... }
 * ```
 */
export type InferNodes<S> = S extends Schema<infer TNodes, any> ? TNodes : never;

/**
 * Extract the complete edge definitions map from a schema.
 *
 * @example
 * ```typescript
 * type Edges = InferEdges<typeof schema>;
 * // { HAS_TURN: EdgeDefinition<...>, MENTIONS: EdgeDefinition<...>, ... }
 * ```
 */
export type InferEdges<S> = S extends Schema<any, infer TEdges> ? TEdges : never;
