/**
 * Base Traversal Builder Runtime
 *
 * Provides the runtime foundation for building graph traversal queries.
 * Generates Cypher path patterns with support for:
 * - Multi-hop traversals
 * - Edge type filtering
 * - Variable-length paths
 * - Edge property conditions
 * - Bitemporal constraints on both nodes and edges
 *
 * @example
 * ```typescript
 * const result = await traverse(client)
 *   .from("Session", { id: sessionId })
 *   .via("HAS_TURN")
 *   .to("Turn")
 *   .via("INVOKES")
 *   .to("ToolCall", { status: "completed" })
 *   .whereCurrent()
 *   .limit(10)
 *   .execute();
 * ```
 */

import { MAX_DATE } from "../utils/time";
import type {
	BitemporalTraversalOptions,
	EdgeDirection,
	PathLength,
	TraversalStep,
} from "./traversal-types";
import { isRawEdgeCondition } from "./traversal-types";
import type { Operator, QueryClient, SortDirection } from "./types";

/**
 * Base class for graph traversal queries.
 *
 * Provides a fluent API for building path patterns that traverse
 * relationships between nodes. Generates optimized Cypher queries
 * for FalkorDB execution.
 *
 * @template TResult - The expected result type from execute()
 */
export class BaseTraversalBuilder<TResult = unknown> {
	// Starting node configuration
	protected startLabel = "";
	protected startAlias = "n0";
	protected startConditions: Record<string, unknown> = {};

	// Traversal steps
	protected steps: TraversalStep[] = [];

	// Current step being built
	protected currentStep: Partial<TraversalStep> | null = null;

	// Query parameters
	protected params: Record<string, unknown> = {};
	protected paramCounter = 0;

	// Alias counter for auto-generated aliases
	protected aliasCounter = 1;

	// Pagination and ordering
	protected _limit?: number;
	protected _offset?: number;
	protected _orderBy?: { alias: string; field: string; direction: SortDirection };

	// Bitemporal options
	protected bitemporalOptions?: BitemporalTraversalOptions;

	// What to return
	protected returnAliases: string[] = [];
	protected returnDistinct = false;

	// Client for execution
	protected readonly client: QueryClient;

	/**
	 * Create a new traversal builder.
	 *
	 * @param client - Query client for execution
	 */
	constructor(client: QueryClient) {
		this.client = client;
	}

	// =========================================================================
	// Starting Node
	// =========================================================================

	/**
	 * Set the starting node for the traversal.
	 *
	 * @param label - Node label (e.g., "Session", "Turn")
	 * @param conditions - Property conditions on the starting node
	 * @param alias - Optional custom alias (defaults to "n0")
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * traverse(client).from("Session", { id: "abc123" })
	 * ```
	 */
	from(label: string, conditions: Record<string, unknown> = {}, alias?: string): this {
		this.startLabel = label;
		this.startConditions = conditions;
		if (alias) {
			this.startAlias = alias;
		}
		this.returnAliases = [this.startAlias];
		return this;
	}

	// =========================================================================
	// Edge Traversal
	// =========================================================================

	/**
	 * Traverse via an edge type.
	 *
	 * @param edgeTypes - Edge type(s) to traverse
	 * @param options - Traversal options
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * // Single edge type
	 * .via("HAS_TURN")
	 *
	 * // Multiple edge types
	 * .via(["INVOKES", "CONTAINS"])
	 *
	 * // With options
	 * .via("NEXT", { direction: "outgoing", pathLength: { min: 1, max: 5 } })
	 * ```
	 */
	via(
		edgeTypes: string | string[],
		options: {
			direction?: EdgeDirection;
			pathLength?: PathLength;
			edgeAlias?: string;
		} = {},
	): this {
		// Finalize any pending step
		this.finalizeCurrentStep();

		const types = Array.isArray(edgeTypes) ? edgeTypes : [edgeTypes];
		this.currentStep = {
			edgeTypes: types,
			direction: options.direction ?? "outgoing",
			pathLength: options.pathLength,
			edgeAlias: options.edgeAlias,
			edgeConditions: [],
			targetConditions: {},
		};

		return this;
	}

	/**
	 * Traverse via an edge in the incoming direction.
	 * Shorthand for `.via(edgeType, { direction: "incoming" })`
	 *
	 * @param edgeTypes - Edge type(s) to traverse
	 * @returns This builder for chaining
	 */
	viaIncoming(edgeTypes: string | string[]): this {
		return this.via(edgeTypes, { direction: "incoming" });
	}

	/**
	 * Traverse via an edge in any direction.
	 * Shorthand for `.via(edgeType, { direction: "any" })`
	 *
	 * @param edgeTypes - Edge type(s) to traverse
	 * @returns This builder for chaining
	 */
	viaAny(edgeTypes: string | string[]): this {
		return this.via(edgeTypes, { direction: "any" });
	}

	/**
	 * Set variable-length path for the current edge traversal.
	 *
	 * @param min - Minimum hops
	 * @param max - Maximum hops (undefined = unlimited)
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * .via("NEXT").hops(1, 5)  // 1 to 5 hops
	 * .via("NEXT").hops(3)     // Exactly 3 hops
	 * ```
	 */
	hops(min: number, max?: number): this {
		if (!this.currentStep) {
			throw new Error("hops() must be called after via()");
		}
		this.currentStep.pathLength = { min, max };
		return this;
	}

	// =========================================================================
	// Target Node
	// =========================================================================

	/**
	 * Specify the target node for the current traversal step.
	 *
	 * @param label - Target node label (optional)
	 * @param conditions - Property conditions on the target
	 * @param alias - Optional custom alias
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * .via("HAS_TURN").to("Turn", { sequence_index: 0 })
	 * ```
	 */
	to(label?: string, conditions: Record<string, unknown> = {}, alias?: string): this {
		if (!this.currentStep) {
			throw new Error("to() must be called after via()");
		}

		const targetAlias = alias ?? `n${this.aliasCounter++}`;
		this.currentStep.targetLabel = label;
		this.currentStep.targetAlias = targetAlias;
		this.currentStep.targetConditions = conditions;

		// Update return aliases to include the new target
		this.returnAliases = [targetAlias];

		this.finalizeCurrentStep();
		return this;
	}

	// =========================================================================
	// Edge Conditions
	// =========================================================================

	/**
	 * Add a condition on edge properties.
	 *
	 * @param field - Edge property name
	 * @param operator - Comparison operator
	 * @param value - Value to compare against
	 * @returns This builder for chaining
	 *
	 * @example
	 * ```typescript
	 * .via("RELATED_TO").whereEdge("strength", ">=", 0.8).to("Entity")
	 * ```
	 */
	whereEdge(field: string, operator: Operator, value: unknown): this {
		if (!this.currentStep) {
			throw new Error("whereEdge() must be called after via()");
		}

		const paramName = this.nextParamName();
		this.params[paramName] = value;
		this.currentStep.edgeConditions = this.currentStep.edgeConditions ?? [];
		this.currentStep.edgeConditions.push({
			field,
			operator,
			paramName,
		});

		return this;
	}

	/**
	 * Add a raw Cypher condition on the edge.
	 *
	 * @param cypher - Raw Cypher expression
	 * @returns This builder for chaining
	 */
	whereEdgeRaw(cypher: string): this {
		if (!this.currentStep) {
			throw new Error("whereEdgeRaw() must be called after via()");
		}

		this.currentStep.edgeConditions = this.currentStep.edgeConditions ?? [];
		this.currentStep.edgeConditions.push({ cypher });

		return this;
	}

	// =========================================================================
	// Bitemporal Constraints
	// =========================================================================

	/**
	 * Filter for currently valid nodes and edges (tt_end = MAX_DATE).
	 *
	 * @returns This builder for chaining
	 */
	whereCurrent(): this {
		this.bitemporalOptions = {
			...this.bitemporalOptions,
			transactionTime: "current",
		};
		return this;
	}

	/**
	 * Filter for nodes and edges valid at a specific point in time.
	 *
	 * @param timestamp - Point in time (epoch ms)
	 * @param options - Which parts to apply temporal constraints to
	 * @returns This builder for chaining
	 */
	asOf(timestamp: number, options: { validTime?: boolean; transactionTime?: boolean } = {}): this {
		const { validTime = true, transactionTime = true } = options;

		this.bitemporalOptions = {
			...this.bitemporalOptions,
			validTime: validTime ? timestamp : undefined,
			transactionTime: transactionTime ? timestamp : undefined,
		};

		return this;
	}

	// =========================================================================
	// Pagination & Ordering
	// =========================================================================

	/**
	 * Limit the number of results.
	 *
	 * @param n - Maximum results
	 * @returns This builder for chaining
	 */
	limit(n: number): this {
		this._limit = n;
		return this;
	}

	/**
	 * Skip the first n results.
	 *
	 * @param n - Number to skip
	 * @returns This builder for chaining
	 */
	offset(n: number): this {
		this._offset = n;
		return this;
	}

	/**
	 * Order results by a field.
	 *
	 * @param alias - Node/edge alias to order by
	 * @param field - Property name
	 * @param direction - Sort direction
	 * @returns This builder for chaining
	 */
	orderBy(alias: string, field: string, direction: SortDirection = "ASC"): this {
		this._orderBy = { alias, field, direction };
		return this;
	}

	// =========================================================================
	// Return Specification
	// =========================================================================

	/**
	 * Specify which aliases to return.
	 *
	 * @param aliases - Node/edge aliases to return
	 * @returns This builder for chaining
	 */
	returning(...aliases: string[]): this {
		this.returnAliases = aliases;
		return this;
	}

	/**
	 * Return distinct results.
	 *
	 * @returns This builder for chaining
	 */
	distinct(): this {
		this.returnDistinct = true;
		return this;
	}

	// =========================================================================
	// Query Execution
	// =========================================================================

	/**
	 * Execute the traversal and return results.
	 *
	 * @returns Promise resolving to matching results
	 */
	async execute(): Promise<TResult[]> {
		this.finalizeCurrentStep();
		const cypher = this.toCypher();
		const result = await this.client.query<Record<string, { properties: unknown }>>(
			cypher,
			this.params,
		);

		// Extract properties from the returned aliases
		return result.map((row) => {
			if (this.returnAliases.length === 1) {
				const alias = this.returnAliases[0];
				return row[alias]?.properties as TResult;
			}

			// Multiple aliases: return an object
			const extracted: Record<string, unknown> = {};
			for (const alias of this.returnAliases) {
				extracted[alias] = row[alias]?.properties;
			}
			return extracted as TResult;
		});
	}

	/**
	 * Execute and return the first result.
	 *
	 * @returns Promise resolving to first result or null
	 */
	async first(): Promise<TResult | null> {
		const originalLimit = this._limit;
		this._limit = 1;
		const results = await this.execute();
		this._limit = originalLimit;
		return results[0] ?? null;
	}

	/**
	 * Execute a count query.
	 *
	 * @returns Promise resolving to the count
	 */
	async count(): Promise<number> {
		this.finalizeCurrentStep();
		const cypher = this.toCountCypher();
		const result = await this.client.query<{ cnt: number }>(cypher, this.params);
		return result[0]?.cnt ?? 0;
	}

	/**
	 * Check if any results exist.
	 *
	 * @returns Promise resolving to boolean
	 */
	async exists(): Promise<boolean> {
		const count = await this.count();
		return count > 0;
	}

	// =========================================================================
	// Cypher Generation
	// =========================================================================

	/**
	 * Generate the Cypher query string.
	 *
	 * @returns The Cypher query
	 */
	toCypher(): string {
		this.finalizeCurrentStep();
		const parts: string[] = [];

		// Build MATCH clause
		parts.push(`MATCH ${this.buildMatchPattern()}`);

		// Build WHERE clause
		const whereClause = this.buildWhereClause();
		if (whereClause) {
			parts.push(`WHERE ${whereClause}`);
		}

		// Build RETURN clause
		const returnPrefix = this.returnDistinct ? "RETURN DISTINCT" : "RETURN";
		parts.push(`${returnPrefix} ${this.returnAliases.join(", ")}`);

		// ORDER BY
		if (this._orderBy) {
			parts.push(
				`ORDER BY ${this._orderBy.alias}.${this._orderBy.field} ${this._orderBy.direction}`,
			);
		}

		// SKIP
		if (this._offset !== undefined) {
			parts.push(`SKIP ${this._offset}`);
		}

		// LIMIT
		if (this._limit !== undefined) {
			parts.push(`LIMIT ${this._limit}`);
		}

		return parts.join(" ");
	}

	/**
	 * Generate a count query.
	 *
	 * @returns The Cypher count query
	 */
	protected toCountCypher(): string {
		this.finalizeCurrentStep();
		const parts: string[] = [];

		parts.push(`MATCH ${this.buildMatchPattern()}`);

		const whereClause = this.buildWhereClause();
		if (whereClause) {
			parts.push(`WHERE ${whereClause}`);
		}

		// Count the final node in the path
		const countAlias = this.returnAliases[this.returnAliases.length - 1] || this.startAlias;
		const countPrefix = this.returnDistinct ? "count(DISTINCT " : "count(";
		parts.push(`RETURN ${countPrefix}${countAlias}) as cnt`);

		return parts.join(" ");
	}

	/**
	 * Get current parameters for debugging.
	 *
	 * @returns Copy of parameters
	 */
	getParams(): Record<string, unknown> {
		return { ...this.params };
	}

	/**
	 * Reset the builder to initial state.
	 *
	 * @returns This builder for chaining
	 */
	reset(): this {
		this.startLabel = "";
		this.startAlias = "n0";
		this.startConditions = {};
		this.steps = [];
		this.currentStep = null;
		this.params = {};
		this.paramCounter = 0;
		this.aliasCounter = 1;
		this._limit = undefined;
		this._offset = undefined;
		this._orderBy = undefined;
		this.bitemporalOptions = undefined;
		this.returnAliases = [];
		this.returnDistinct = false;
		return this;
	}

	// =========================================================================
	// Protected Helpers
	// =========================================================================

	/**
	 * Finalize the current step and add it to the steps array.
	 */
	protected finalizeCurrentStep(): void {
		if (this.currentStep?.targetAlias) {
			this.steps.push(this.currentStep as TraversalStep);
			this.currentStep = null;
		}
	}

	/**
	 * Generate the next unique parameter name.
	 */
	protected nextParamName(): string {
		return `p${this.paramCounter++}`;
	}

	/**
	 * Build the MATCH pattern for the traversal.
	 */
	protected buildMatchPattern(): string {
		const parts: string[] = [];

		// Starting node
		const startProps = this.buildInlineConditions(this.startConditions);
		const startPattern = startProps
			? `(${this.startAlias}:${this.startLabel} ${startProps})`
			: `(${this.startAlias}:${this.startLabel})`;
		parts.push(startPattern);

		// Traversal steps
		for (const step of this.steps) {
			const edgePattern = this.buildEdgePattern(step);
			const targetPattern = this.buildTargetPattern(step);
			parts.push(`${edgePattern}${targetPattern}`);
		}

		return parts.join("");
	}

	/**
	 * Build inline property conditions for MATCH pattern.
	 */
	protected buildInlineConditions(conditions: Record<string, unknown>): string {
		const entries = Object.entries(conditions).filter(([_, v]) => v !== undefined);
		if (entries.length === 0) return "";

		const condStrings = entries.map(([key, value]) => {
			const paramName = this.nextParamName();
			this.params[paramName] = value;
			return `${key}: $${paramName}`;
		});

		return `{${condStrings.join(", ")}}`;
	}

	/**
	 * Build the edge pattern for a traversal step.
	 */
	protected buildEdgePattern(step: TraversalStep): string {
		const edgeTypes = step.edgeTypes.join("|");
		const edgeAlias = step.edgeAlias ?? "";
		const lengthSpec = this.buildPathLengthSpec(step.pathLength);

		const edgeLabel = edgeTypes ? `:${edgeTypes}` : "";
		const edgeContent = `${edgeAlias}${edgeLabel}${lengthSpec}`;

		switch (step.direction) {
			case "outgoing":
				return `-[${edgeContent}]->`;
			case "incoming":
				return `<-[${edgeContent}]-`;
			case "any":
				return `-[${edgeContent}]-`;
		}
	}

	/**
	 * Build path length specification.
	 */
	protected buildPathLengthSpec(pathLength?: PathLength): string {
		if (!pathLength) return "";

		const { min, max } = pathLength;

		if (min !== undefined && max !== undefined) {
			if (min === max) {
				return `*${min}`;
			}
			return `*${min}..${max}`;
		}

		if (min !== undefined) {
			return `*${min}..`;
		}

		if (max !== undefined) {
			return `*..${max}`;
		}

		return "*";
	}

	/**
	 * Build the target node pattern.
	 */
	protected buildTargetPattern(step: TraversalStep): string {
		const labelPart = step.targetLabel ? `:${step.targetLabel}` : "";
		const condPart = this.buildInlineConditions(step.targetConditions);

		if (condPart) {
			return `(${step.targetAlias}${labelPart} ${condPart})`;
		}
		return `(${step.targetAlias}${labelPart})`;
	}

	/**
	 * Build the WHERE clause.
	 */
	protected buildWhereClause(): string {
		const conditions: string[] = [];

		// Add bitemporal conditions for starting node
		if (this.bitemporalOptions) {
			conditions.push(...this.buildBitemporalConditions(this.startAlias));
		}

		// Add edge and node conditions for each step
		for (const step of this.steps) {
			// Edge conditions
			if (step.edgeAlias && step.edgeConditions.length > 0) {
				for (const cond of step.edgeConditions) {
					if (isRawEdgeCondition(cond)) {
						conditions.push(cond.cypher);
					} else {
						conditions.push(`${step.edgeAlias}.${cond.field} ${cond.operator} $${cond.paramName}`);
					}
				}
			}

			// Bitemporal conditions for target node
			if (this.bitemporalOptions) {
				conditions.push(...this.buildBitemporalConditions(step.targetAlias));

				// Edge bitemporal conditions
				if (step.edgeAlias) {
					conditions.push(...this.buildBitemporalConditions(step.edgeAlias, true));
				}
			}
		}

		return conditions.join(" AND ");
	}

	/**
	 * Build bitemporal conditions for an alias.
	 */
	protected buildBitemporalConditions(alias: string, isEdge = false): string[] {
		const conditions: string[] = [];
		const opts = this.bitemporalOptions;
		if (!opts) return conditions;

		// Check if we should apply to this element type
		const shouldApply = isEdge ? opts.apply?.edges !== false : opts.apply?.nodes !== false;
		if (!shouldApply) return conditions;

		// Transaction time constraint
		if (opts.transactionTime === "current") {
			conditions.push(`${alias}.tt_end = ${MAX_DATE}`);
		} else if (typeof opts.transactionTime === "number") {
			const ttParam = this.nextParamName();
			this.params[ttParam] = opts.transactionTime;
			conditions.push(`(${alias}.tt_start <= $${ttParam} AND ${alias}.tt_end > $${ttParam})`);
		}

		// Valid time constraint
		if (opts.validTime !== undefined) {
			const vtParam = this.nextParamName();
			this.params[vtParam] = opts.validTime;
			conditions.push(`(${alias}.vt_start <= $${vtParam} AND ${alias}.vt_end > $${vtParam})`);
		}

		return conditions;
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new traversal builder.
 *
 * @param client - Query client for execution
 * @returns A new traversal builder instance
 *
 * @example
 * ```typescript
 * import { traverse } from "@engram/graph/runtime";
 *
 * const turns = await traverse(client)
 *   .from("Session", { id: sessionId })
 *   .via("HAS_TURN")
 *   .to("Turn")
 *   .whereCurrent()
 *   .orderBy("n1", "sequence_index", "ASC")
 *   .execute();
 * ```
 */
export function traverse<T = unknown>(client: QueryClient): BaseTraversalBuilder<T> {
	return new BaseTraversalBuilder<T>(client);
}
