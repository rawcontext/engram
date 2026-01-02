/**
 * Runtime module for the compiled query layer.
 *
 * Exports the base query builder, traversal builder, and types needed for:
 * - Generated query builders (from codegen)
 * - Custom query builders
 * - Graph traversal queries
 * - Runtime type definitions
 */

export { BaseQueryBuilder } from "./base-query-builder";
export { BaseTraversalBuilder, traverse } from "./base-traversal-builder";
export type {
	AnyEdgeCondition,
	BitemporalTraversalOptions,
	EdgeCondition,
	EdgeDirection,
	PathLength,
	PathResult,
	RawEdgeCondition,
	ReturnSpec,
	TraversalPath,
	TraversalResult,
	TraversalStep,
} from "./traversal-types";
export { isRawEdgeCondition } from "./traversal-types";
export type {
	AnyCondition,
	BitemporalOptions,
	CollectionOperator,
	ComparisonOperator,
	Condition,
	Operator,
	OrderBySpec,
	QueryClient,
	QueryExecutionOptions,
	QueryResult,
	QueryStats,
	RawCondition,
	SortDirection,
	StringOperator,
} from "./types";
export { isRawCondition } from "./types";
