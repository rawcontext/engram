/**
 * Base Query Builder Runtime
 *
 * Provides the runtime foundation for all generated query builders.
 * Handles condition accumulation, parameter management, Cypher generation,
 * and query execution against FalkorDB.
 */

import type { BaseNode } from "../models/base";
import { MAX_DATE } from "../utils/time";
import type {
	AnyCondition,
	Condition,
	OrderBySpec,
	QueryClient,
	RawCondition,
	SortDirection,
} from "./types";
import { isRawCondition } from "./types";

/**
 * Abstract base class for all generated query builders.
 *
 * Provides fluent API methods for building Cypher queries with:
 * - Type-safe condition building
 * - Bitemporal query support (valid time, transaction time)
 * - Pagination (limit, offset)
 * - Ordering (order by)
 * - Query execution and result handling
 *
 * @template T - The node type this builder queries
 *
 * @example
 * ```typescript
 * class SessionQueryBuilder extends BaseQueryBuilder<Session> {
 *   protected readonly nodeLabel = "Session";
 *
 *   byAgentType(type: string): this {
 *     return this.addCondition("agent_type", "=", type);
 *   }
 * }
 *
 * const sessions = await new SessionQueryBuilder(client)
 *   .byAgentType("claude")
 *   .whereCurrent()
 *   .limit(10)
 *   .execute();
 * ```
 */
export abstract class BaseQueryBuilder<T extends BaseNode> {
	/**
	 * The node label for this query builder (e.g., "Session", "Turn").
	 * Must be set by subclasses.
	 */
	protected abstract readonly nodeLabel: string;

	/**
	 * Accumulated conditions for the WHERE clause.
	 */
	protected conditions: AnyCondition[] = [];

	/**
	 * Query parameters keyed by parameter name.
	 */
	protected params: Record<string, unknown> = {};

	/**
	 * Counter for generating unique parameter names.
	 */
	protected paramCounter = 0;

	/**
	 * Optional limit for result count.
	 */
	protected _limit?: number;

	/**
	 * Optional offset for pagination.
	 */
	protected _offset?: number;

	/**
	 * Optional ordering specification.
	 */
	protected _orderBy?: OrderBySpec<T>;

	/**
	 * The client used for query execution.
	 */
	protected readonly client: QueryClient;

	/**
	 * Node alias used in Cypher queries.
	 */
	protected readonly nodeAlias = "n";

	/**
	 * Creates a new query builder instance.
	 *
	 * @param client - The client used for query execution
	 */
	constructor(client: QueryClient) {
		this.client = client;
	}

	// =========================================================================
	// Condition Building
	// =========================================================================

	/**
	 * Add conditions based on partial node properties.
	 * All conditions are combined with AND.
	 *
	 * @param conditions - Partial object of property values to match
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * builder.where({ id: "abc123", agent_type: "claude" })
	 * ```
	 */
	where(conditions: Partial<T>): this {
		for (const [field, value] of Object.entries(conditions)) {
			if (value !== undefined) {
				this.addCondition(field, "=", value);
			}
		}
		return this;
	}

	/**
	 * Add a condition that the node is currently valid in transaction time.
	 * This filters for nodes where tt_end = MAX_DATE.
	 *
	 * @returns This builder for chaining
	 */
	whereCurrent(): this {
		this.conditions.push({
			cypher: `${this.nodeAlias}.tt_end = ${MAX_DATE}`,
		} as RawCondition);
		return this;
	}

	/**
	 * Add a condition that the node is currently valid in valid time.
	 * This filters for nodes where vt_end = MAX_DATE.
	 *
	 * @returns This builder for chaining
	 */
	whereValid(): this {
		this.conditions.push({
			cypher: `${this.nodeAlias}.vt_end = ${MAX_DATE}`,
		} as RawCondition);
		return this;
	}

	/**
	 * Add bitemporal point-in-time conditions.
	 * Filters for nodes that were valid at the given timestamp.
	 *
	 * @param timestamp - The point in time (epoch ms) to query
	 * @param options - Optional flags to specify which time dimensions to filter
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * // Query for state as of a specific time
	 * builder.asOf(1640000000000)
	 *
	 * // Query only valid time
	 * builder.asOf(1640000000000, { validTime: true, transactionTime: false })
	 * ```
	 */
	asOf(
		timestamp: number,
		options: { validTime?: boolean; transactionTime?: boolean } = {},
	): this {
		const { validTime = true, transactionTime = true } = options;

		if (validTime) {
			const vtParam = this.nextParamName();
			this.params[vtParam] = timestamp;
			this.conditions.push({
				cypher: `(${this.nodeAlias}.vt_start <= $${vtParam} AND ${this.nodeAlias}.vt_end > $${vtParam})`,
			} as RawCondition);
		}

		if (transactionTime) {
			const ttParam = this.nextParamName();
			this.params[ttParam] = timestamp;
			this.conditions.push({
				cypher: `(${this.nodeAlias}.tt_start <= $${ttParam} AND ${this.nodeAlias}.tt_end > $${ttParam})`,
			} as RawCondition);
		}

		return this;
	}

	// =========================================================================
	// Pagination & Ordering
	// =========================================================================

	/**
	 * Limit the number of results.
	 *
	 * @param n - Maximum number of results to return
	 * @returns This builder for chaining
	 */
	limit(n: number): this {
		this._limit = n;
		return this;
	}

	/**
	 * Skip the first n results.
	 *
	 * @param n - Number of results to skip
	 * @returns This builder for chaining
	 */
	offset(n: number): this {
		this._offset = n;
		return this;
	}

	/**
	 * Order results by a field.
	 *
	 * @param field - The field to order by
	 * @param direction - Sort direction (ASC or DESC), defaults to ASC
	 * @returns This builder for chaining
	 */
	orderBy(field: keyof T, direction: SortDirection = "ASC"): this {
		this._orderBy = { field, direction };
		return this;
	}

	// =========================================================================
	// Query Execution
	// =========================================================================

	/**
	 * Execute the query and return all matching nodes.
	 *
	 * @returns Promise resolving to array of matching nodes
	 */
	async execute(): Promise<T[]> {
		const cypher = this.toCypher();
		const result = await this.client.query<{ n: { properties: T } }>(cypher, this.params);
		return result.map((row) => row.n.properties);
	}

	/**
	 * Execute the query and return the first matching node.
	 *
	 * @returns Promise resolving to the first matching node, or null if none found
	 */
	async first(): Promise<T | null> {
		const originalLimit = this._limit;
		this._limit = 1;
		const results = await this.execute();
		this._limit = originalLimit;
		return results[0] ?? null;
	}

	/**
	 * Execute a count query and return the number of matching nodes.
	 *
	 * @returns Promise resolving to the count of matching nodes
	 */
	async count(): Promise<number> {
		const cypher = this.toCountCypher();
		const result = await this.client.query<{ cnt: number }>(cypher, this.params);
		return result[0]?.cnt ?? 0;
	}

	/**
	 * Check if any nodes match the current conditions.
	 *
	 * @returns Promise resolving to true if at least one match exists
	 */
	async exists(): Promise<boolean> {
		const count = await this.count();
		return count > 0;
	}

	// =========================================================================
	// Cypher Generation
	// =========================================================================

	/**
	 * Generate the Cypher query string for debugging or logging.
	 *
	 * @returns The Cypher query string
	 */
	toCypher(): string {
		const parts: string[] = [];

		// MATCH clause
		parts.push(`MATCH (${this.nodeAlias}:${this.nodeLabel})`);

		// WHERE clause
		const whereClause = this.buildWhereClause();
		if (whereClause) {
			parts.push(`WHERE ${whereClause}`);
		}

		// RETURN clause
		parts.push(`RETURN ${this.nodeAlias}`);

		// ORDER BY clause
		if (this._orderBy) {
			parts.push(
				`ORDER BY ${this.nodeAlias}.${String(this._orderBy.field)} ${this._orderBy.direction}`,
			);
		}

		// SKIP clause
		if (this._offset !== undefined) {
			parts.push(`SKIP ${this._offset}`);
		}

		// LIMIT clause
		if (this._limit !== undefined) {
			parts.push(`LIMIT ${this._limit}`);
		}

		return parts.join(" ");
	}

	/**
	 * Generate a count query for the current conditions.
	 *
	 * @returns The Cypher count query string
	 */
	protected toCountCypher(): string {
		const parts: string[] = [];

		// MATCH clause
		parts.push(`MATCH (${this.nodeAlias}:${this.nodeLabel})`);

		// WHERE clause
		const whereClause = this.buildWhereClause();
		if (whereClause) {
			parts.push(`WHERE ${whereClause}`);
		}

		// RETURN count
		parts.push(`RETURN count(${this.nodeAlias}) as cnt`);

		return parts.join(" ");
	}

	/**
	 * Get the current parameters for debugging.
	 *
	 * @returns The parameter map
	 */
	getParams(): Record<string, unknown> {
		return { ...this.params };
	}

	// =========================================================================
	// Protected Helpers
	// =========================================================================

	/**
	 * Add a typed condition to the query.
	 *
	 * @param field - The property name
	 * @param operator - The comparison operator
	 * @param value - The value to compare against
	 * @returns This builder for chaining
	 */
	protected addCondition(
		field: string,
		operator: Condition["operator"],
		value: unknown,
	): this {
		const paramName = this.nextParamName();
		this.params[paramName] = value;
		this.conditions.push({
			field,
			operator,
			paramName,
		});
		return this;
	}

	/**
	 * Add a raw Cypher condition.
	 *
	 * @param cypher - Raw Cypher expression
	 * @returns This builder for chaining
	 */
	protected addRawCondition(cypher: string): this {
		this.conditions.push({ cypher } as RawCondition);
		return this;
	}

	/**
	 * Generate the next unique parameter name.
	 *
	 * @returns A unique parameter name like "p0", "p1", etc.
	 */
	protected nextParamName(): string {
		return `p${this.paramCounter++}`;
	}

	/**
	 * Build the WHERE clause from accumulated conditions.
	 *
	 * @returns The WHERE clause content, or empty string if no conditions
	 */
	protected buildWhereClause(): string {
		if (this.conditions.length === 0) {
			return "";
		}

		const conditionStrings = this.conditions.map((condition) => {
			if (isRawCondition(condition)) {
				return condition.cypher;
			}
			return `${this.nodeAlias}.${condition.field} ${condition.operator} $${condition.paramName}`;
		});

		return conditionStrings.join(" AND ");
	}

	/**
	 * Clone the current builder state.
	 * Useful for creating modified copies without mutating the original.
	 *
	 * @returns A new builder instance with copied state
	 */
	protected cloneState(): {
		conditions: AnyCondition[];
		params: Record<string, unknown>;
		paramCounter: number;
		limit?: number;
		offset?: number;
		orderBy?: OrderBySpec<T>;
	} {
		return {
			conditions: [...this.conditions],
			params: { ...this.params },
			paramCounter: this.paramCounter,
			limit: this._limit,
			offset: this._offset,
			orderBy: this._orderBy ? { ...this._orderBy } : undefined,
		};
	}

	/**
	 * Reset the builder to its initial state.
	 * Useful for reusing a builder instance.
	 *
	 * @returns This builder for chaining
	 */
	reset(): this {
		this.conditions = [];
		this.params = {};
		this.paramCounter = 0;
		this._limit = undefined;
		this._offset = undefined;
		this._orderBy = undefined;
		return this;
	}
}
