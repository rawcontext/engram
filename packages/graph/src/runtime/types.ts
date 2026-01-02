/**
 * Runtime types for the compiled query layer.
 *
 * This module defines the core types used by the BaseQueryBuilder and
 * generated query builders for type-safe Cypher query construction.
 */

// =============================================================================
// Condition Operators
// =============================================================================

/**
 * Comparison operators supported by the query builder.
 */
export type ComparisonOperator = "=" | "<>" | "<" | "<=" | ">" | ">=";

/**
 * String operators for pattern matching.
 */
export type StringOperator = "STARTS WITH" | "ENDS WITH" | "CONTAINS";

/**
 * Collection operators for array operations.
 */
export type CollectionOperator = "IN" | "NOT IN";

/**
 * All supported operators.
 */
export type Operator = ComparisonOperator | StringOperator | CollectionOperator;

// =============================================================================
// Condition Types
// =============================================================================

/**
 * A single condition in a WHERE clause.
 */
export interface Condition {
	/** The property name on the node */
	field: string;
	/** The operator to use */
	operator: Operator;
	/** The parameter name (e.g., "$p0") */
	paramName: string;
}

/**
 * A raw Cypher condition that gets inserted directly.
 */
export interface RawCondition {
	/** Raw Cypher expression */
	cypher: string;
}

/**
 * Union of condition types.
 */
export type AnyCondition = Condition | RawCondition;

/**
 * Type guard for RawCondition.
 */
export function isRawCondition(condition: AnyCondition): condition is RawCondition {
	return "cypher" in condition;
}

// =============================================================================
// Order By Types
// =============================================================================

/**
 * Sort direction for ORDER BY clauses.
 */
export type SortDirection = "ASC" | "DESC";

/**
 * An order by specification.
 */
export interface OrderBySpec<T> {
	field: keyof T;
	direction: SortDirection;
}

// =============================================================================
// Query Execution Types
// =============================================================================

/**
 * Options for query execution.
 */
export interface QueryExecutionOptions {
	/** Timeout in milliseconds */
	timeout?: number;
}

/**
 * Result of a query execution with metadata.
 */
export interface QueryResult<T> {
	/** The result rows */
	data: T[];
	/** Query execution statistics */
	stats?: QueryStats;
}

/**
 * Query execution statistics.
 */
export interface QueryStats {
	/** Number of nodes created */
	nodesCreated?: number;
	/** Number of nodes deleted */
	nodesDeleted?: number;
	/** Number of relationships created */
	relationshipsCreated?: number;
	/** Number of properties set */
	propertiesSet?: number;
	/** Query execution time in ms */
	executionTimeMs?: number;
}

// =============================================================================
// Bitemporal Query Types
// =============================================================================

/**
 * Options for bitemporal queries.
 */
export interface BitemporalOptions {
	/** Valid time point (when the data was true in the real world) */
	validTime?: number;
	/** Transaction time point (when the data was recorded) */
	transactionTime?: number | "current";
}

// =============================================================================
// Client Interface
// =============================================================================

/**
 * Minimal interface required by the query builder for execution.
 * This allows the query builder to work with any client that implements
 * the query method.
 */
export interface QueryClient {
	/**
	 * Execute a Cypher query with parameters.
	 * @param cypher - The Cypher query string
	 * @param params - Query parameters
	 * @returns Promise resolving to the result rows
	 */
	query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}
