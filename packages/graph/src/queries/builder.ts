import type { QueryParam, QueryParams } from "@engram/storage";

/**
 * Fluent query builder for constructing Cypher queries with parameterization.
 *
 * Provides a type-safe, injection-resistant way to build graph queries.
 * All values are automatically parameterized to prevent Cypher injection.
 *
 * @example
 * ```typescript
 * const { cypher, params } = new QueryBuilder()
 *   .match("(s:Session {id: $sessionId})")
 *   .optionalMatch("(s)-[:HAS_TURN]->(t:Turn)")
 *   .with("s, count(t) as turnCount")
 *   .return("s, turnCount")
 *   .orderBy("s.started_at", "DESC")
 *   .skip(10)
 *   .limit(20)
 *   .setParam("sessionId", "abc-123")
 *   .build();
 * ```
 */
export class QueryBuilder {
	private matchParts: string[] = [];
	private optionalMatchParts: string[] = [];
	private whereParts: string[] = [];
	private withParts: string[] = [];
	private returnParts: string[] = [];
	private orderByParts: string[] = [];
	private _skip?: number;
	private _limit?: number;
	private params: QueryParams = {};
	private paramCounter = 0;

	/** Add a MATCH clause */
	match(clause: string): this {
		this.matchParts.push(clause);
		return this;
	}

	/** Add an OPTIONAL MATCH clause */
	optionalMatch(clause: string): this {
		this.optionalMatchParts.push(clause);
		return this;
	}

	/** Add a WHERE condition (conditions are ANDed together) */
	where(clause: string): this {
		this.whereParts.push(clause);
		return this;
	}

	/** Add a parameterized WHERE condition for property equality */
	whereEquals(alias: string, property: string, value: QueryParam): this {
		const paramName = `p_${this.paramCounter++}`;
		this.whereParts.push(`${alias}.${property} = $${paramName}`);
		this.params[paramName] = value;
		return this;
	}

	/** Add a WITH clause for aggregations or intermediate processing */
	with(clause: string): this {
		this.withParts.push(clause);
		return this;
	}

	/** Add a RETURN clause */
	return(clause: string): this {
		this.returnParts.push(clause);
		return this;
	}

	/** Add an ORDER BY clause */
	orderBy(expression: string, direction: "ASC" | "DESC" = "ASC"): this {
		this.orderByParts.push(`${expression} ${direction}`);
		return this;
	}

	/** Set SKIP for pagination (parameterized to prevent injection) */
	skip(n: number): this {
		this._skip = n;
		return this;
	}

	/** Set LIMIT for result count (parameterized to prevent injection) */
	limit(n: number): this {
		this._limit = n;
		return this;
	}

	/** Set a query parameter */
	setParam(name: string, value: QueryParam): this {
		this.params[name] = value;
		return this;
	}

	/** Set multiple query parameters */
	setParams(params: QueryParams): this {
		Object.assign(this.params, params);
		return this;
	}

	/** Inject bitemporal constraints for aliases */
	at(aliases: string[], time: { vt?: number; tt?: number | "current" }): this {
		const { vt, tt } = time;

		for (const alias of aliases) {
			// Valid Time Constraint
			if (vt !== undefined) {
				const vtParam = `vt_${this.paramCounter++}`;
				this.whereParts.push(
					`(${alias}.vt_start <= $${vtParam} AND ${alias}.vt_end > $${vtParam})`,
				);
				this.params[vtParam] = vt;
			}

			// Transaction Time Constraint
			if (tt === "current") {
				this.whereParts.push(`${alias}.tt_end = 253402300799000`); // MAX_DATE
			} else if (typeof tt === "number") {
				const ttParam = `tt_${this.paramCounter++}`;
				this.whereParts.push(
					`(${alias}.tt_start <= $${ttParam} AND ${alias}.tt_end > $${ttParam})`,
				);
				this.params[ttParam] = tt;
			}
		}

		return this;
	}

	/** Build the final Cypher query and parameters */
	build(): { cypher: string; params: QueryParams } {
		const parts: string[] = [];

		// MATCH clauses
		if (this.matchParts.length > 0) {
			parts.push(`MATCH ${this.matchParts.join(", ")}`);
		}

		// WHERE after MATCH (before OPTIONAL MATCH)
		if (this.whereParts.length > 0 && this.optionalMatchParts.length === 0) {
			parts.push(`WHERE ${this.whereParts.join(" AND ")}`);
		}

		// OPTIONAL MATCH clauses
		for (const optMatch of this.optionalMatchParts) {
			parts.push(`OPTIONAL MATCH ${optMatch}`);
		}

		// WHERE after OPTIONAL MATCH (if any optional matches exist)
		if (this.whereParts.length > 0 && this.optionalMatchParts.length > 0) {
			parts.push(`WHERE ${this.whereParts.join(" AND ")}`);
		}

		// WITH clauses
		for (const withClause of this.withParts) {
			parts.push(`WITH ${withClause}`);
		}

		// RETURN clause
		if (this.returnParts.length > 0) {
			parts.push(`RETURN ${this.returnParts.join(", ")}`);
		}

		// ORDER BY
		if (this.orderByParts.length > 0) {
			parts.push(`ORDER BY ${this.orderByParts.join(", ")}`);
		}

		// SKIP (parameterized)
		if (this._skip !== undefined) {
			const skipParam = `skip_${this.paramCounter++}`;
			parts.push(`SKIP $${skipParam}`);
			this.params[skipParam] = this._skip;
		}

		// LIMIT (parameterized)
		if (this._limit !== undefined) {
			const limitParam = `limit_${this.paramCounter++}`;
			parts.push(`LIMIT $${limitParam}`);
			this.params[limitParam] = this._limit;
		}

		return {
			cypher: parts.join(" "),
			params: { ...this.params },
		};
	}

	/** Get just the Cypher string (for debugging) */
	toCypher(): string {
		return this.build().cypher;
	}

	/** Clone this builder for forking queries */
	clone(): QueryBuilder {
		const cloned = new QueryBuilder();
		cloned.matchParts = [...this.matchParts];
		cloned.optionalMatchParts = [...this.optionalMatchParts];
		cloned.whereParts = [...this.whereParts];
		cloned.withParts = [...this.withParts];
		cloned.returnParts = [...this.returnParts];
		cloned.orderByParts = [...this.orderByParts];
		cloned._skip = this._skip;
		cloned._limit = this._limit;
		cloned.params = { ...this.params };
		cloned.paramCounter = this.paramCounter;
		return cloned;
	}
}
