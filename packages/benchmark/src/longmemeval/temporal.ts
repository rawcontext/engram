import type { LLMProvider } from "./reader.js";

/**
 * Time-Aware Query Expansion
 *
 * Based on LongMemEval findings:
 * - Time-aware indexing and query expansion improves temporal reasoning by 7-11%
 * - Extracting temporal ranges from queries narrows search scope
 *
 * @see https://arxiv.org/abs/2410.10813
 */

/**
 * Configuration for temporal query expansion
 */
export interface TemporalConfig {
	/** LLM for extraction (optional - uses heuristics if not provided) */
	llm?: LLMProvider;
	/** Default time window in days when no explicit range */
	defaultWindowDays: number;
}

const DEFAULT_CONFIG: TemporalConfig = {
	defaultWindowDays: 30,
};

/**
 * Result of temporal query analysis
 */
export interface TemporalAnalysis {
	/** Original query */
	originalQuery: string;
	/** Expanded query with temporal context */
	expandedQuery: string;
	/** Extracted time range for filtering */
	timeRange?: TimeRange;
	/** Temporal keywords found */
	temporalKeywords: string[];
	/** Whether query requires temporal reasoning */
	isTemporalQuery: boolean;
}

/**
 * Time range for filtering
 */
export interface TimeRange {
	start: Date;
	end: Date;
	confidence: "high" | "medium" | "low";
	source: string; // What triggered this range
}

/**
 * Temporal query analyzer and expander
 */
export class TemporalAnalyzer {
	private config: TemporalConfig;

	constructor(config: Partial<TemporalConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Analyze and expand a query for temporal context
	 */
	async analyze(query: string, queryDate: Date): Promise<TemporalAnalysis> {
		// Extract temporal keywords
		const temporalKeywords = this.extractTemporalKeywords(query);
		const isTemporalQuery = temporalKeywords.length > 0 || this.hasTemporalIntent(query);

		// Extract time range
		let timeRange: TimeRange | undefined;
		if (isTemporalQuery) {
			timeRange = this.config.llm
				? await this.llmExtractTimeRange(query, queryDate)
				: this.heuristicTimeRange(query, queryDate);
		}

		// Expand query
		const expandedQuery = this.expandQuery(query, timeRange, queryDate);

		return {
			originalQuery: query,
			expandedQuery,
			timeRange,
			temporalKeywords,
			isTemporalQuery,
		};
	}

	/**
	 * Extract temporal keywords from query
	 */
	private extractTemporalKeywords(query: string): string[] {
		const keywords: string[] = [];
		const lowerQuery = query.toLowerCase();

		// Temporal keyword patterns
		const patterns = [
			// Relative time
			/\b(yesterday|today|tomorrow|last|next|recent|recently|previous|current|now)\b/g,
			// Time units
			/\b(week|month|year|day|hour|minute|morning|afternoon|evening|night)\b/g,
			// Ordinals
			/\b(first|second|third|latest|earliest|oldest|newest)\b/g,
			// Temporal questions
			/\b(when|since|until|before|after|during|while)\b/g,
			// Specific time references
			/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g,
			/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g,
			// Date patterns
			/\b\d{4}\b/g, // Year
			/\b\d{1,2}\/\d{1,2}\b/g, // Date format
		];

		for (const pattern of patterns) {
			let match;
			while ((match = pattern.exec(lowerQuery)) !== null) {
				keywords.push(match[0]);
			}
		}

		return [...new Set(keywords)];
	}

	/**
	 * Check if query has temporal intent without explicit keywords
	 */
	private hasTemporalIntent(query: string): boolean {
		const lowerQuery = query.toLowerCase();

		// Questions that often require temporal context
		const temporalPatterns = [
			/how long/,
			/how many times/,
			/what time/,
			/what date/,
			/which day/,
			/most recent/,
			/changed|updated|modified/,
			/started|began|ended|finished/,
			/first time|last time/,
			/ever since/,
			/up to now/,
			/so far/,
			/at the moment/,
			/currently/,
		];

		return temporalPatterns.some((pattern) => pattern.test(lowerQuery));
	}

	/**
	 * Extract time range using heuristics
	 */
	private heuristicTimeRange(query: string, queryDate: Date): TimeRange | undefined {
		const lowerQuery = query.toLowerCase();

		// Yesterday
		if (/\byesterday\b/.test(lowerQuery)) {
			const start = new Date(queryDate);
			start.setDate(start.getDate() - 1);
			start.setHours(0, 0, 0, 0);
			const end = new Date(start);
			end.setHours(23, 59, 59, 999);
			return { start, end, confidence: "high", source: "yesterday" };
		}

		// Today
		if (/\btoday\b/.test(lowerQuery)) {
			const start = new Date(queryDate);
			start.setHours(0, 0, 0, 0);
			const end = new Date(queryDate);
			end.setHours(23, 59, 59, 999);
			return { start, end, confidence: "high", source: "today" };
		}

		// Tomorrow
		if (/\btomorrow\b/.test(lowerQuery)) {
			const start = new Date(queryDate);
			start.setDate(start.getDate() + 1);
			start.setHours(0, 0, 0, 0);
			const end = new Date(start);
			end.setHours(23, 59, 59, 999);
			return { start, end, confidence: "high", source: "tomorrow" };
		}

		// Last week
		if (/\blast\s+week\b/.test(lowerQuery)) {
			const end = new Date(queryDate);
			const start = new Date(queryDate);
			start.setDate(start.getDate() - 7);
			return { start, end, confidence: "high", source: "last week" };
		}

		// Last month
		if (/\blast\s+month\b/.test(lowerQuery)) {
			const end = new Date(queryDate);
			const start = new Date(queryDate);
			start.setMonth(start.getMonth() - 1);
			return { start, end, confidence: "high", source: "last month" };
		}

		// Last year
		if (/\blast\s+year\b/.test(lowerQuery)) {
			const end = new Date(queryDate);
			const start = new Date(queryDate);
			start.setFullYear(start.getFullYear() - 1);
			return { start, end, confidence: "high", source: "last year" };
		}

		// Last N days/weeks/months
		const lastNMatch = lowerQuery.match(/\blast\s+(\d+)\s+(day|week|month|year)s?\b/);
		if (lastNMatch) {
			const n = Number.parseInt(lastNMatch[1], 10);
			const unit = lastNMatch[2];
			const end = new Date(queryDate);
			const start = new Date(queryDate);

			switch (unit) {
				case "day":
					start.setDate(start.getDate() - n);
					break;
				case "week":
					start.setDate(start.getDate() - n * 7);
					break;
				case "month":
					start.setMonth(start.getMonth() - n);
					break;
				case "year":
					start.setFullYear(start.getFullYear() - n);
					break;
			}

			return { start, end, confidence: "high", source: `last ${n} ${unit}s` };
		}

		// Specific month
		const monthMatch = lowerQuery.match(
			/\b(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/,
		);
		if (monthMatch) {
			const monthNames = [
				"january",
				"february",
				"march",
				"april",
				"may",
				"june",
				"july",
				"august",
				"september",
				"october",
				"november",
				"december",
			];
			const monthIndex = monthNames.indexOf(monthMatch[1]);
			const year = monthMatch[2] ? Number.parseInt(monthMatch[2], 10) : queryDate.getFullYear();

			const start = new Date(year, monthIndex, 1);
			const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

			return {
				start,
				end,
				confidence: monthMatch[2] ? "high" : "medium",
				source: `${monthMatch[1]} ${year}`,
			};
		}

		// Specific year
		const yearMatch = lowerQuery.match(/\bin\s+(\d{4})\b/);
		if (yearMatch) {
			const year = Number.parseInt(yearMatch[1], 10);
			const start = new Date(year, 0, 1);
			const end = new Date(year, 11, 31, 23, 59, 59, 999);
			return { start, end, confidence: "high", source: `year ${year}` };
		}

		// Recent/recently - default window
		if (/\brecent(ly)?\b/.test(lowerQuery)) {
			const end = new Date(queryDate);
			const start = new Date(queryDate);
			start.setDate(start.getDate() - this.config.defaultWindowDays);
			return { start, end, confidence: "medium", source: "recently" };
		}

		// Day of week (assume most recent occurrence)
		const dayMatch = lowerQuery.match(
			/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
		);
		if (dayMatch) {
			const dayNames = [
				"sunday",
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
			];
			const targetDay = dayNames.indexOf(dayMatch[1]);
			const currentDay = queryDate.getDay();
			let daysBack = currentDay - targetDay;
			if (daysBack <= 0) daysBack += 7;

			const start = new Date(queryDate);
			start.setDate(start.getDate() - daysBack);
			start.setHours(0, 0, 0, 0);
			const end = new Date(start);
			end.setHours(23, 59, 59, 999);

			return { start, end, confidence: "medium", source: dayMatch[1] };
		}

		return undefined;
	}

	/**
	 * Extract time range using LLM
	 */
	private async llmExtractTimeRange(
		query: string,
		queryDate: Date,
	): Promise<TimeRange | undefined> {
		const prompt = `Analyze this question and extract any time constraints.

Question: "${query}"
Current date: ${queryDate.toISOString().split("T")[0]}

If the question references a specific time period, return JSON with:
{
  "start": "YYYY-MM-DD",
  "end": "YYYY-MM-DD",
  "confidence": "high" | "medium" | "low",
  "source": "what triggered this range"
}

If no time constraint is implied, return: {"noTimeConstraint": true}

JSON response:`;

		const response = await this.config.llm!.complete(prompt, { maxTokens: 100 });

		try {
			const jsonMatch = response.text.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				if (parsed.noTimeConstraint) {
					return undefined;
				}
				return {
					start: new Date(parsed.start),
					end: new Date(parsed.end),
					confidence: parsed.confidence ?? "medium",
					source: parsed.source ?? "llm extraction",
				};
			}
		} catch {
			// Fall back to heuristic
			return this.heuristicTimeRange(query, queryDate);
		}

		return undefined;
	}

	/**
	 * Expand query with temporal context
	 */
	private expandQuery(query: string, timeRange: TimeRange | undefined, queryDate: Date): string {
		if (!timeRange) {
			return query;
		}

		// Add temporal context to query
		const dateContext = `[Time context: ${formatDateRange(timeRange.start, timeRange.end)}]`;
		return `${query}\n${dateContext}`;
	}
}

/**
 * Format a date range for display
 */
function formatDateRange(start: Date, end: Date): string {
	// Validate dates before formatting
	if (!isValidDate(start) || !isValidDate(end)) {
		return "unknown date range";
	}

	const startStr = start.toISOString().split("T")[0];
	const endStr = end.toISOString().split("T")[0];

	if (startStr === endStr) {
		return startStr;
	}

	return `${startStr} to ${endStr}`;
}

/**
 * Check if a date is valid
 */
function isValidDate(date: Date): boolean {
	return date instanceof Date && !Number.isNaN(date.getTime());
}

/**
 * Quick function to analyze temporal aspects of a query
 */
export async function analyzeTemporalQuery(
	query: string,
	queryDate: Date,
	config?: Partial<TemporalConfig>,
): Promise<TemporalAnalysis> {
	const analyzer = new TemporalAnalyzer(config);
	return analyzer.analyze(query, queryDate);
}

/**
 * Filter documents by time range
 */
export function filterByTimeRange<T extends { validTime: Date }>(
	documents: T[],
	timeRange: TimeRange | { start: Date; end: Date },
): T[] {
	return documents.filter((doc) => {
		const docTime = doc.validTime.getTime();
		return docTime >= timeRange.start.getTime() && docTime <= timeRange.end.getTime();
	});
}
