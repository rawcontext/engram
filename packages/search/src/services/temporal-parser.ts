import * as chrono from "chrono-node";

/**
 * Temporal filter constraints for time-filtered retrieval.
 */
export interface TemporalFilter {
	/** Start of time range (inclusive) */
	after?: Date;
	/** End of time range (inclusive) */
	before?: Date;
	/** Whether to sort by recency */
	sortByRecency?: boolean;
	/** Original temporal expression */
	expression?: string;
}

/**
 * Result of parsing temporal expressions from a query.
 */
export interface TemporalQueryResult {
	/** Semantic part of query (temporal expressions removed) */
	semanticQuery: string;
	/** Extracted temporal filter */
	temporalFilter: TemporalFilter | null;
	/** Confidence in temporal extraction (0-1) */
	confidence: number;
}

/**
 * Qdrant filter condition for temporal queries.
 */
export interface QdrantTemporalFilter {
	must: Array<{
		key: string;
		range: { gte?: string; lte?: string };
	}>;
}

/**
 * Parses temporal expressions from queries using chrono-node.
 *
 * Supports:
 * - Relative: "last week", "yesterday", "3 days ago"
 * - Absolute: "January 2024", "on Dec 15"
 * - Range: "between Jan and March"
 * - Ordinal: "first meeting", "latest update"
 *
 * @example
 * ```typescript
 * const parser = new TemporalQueryParser();
 * const result = parser.parse("What did we discuss last week?");
 * // result.semanticQuery = "What did we discuss?"
 * // result.temporalFilter = { after: Date, before: Date }
 * ```
 */
export class TemporalQueryParser {
	private referenceDate: Date;

	constructor(referenceDate?: Date) {
		this.referenceDate = referenceDate ?? new Date();
	}

	/**
	 * Update the reference date for relative temporal expressions.
	 */
	setReferenceDate(date: Date): void {
		this.referenceDate = date;
	}

	/**
	 * Parse temporal expressions from a query.
	 */
	parse(query: string): TemporalQueryResult {
		// Parse temporal expressions with chrono-node
		const results = chrono.parse(query, this.referenceDate, {
			forwardDate: false, // Prefer past dates for "last X"
		});

		if (results.length === 0) {
			return {
				semanticQuery: query,
				temporalFilter: null,
				confidence: 0,
			};
		}

		// Extract the most relevant temporal reference
		const primary = results[0];
		const temporalFilter: TemporalFilter = {
			expression: primary.text,
		};

		// Handle different result types
		if (primary.start && primary.end) {
			// Range: "between X and Y"
			temporalFilter.after = primary.start.date();
			temporalFilter.before = primary.end.date();
		} else if (primary.start) {
			// Single reference: "last week", "in January"
			const start = primary.start.date();
			const end = primary.end?.date() ?? this.inferEndDate(primary, start);
			temporalFilter.after = start;
			temporalFilter.before = end;
		}

		// Check for recency indicators
		temporalFilter.sortByRecency = this.detectRecencyIntent(query);

		// Remove temporal expression from query for semantic search
		const semanticQuery = this.removeTemporalExpression(query, primary.text);

		return {
			semanticQuery: semanticQuery || query,
			temporalFilter,
			confidence: this.calculateConfidence(primary),
		};
	}

	/**
	 * Check if query implies wanting recent results.
	 */
	private detectRecencyIntent(query: string): boolean {
		const recencyPatterns = /\b(latest|recent|newest|current|most recent|last)\b/i;
		return recencyPatterns.test(query);
	}

	/**
	 * Remove temporal expression from query, cleaning up whitespace.
	 */
	private removeTemporalExpression(query: string, expression: string): string {
		return query
			.replace(expression, "")
			.replace(/\s{2,}/g, " ") // Collapse multiple spaces to single space
			.replace(/\s+([?!.,])/g, "$1") // Remove space before punctuation
			.trim();
	}

	/**
	 * Infer end date based on granularity of the parsed result.
	 */
	private inferEndDate(result: chrono.ParsedResult, start: Date): Date {
		const component = result.start;

		if (component.isCertain("day")) {
			// Same day - end of day
			const end = new Date(start);
			end.setHours(23, 59, 59, 999);
			return end;
		} else if (component.isCertain("month") && !component.isCertain("day")) {
			// End of month
			const end = new Date(start);
			end.setMonth(end.getMonth() + 1);
			end.setDate(0);
			end.setHours(23, 59, 59, 999);
			return end;
		} else if (component.isCertain("year") && !component.isCertain("month")) {
			// End of year
			return new Date(start.getFullYear(), 11, 31, 23, 59, 59, 999);
		}

		// Default: 7 days from start (for expressions like "last week")
		return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
	}

	/**
	 * Calculate confidence based on how certain the parsed components are.
	 */
	private calculateConfidence(result: chrono.ParsedResult): number {
		let certainty = 0;
		const component = result.start;

		if (component.isCertain("year")) certainty += 0.3;
		if (component.isCertain("month")) certainty += 0.3;
		if (component.isCertain("day")) certainty += 0.3;
		if (result.end) certainty += 0.1; // Explicit range

		return Math.min(certainty, 1.0);
	}
}

/**
 * Build Qdrant filter from temporal constraints.
 *
 * @param filter - Temporal filter with date constraints
 * @param fieldName - Name of the timestamp field in Qdrant (default: "valid_time")
 * @returns Qdrant filter object or null if no constraints
 */
export function buildTemporalFilter(
	filter: TemporalFilter,
	fieldName: string = "valid_time",
): QdrantTemporalFilter | null {
	if (!filter.after && !filter.before) {
		return null;
	}

	const conditions: Array<{ key: string; range: { gte?: string; lte?: string } }> = [];

	if (filter.after) {
		conditions.push({
			key: fieldName,
			range: { gte: filter.after.toISOString() },
		});
	}

	if (filter.before) {
		conditions.push({
			key: fieldName,
			range: { lte: filter.before.toISOString() },
		});
	}

	return { must: conditions };
}

/**
 * Apply recency boost to search results.
 *
 * More recent results get higher scores when the query implies recency.
 *
 * @param results - Search results with validTime and score
 * @param referenceDate - Reference date for calculating age
 * @param boostFactor - How much to boost recent results (0-1, default 0.1)
 * @param maxAgeDays - Maximum age for boost calculation (default 30)
 */
export function applyRecencyBoost<T extends { validTime?: Date; score: number }>(
	results: T[],
	referenceDate: Date,
	boostFactor: number = 0.1,
	maxAgeDays: number = 30,
): T[] {
	const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

	return results
		.map((result) => {
			if (!result.validTime) return result;

			const age = referenceDate.getTime() - result.validTime.getTime();
			const recencyScore = Math.max(0, 1 - age / maxAgeMs);
			const boostedScore = result.score * (1 + boostFactor * recencyScore);

			return { ...result, score: boostedScore };
		})
		.sort((a, b) => b.score - a.score);
}
