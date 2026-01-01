/**
 * Node definition DSL for the Schema system.
 *
 * This module provides a type-safe way to define graph node structures with automatic
 * bitemporal field injection and full TypeScript type inference.
 *
 * Inspired by Drizzle ORM's pgTable pattern with $inferSelect/$inferInsert.
 *
 * @example
 * ```typescript
 * import { node, field } from '@engram/graph/schema';
 *
 * export const MemoryNode = node({
 *   content: field.string(),
 *   content_hash: field.string(),
 *   type: field.enum(['decision', 'context', 'insight', 'preference', 'fact', 'turn']),
 *   tags: field.array(field.string()),
 *   embedding: field.vector(1024).optional(),
 * });
 *
 * // Type inference
 * type Memory = typeof MemoryNode.$inferSelect;
 * // => { content: string; content_hash: string; type: 'decision' | ...; tags: string[]; embedding?: number[]; vt_start: number; vt_end: number; tt_start: number; tt_end: number; }
 *
 * type InsertMemory = typeof MemoryNode.$inferInsert;
 * // => Same as above, but bitemporal fields may be optional depending on insertion logic
 * ```
 */

import type { Field } from "./types";

// =============================================================================
// Type Inference Utilities
// =============================================================================

/**
 * Infer the TypeScript type from a Field definition.
 * Handles optional fields, default values, and nested arrays/enums.
 */
type InferFieldType<F> =
	F extends Field<infer T> ? (F["config"]["optional"] extends true ? T | undefined : T) : never;

/**
 * Infer the complete TypeScript type from a node field definition object.
 * Converts field definitions to their corresponding TypeScript types.
 */
type InferNodeFields<TFields extends Record<string, Field>> = {
	[K in keyof TFields]: InferFieldType<TFields[K]>;
};

/**
 * Bitemporal fields automatically added to all nodes (unless disabled).
 * These fields track valid time (vt_*) and transaction time (tt_*).
 */
export interface BitemporalFields {
	/**
	 * Valid time start (epoch milliseconds).
	 * When this version of the data became valid in the real world.
	 */
	vt_start: number;

	/**
	 * Valid time end (epoch milliseconds).
	 * When this version of the data ceased to be valid. Infinity for current.
	 */
	vt_end: number;

	/**
	 * Transaction time start (epoch milliseconds).
	 * When this version was recorded in the database.
	 */
	tt_start: number;

	/**
	 * Transaction time end (epoch milliseconds).
	 * When this version was superseded. Infinity for current.
	 */
	tt_end: number;
}

// =============================================================================
// Node Definition
// =============================================================================

/**
 * Configuration options for node definitions.
 */
export interface NodeConfig {
	/**
	 * Whether to automatically inject bitemporal fields (vt_start, vt_end, tt_start, tt_end).
	 * @default true
	 */
	bitemporal?: boolean;

	/**
	 * Optional label for the node in the graph.
	 * If not provided, the variable name is typically used.
	 */
	label?: string;
}

/**
 * Node definition object returned by the node() function.
 * Contains both runtime metadata and type inference helpers.
 */
export interface NodeDefinition<
	TFields extends Record<string, Field>,
	TBitemporal extends boolean = boolean,
> {
	/**
	 * The field definitions for this node.
	 */
	readonly fields: TFields;

	/**
	 * Configuration for this node.
	 */
	readonly config: Required<NodeConfig> & { bitemporal: TBitemporal };

	/**
	 * Type inference helper for select operations.
	 * Returns the full TypeScript type including bitemporal fields.
	 *
	 * @example
	 * ```typescript
	 * type Memory = typeof MemoryNode.$inferSelect;
	 * ```
	 */
	readonly $inferSelect: TBitemporal extends true
		? InferNodeFields<TFields> & BitemporalFields
		: InferNodeFields<TFields>;

	/**
	 * Type inference helper for insert operations.
	 * Similar to $inferSelect but may handle defaults differently.
	 *
	 * @example
	 * ```typescript
	 * type InsertMemory = typeof MemoryNode.$inferInsert;
	 * ```
	 */
	readonly $inferInsert: TBitemporal extends true
		? InferNodeFields<TFields> & BitemporalFields
		: InferNodeFields<TFields>;
}

/**
 * Define a graph node with typed fields and automatic bitemporal support.
 *
 * This is the main entry point for creating node schemas. It accepts a record of
 * field definitions and optional configuration, returning a NodeDefinition object
 * with full type inference support.
 *
 * @param fields - Record of field definitions using the field builder
 * @param config - Optional configuration (bitemporal, label, etc.)
 * @returns NodeDefinition with type inference helpers
 *
 * @example
 * ```typescript
 * import { node, field } from '@engram/graph/schema';
 *
 * // Define a Memory node
 * export const MemoryNode = node({
 *   content: field.string(),
 *   content_hash: field.string(),
 *   type: field.enum(['decision', 'context', 'insight', 'preference', 'fact', 'turn'] as const),
 *   tags: field.array(field.string()),
 *   project: field.string().optional(),
 *   embedding: field.vector(1024).optional(),
 * });
 *
 * // Use type inference
 * type Memory = typeof MemoryNode.$inferSelect;
 * // { content: string; content_hash: string; type: MemoryType; tags: string[]; project?: string; embedding?: number[]; vt_start: number; ... }
 *
 * // Disable bitemporal for special nodes
 * export const ConfigNode = node({
 *   key: field.string(),
 *   value: field.string(),
 * }, { bitemporal: false });
 *
 * type Config = typeof ConfigNode.$inferSelect;
 * // { key: string; value: string } - no bitemporal fields
 * ```
 */
export function node<
	TFields extends Record<string, Field>,
	TConfig extends NodeConfig = NodeConfig,
>(
	fields: TFields,
	config?: TConfig,
): NodeDefinition<TFields, TConfig extends { bitemporal: infer B extends boolean } ? B : true> {
	const finalConfig = {
		bitemporal: config?.bitemporal ?? true,
		label: config?.label ?? "",
	} as const;

	return {
		fields,
		config: finalConfig,
		// Type inference properties (never actually accessed at runtime)
		$inferSelect: undefined as never,
		$inferInsert: undefined as never,
	} as never;
}

// =============================================================================
// Helper Types for External Use
// =============================================================================

/**
 * Utility type to infer the select model from a node definition.
 * Alternative to using `typeof NodeDef.$inferSelect`.
 *
 * @example
 * ```typescript
 * import type { InferSelectModel } from '@engram/graph/schema';
 *
 * type Memory = InferSelectModel<typeof MemoryNode>;
 * ```
 */
export type InferSelectModel<TNode> =
	TNode extends NodeDefinition<infer TFields, infer TBitemporal>
		? TBitemporal extends true
			? InferNodeFields<TFields> & BitemporalFields
			: InferNodeFields<TFields>
		: never;

/**
 * Utility type to infer the insert model from a node definition.
 * Alternative to using `typeof NodeDef.$inferInsert`.
 *
 * @example
 * ```typescript
 * import type { InferInsertModel } from '@engram/graph/schema';
 *
 * type InsertMemory = InferInsertModel<typeof MemoryNode>;
 * ```
 */
export type InferInsertModel<TNode> =
	TNode extends NodeDefinition<infer TFields, infer TBitemporal>
		? TBitemporal extends true
			? InferNodeFields<TFields> & BitemporalFields
			: InferNodeFields<TFields>
		: never;
