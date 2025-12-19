import type { EngramDocument } from "./mapper.js";
import type { LLMProvider } from "./reader.js";

/**
 * Key Expansion for improved retrieval
 *
 * Based on LongMemEval findings:
 * - Fact-augmented key expansion improves recall by 9.4%
 * - Extracting summaries, keyphrases, user facts, and timestamped events
 *
 * @see https://arxiv.org/abs/2410.10813
 */

/**
 * Types of key expansion supported
 */
export type ExpansionType = "summary" | "keyphrase" | "userfact" | "event";

/**
 * Configuration for key expansion
 */
export interface KeyExpansionConfig {
	/** Which expansion types to use */
	types: ExpansionType[];
	/** LLM for extraction (optional - uses heuristics if not provided) */
	llm?: LLMProvider;
	/** Maximum tokens per extraction */
	maxTokens: number;
}

const DEFAULT_CONFIG: KeyExpansionConfig = {
	types: ["keyphrase", "userfact"],
	maxTokens: 256,
};

/**
 * Expanded document with additional keys for retrieval
 */
export interface ExpandedDocument extends EngramDocument {
	/** Original content */
	originalContent: string;
	/** Expanded content for indexing */
	expandedContent: string;
	/** Extracted metadata */
	expansion: {
		summary?: string;
		keyphrases?: string[];
		userFacts?: string[];
		events?: TimestampedEvent[];
	};
}

/**
 * A timestamped event extracted from content
 */
export interface TimestampedEvent {
	description: string;
	date?: Date;
	dateText?: string;
}

/**
 * Key expander that augments documents with extracted facts
 */
export class KeyExpander {
	private config: KeyExpansionConfig;

	constructor(config: Partial<KeyExpansionConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Expand a batch of documents
	 */
	async expandBatch(documents: EngramDocument[]): Promise<ExpandedDocument[]> {
		const expanded: ExpandedDocument[] = [];

		for (const doc of documents) {
			expanded.push(await this.expand(doc));
		}

		return expanded;
	}

	/**
	 * Expand a single document
	 */
	async expand(document: EngramDocument): Promise<ExpandedDocument> {
		const expansion: ExpandedDocument["expansion"] = {};

		// Extract based on configured types
		for (const type of this.config.types) {
			switch (type) {
				case "summary":
					expansion.summary = await this.extractSummary(document.content);
					break;
				case "keyphrase":
					expansion.keyphrases = await this.extractKeyphrases(document.content);
					break;
				case "userfact":
					expansion.userFacts = await this.extractUserFacts(document.content);
					break;
				case "event":
					expansion.events = await this.extractEvents(document.content, document.validTime);
					break;
			}
		}

		// Build expanded content
		const expandedContent = this.buildExpandedContent(document.content, expansion);

		return {
			...document,
			originalContent: document.content,
			expandedContent,
			content: expandedContent, // Replace content for indexing
			expansion,
		};
	}

	/**
	 * Extract a summary from content
	 */
	private async extractSummary(content: string): Promise<string> {
		if (this.config.llm) {
			return this.llmExtractSummary(content);
		}
		return this.heuristicSummary(content);
	}

	/**
	 * Extract keyphrases from content
	 */
	private async extractKeyphrases(content: string): Promise<string[]> {
		if (this.config.llm) {
			return this.llmExtractKeyphrases(content);
		}
		return this.heuristicKeyphrases(content);
	}

	/**
	 * Extract user facts from content
	 */
	private async extractUserFacts(content: string): Promise<string[]> {
		if (this.config.llm) {
			return this.llmExtractUserFacts(content);
		}
		return this.heuristicUserFacts(content);
	}

	/**
	 * Extract timestamped events from content
	 */
	private async extractEvents(content: string, baseDate: Date): Promise<TimestampedEvent[]> {
		if (this.config.llm) {
			return this.llmExtractEvents(content, baseDate);
		}
		return this.heuristicEvents(content, baseDate);
	}

	/**
	 * Build expanded content from original + extracted facts
	 */
	private buildExpandedContent(original: string, expansion: ExpandedDocument["expansion"]): string {
		const parts = [original];

		if (expansion.summary) {
			parts.push(`[Summary: ${expansion.summary}]`);
		}

		if (expansion.keyphrases && expansion.keyphrases.length > 0) {
			parts.push(`[Keywords: ${expansion.keyphrases.join(", ")}]`);
		}

		if (expansion.userFacts && expansion.userFacts.length > 0) {
			parts.push(`[Facts: ${expansion.userFacts.join("; ")}]`);
		}

		if (expansion.events && expansion.events.length > 0) {
			const eventStrs = expansion.events.map(
				(e) => `${e.description}${e.dateText ? ` (${e.dateText})` : ""}`,
			);
			parts.push(`[Events: ${eventStrs.join("; ")}]`);
		}

		return parts.join("\n");
	}

	// ========== LLM-based extraction ==========

	private async llmExtractSummary(content: string): Promise<string> {
		const prompt = `Summarize the following conversation turn in one sentence. Focus on the key information shared.

Content:
${content}

Summary (one sentence):`;

		const response = await this.config.llm?.complete(prompt, { maxTokens: 100 });
		return response.text.trim();
	}

	private async llmExtractKeyphrases(content: string): Promise<string[]> {
		const prompt = `Extract 3-5 key phrases from the following text. Return only the phrases, one per line.

Content:
${content}

Key phrases:`;

		const response = await this.config.llm?.complete(prompt, { maxTokens: 100 });
		return response.text
			.split("\n")
			.map((line) => line.trim().replace(/^[-•*]\s*/, ""))
			.filter((line) => line.length > 0);
	}

	private async llmExtractUserFacts(content: string): Promise<string[]> {
		const prompt = `Extract any personal facts about the user from this conversation. Include preferences, biographical info, habits, etc. Return facts as simple statements, one per line.

Content:
${content}

User facts (if any):`;

		const response = await this.config.llm?.complete(prompt, { maxTokens: 150 });
		return response.text
			.split("\n")
			.map((line) => line.trim().replace(/^[-•*]\s*/, ""))
			.filter(
				(line) =>
					line.length > 0 &&
					!line.toLowerCase().includes("no ") &&
					!line.toLowerCase().includes("none"),
			);
	}

	private async llmExtractEvents(content: string, baseDate: Date): Promise<TimestampedEvent[]> {
		const prompt = `Extract any events or activities mentioned in this text. For each event, note if a specific date or time is mentioned. Return as JSON array.

Content:
${content}

Base date for relative references: ${baseDate.toISOString().split("T")[0]}

Return JSON array of objects with "description" and optional "dateText" fields:`;

		const response = await this.config.llm?.complete(prompt, { maxTokens: 200 });

		try {
			const jsonMatch = response.text.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0]);
			}
		} catch {
			// Fall back to heuristic
		}

		return this.heuristicEvents(content, baseDate);
	}

	// ========== Heuristic-based extraction ==========

	private heuristicSummary(content: string): string {
		// Take first sentence or first 100 chars
		const firstSentence = content.match(/^[^.!?]+[.!?]/);
		if (firstSentence && firstSentence[0].length < 200) {
			return firstSentence[0].trim();
		}
		return `${content.slice(0, 100).trim()}...`;
	}

	private heuristicKeyphrases(content: string): string[] {
		const keyphrases: string[] = [];

		// Extract noun phrases (simplified)
		const words = content.toLowerCase().split(/\s+/);
		const stopwords = new Set([
			"the",
			"a",
			"an",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"being",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"must",
			"shall",
			"can",
			"need",
			"dare",
			"ought",
			"used",
			"to",
			"of",
			"in",
			"for",
			"on",
			"with",
			"at",
			"by",
			"from",
			"as",
			"into",
			"through",
			"during",
			"before",
			"after",
			"above",
			"below",
			"between",
			"under",
			"again",
			"further",
			"then",
			"once",
			"here",
			"there",
			"when",
			"where",
			"why",
			"how",
			"all",
			"each",
			"few",
			"more",
			"most",
			"other",
			"some",
			"such",
			"no",
			"nor",
			"not",
			"only",
			"own",
			"same",
			"so",
			"than",
			"too",
			"very",
			"just",
			"i",
			"me",
			"my",
			"myself",
			"we",
			"our",
			"ours",
			"you",
			"your",
			"he",
			"him",
			"his",
			"she",
			"her",
			"it",
			"its",
			"they",
			"them",
			"their",
			"what",
			"which",
			"who",
			"whom",
			"this",
			"that",
			"these",
			"those",
			"am",
			"and",
			"but",
			"if",
			"or",
			"because",
			"until",
			"while",
		]);

		// Find significant words
		const significantWords = words.filter(
			(w) => w.length > 3 && !stopwords.has(w) && /^[a-z]+$/.test(w),
		);

		// Count frequency
		const freq = new Map<string, number>();
		for (const word of significantWords) {
			freq.set(word, (freq.get(word) ?? 0) + 1);
		}

		// Get top words
		const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
		keyphrases.push(...sorted.slice(0, 5).map(([word]) => word));

		return keyphrases;
	}

	private heuristicUserFacts(content: string): string[] {
		const facts: string[] = [];
		const _lowerContent = content.toLowerCase();

		// Patterns for user facts
		const patterns = [
			/my (?:favorite|favourite) (\w+) is ([^.!?,]+)/gi,
			/i (?:am|'m) (?:a |an )?([^.!?,]+)/gi,
			/i (?:live|work|study) (?:in|at) ([^.!?,]+)/gi,
			/i (?:like|love|enjoy|prefer) ([^.!?,]+)/gi,
			/i (?:have|own|got) (?:a |an )?([^.!?,]+)/gi,
			/my (?:name|job|occupation|hobby) is ([^.!?,]+)/gi,
			/i (?:was born|grew up) (?:in|on) ([^.!?,]+)/gi,
		];

		for (const pattern of patterns) {
			for (const match of content.matchAll(pattern)) {
				const fact = match[0].trim();
				if (fact.length > 5 && fact.length < 100) {
					facts.push(fact);
				}
			}
		}

		return [...new Set(facts)].slice(0, 5);
	}

	private heuristicEvents(content: string, _baseDate: Date): TimestampedEvent[] {
		const events: TimestampedEvent[] = [];

		// Patterns for events with dates
		const datePatterns = [
			/(?:on|at|during|last|next|this) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
			/(?:on|in|during) (january|february|march|april|may|june|july|august|september|october|november|december)(?: \d{1,2})?(?:,? \d{4})?/gi,
			/(yesterday|today|tomorrow|last week|next week|last month|next month)/gi,
			/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/g,
			/(\d{4}-\d{2}-\d{2})/g,
		];

		// Activity patterns
		const activityPatterns = [
			/i (?:went|visited|attended|saw|met|had) ([^.!?]+)/gi,
			/(?:going|planning|scheduled) to ([^.!?]+)/gi,
			/(?:bought|purchased|ordered|received) ([^.!?]+)/gi,
		];

		// Extract date mentions
		const dateMentions: string[] = [];
		for (const pattern of datePatterns) {
			for (const match of content.matchAll(pattern)) {
				dateMentions.push(match[1]);
			}
		}

		// Extract activities
		for (const pattern of activityPatterns) {
			for (const match of content.matchAll(pattern)) {
				const description = match[0].trim();
				if (description.length > 10 && description.length < 150) {
					events.push({
						description,
						dateText: dateMentions[0], // Associate with first date mention
					});
				}
			}
		}

		return events.slice(0, 5);
	}
}

/**
 * Apply key expansion to documents before indexing
 */
export async function expandDocuments(
	documents: EngramDocument[],
	config?: Partial<KeyExpansionConfig>,
): Promise<ExpandedDocument[]> {
	const expander = new KeyExpander(config);
	return expander.expandBatch(documents);
}
