export class QueryBuilder {
	private matchParts: string[] = [];
	private whereParts: string[] = [];
	private returnParts: string[] = [];
	private params: Record<string, unknown> = {};

	match(clause: string): this {
		this.matchParts.push(clause);
		return this;
	}

	where(clause: string): this {
		this.whereParts.push(clause);
		return this;
	}

	return(clause: string): this {
		this.returnParts.push(clause);
		return this;
	}

	// Inject bitemporal constraints
	// Simplification: aliases list required to know what to constrain
	at(aliases: string[], time: { vt?: number; tt?: number | "current" }): this {
		const { vt, tt } = time;

		aliases.forEach((alias) => {
			// Valid Time Constraint
			if (vt !== undefined) {
				this.whereParts.push(`(${alias}.vt_start <= $vt AND ${alias}.vt_end > $vt)`);
				this.params.vt = vt;
			}

			// Transaction Time Constraint
			if (tt === "current") {
				// Current knowledge
				this.whereParts.push(`${alias}.tt_end = 253402300799000`); // MAX_DATE
			} else if (typeof tt === "number") {
				// Known at time T
				this.whereParts.push(`(${alias}.tt_start <= $tt AND ${alias}.tt_end > $tt)`);
				this.params.tt = tt;
			}
		});

		return this;
	}

	build(): { cypher: string; params: Record<string, unknown> } {
		let cypher = `MATCH ${this.matchParts.join(", ")}`;
		if (this.whereParts.length > 0) {
			cypher += ` WHERE ${this.whereParts.join(" AND ")}`;
		}
		if (this.returnParts.length > 0) {
			cypher += ` RETURN ${this.returnParts.join(", ")}`;
		}
		return { cypher, params: this.params };
	}
}
