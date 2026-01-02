/**
 * Runtime module for the compiled query layer.
 *
 * Exports the base query builder and types needed for:
 * - Generated query builders (from codegen)
 * - Custom query builders
 * - Runtime type definitions
 */

export { BaseQueryBuilder } from "./base-query-builder";
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
