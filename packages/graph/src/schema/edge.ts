/**
 * Edge definition DSL for the Schema system.
 *
 * This module provides a type-safe builder pattern for defining graph edge (relationship) structures.
 * Inspired by Drizzle ORM's relations API and Neo4j Cypher relationship patterns.
 *
 * @example
 * ```typescript
 * import { edge, field } from '@engram/graph/schema';
 *
 * // Simple edge without properties
 * export const HasTurn = edge({
 *   from: 'Session',
 *   to: 'Turn',
 *   temporal: true,
 * });
 *
 * // Edge with properties
 * export const Mentions = edge({
 *   from: 'Memory',
 *   to: 'Entity',
 *   temporal: true,
 *   properties: {
 *     context: field.string().optional(),
 *     confidence: field.float().min(0).max(1),
 *   },
 * });
 *
 * // Self-referential edge
 * export const Replaces = edge({
 *   from: 'Memory',
 *   to: 'Memory',
 *   temporal: true,
 * });
 * ```
 */

import type { Field } from "./types";

// =============================================================================
// Edge Cardinality
// =============================================================================

/**
 * Cardinality hint for relationship patterns.
 *
 * - `one-to-one`: Single source to single target (e.g., User -> Profile)
 * - `one-to-many`: Single source to multiple targets (e.g., Session -> Turn)
 * - `many-to-one`: Multiple sources to single target (e.g., Turn -> Session)
 * - `many-to-many`: Multiple sources to multiple targets (e.g., Memory -> Entity)
 *
 * Note: This is a semantic hint for documentation and query optimization.
 * FalkorDB does not enforce cardinality constraints at the database level.
 */
export type EdgeCardinality = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";

// =============================================================================
// Edge Configuration
// =============================================================================

/**
 * Configuration for defining an edge (relationship) between nodes.
 *
 * @template TProperties - Object defining edge property fields
 */
export interface EdgeConfig<TProperties extends Record<string, Field> = Record<string, Field>> {
	/**
	 * Source node label (e.g., 'Session', 'Memory').
	 * Must match a valid node label in the graph schema.
	 */
	from: string;

	/**
	 * Target node label (e.g., 'Turn', 'Entity').
	 * Must match a valid node label in the graph schema.
	 */
	to: string;

	/**
	 * Whether this edge is bitemporal (has vt_start/vt_end, tt_start/tt_end).
	 *
	 * @default true - All edges are bitemporal by default for time-travel support
	 */
	temporal?: boolean;

	/**
	 * Optional properties attached to this edge.
	 * Uses the same field types as node schemas.
	 *
	 * @example
	 * ```typescript
	 * properties: {
	 *   weight: field.float().min(0).max(1),
	 *   context: field.string().optional(),
	 *   confidence: field.float(),
	 * }
	 * ```
	 */
	properties?: TProperties;

	/**
	 * Cardinality hint for this relationship.
	 * Used for documentation and query optimization.
	 *
	 * @default 'many-to-many'
	 */
	cardinality?: EdgeCardinality;

	/**
	 * Optional description of this edge type.
	 * Used for documentation and schema introspection.
	 */
	description?: string;
}

// =============================================================================
// Edge Definition
// =============================================================================

/**
 * Edge definition class created by the edge() factory.
 * Stores type-safe configuration for a graph relationship.
 *
 * @template TProperties - Object defining edge property fields
 */
export class EdgeDefinition<TProperties extends Record<string, Field> = Record<string, Field>> {
	readonly config: Required<Omit<EdgeConfig<TProperties>, "properties" | "description">> & {
		properties: TProperties;
		description?: string;
	};

	constructor(config: EdgeConfig<TProperties>) {
		this.config = {
			from: config.from,
			to: config.to,
			temporal: config.temporal ?? true,
			properties: (config.properties ?? {}) as TProperties,
			cardinality: config.cardinality ?? "many-to-many",
			description: config.description,
		};
	}

	/**
	 * Check if this edge has properties.
	 */
	hasProperties(): boolean {
		return Object.keys(this.config.properties).length > 0;
	}

	/**
	 * Get the property field definitions.
	 */
	getProperties(): TProperties {
		return this.config.properties;
	}

	/**
	 * Get the source node label.
	 */
	getFrom(): string {
		return this.config.from;
	}

	/**
	 * Get the target node label.
	 */
	getTo(): string {
		return this.config.to;
	}

	/**
	 * Check if this edge is bitemporal.
	 */
	isTemporal(): boolean {
		return this.config.temporal;
	}

	/**
	 * Get the cardinality hint.
	 */
	getCardinality(): EdgeCardinality {
		return this.config.cardinality;
	}

	/**
	 * Get the description if provided.
	 */
	getDescription(): string | undefined {
		return this.config.description;
	}
}

// =============================================================================
// Edge Factory
// =============================================================================

/**
 * Create an edge definition with type-safe properties.
 *
 * @example
 * ```typescript
 * // Simple edge without properties
 * const HasTurn = edge({
 *   from: 'Session',
 *   to: 'Turn',
 *   cardinality: 'one-to-many',
 * });
 *
 * // Edge with properties
 * const Mentions = edge({
 *   from: 'Memory',
 *   to: 'Entity',
 *   properties: {
 *     context: field.string().optional(),
 *     confidence: field.float().min(0).max(1),
 *     mentionCount: field.int().min(1).default(1),
 *   },
 * });
 *
 * // Self-referential edge
 * const Replaces = edge({
 *   from: 'Memory',
 *   to: 'Memory',
 *   cardinality: 'one-to-one',
 *   description: 'New version replaces old version',
 * });
 * ```
 */
export function edge<TProperties extends Record<string, Field> = Record<string, Field>>(
	config: EdgeConfig<TProperties>,
): EdgeDefinition<TProperties> {
	return new EdgeDefinition(config);
}

// =============================================================================
// Type Inference Helpers
// =============================================================================

/**
 * Infer the TypeScript type of edge properties from an EdgeDefinition.
 *
 * @example
 * ```typescript
 * const Mentions = edge({
 *   from: 'Memory',
 *   to: 'Entity',
 *   properties: {
 *     confidence: field.float(),
 *     context: field.string().optional(),
 *   },
 * });
 *
 * type MentionsProps = InferEdgeProperties<typeof Mentions>;
 * // { confidence: number; context?: string }
 * ```
 */
export type InferEdgeProperties<E extends EdgeDefinition<any>> =
	E extends EdgeDefinition<infer TProperties>
		? {
				[K in keyof TProperties]: TProperties[K] extends Field<infer T>
					? TProperties[K]["config"]["optional"] extends true
						? T | undefined
						: T
					: never;
			}
		: never;

/**
 * Infer the full edge schema including bitemporal fields.
 *
 * @example
 * ```typescript
 * const HasTurn = edge({
 *   from: 'Session',
 *   to: 'Turn',
 *   temporal: true,
 * });
 *
 * type HasTurnEdge = InferEdgeSchema<typeof HasTurn>;
 * // { vt_start: number; vt_end: number; tt_start: number; tt_end: number }
 * ```
 */
export type InferEdgeSchema<E extends EdgeDefinition<any>> =
	E extends EdgeDefinition<any>
		? (E["config"]["temporal"] extends true
				? {
						vt_start: number;
						vt_end: number;
						tt_start: number;
						tt_end: number;
					}
				: Record<string, never>) &
				InferEdgeProperties<E>
		: never;
