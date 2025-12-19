/**
 * Query feature extraction for learned fusion weight prediction.
 *
 * Extracts features from queries that can be used to predict optimal
 * fusion weights for combining dense/sparse/rerank results.
 */

/**
 * Question type classification for query analysis.
 */
export type QuestionType =
	| "factoid" // Who, what, when, where
	| "list" // List all, enumerate
	| "comparison" // Compare, difference
	| "causal" // Why, how
	| "opinion" // What do you think
	| "temporal" // Time-based queries
	| "other";

/**
 * Extracted features from a query for fusion weight prediction.
 */
export interface FusionQueryFeatures {
	/** Number of tokens in the query */
	length: number;
	/** Ratio of named entities to total tokens (0-1) */
	entityDensity: number;
	/** Whether query contains temporal markers */
	hasTemporal: boolean;
	/** Classified question type */
	questionType: QuestionType;
	/** Average IDF of query terms */
	avgIDF: number;
	/** Whether query contains rare terms (IDF > threshold) */
	hasRareTerms: boolean;
	/** Whether query contains specific keywords/entities */
	hasSpecificTerms: boolean;
	/** Query complexity score (0-1) */
	complexity: number;
}

/**
 * Normalized feature vector for ML model input.
 */
export interface FusionNormalizedFeatures {
	/** Features as array for model input */
	vector: number[];
	/** Feature names for debugging */
	names: string[];
}

/**
 * Configuration for the feature extractor.
 */
export interface QueryFeatureExtractorConfig {
	/** IDF index for term frequency analysis */
	idfIndex?: Map<string, number>;
	/** Threshold for considering a term "rare" */
	rareTermThreshold?: number;
}

const DEFAULT_CONFIG: QueryFeatureExtractorConfig = {
	rareTermThreshold: 5.0,
};

/**
 * Extracts features from queries for learned fusion weight prediction.
 *
 * @example
 * ```typescript
 * const extractor = new QueryFeatureExtractor();
 * const features = extractor.extract("Who founded Microsoft in 1975?");
 * // features.questionType = "factoid"
 * // features.hasTemporal = true
 * // features.entityDensity = 0.33 (Microsoft is an entity)
 * ```
 */
export class QueryFeatureExtractor {
	private config: Required<QueryFeatureExtractorConfig>;
	private idfIndex: Map<string, number>;

	constructor(config: QueryFeatureExtractorConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config } as Required<QueryFeatureExtractorConfig>;
		this.idfIndex = config.idfIndex ?? new Map();
	}

	/**
	 * Set or update the IDF index for term frequency analysis.
	 */
	setIDFIndex(index: Map<string, number>): void {
		this.idfIndex = index;
	}

	/**
	 * Build IDF index from a corpus of documents.
	 */
	buildIDFIndex(documents: string[]): void {
		const docCount = documents.length;
		const termDocCounts = new Map<string, number>();

		// Count documents containing each term
		for (const doc of documents) {
			const terms = new Set(this.tokenize(doc));
			for (const term of terms) {
				termDocCounts.set(term, (termDocCounts.get(term) ?? 0) + 1);
			}
		}

		// Calculate IDF: log(N / df)
		this.idfIndex = new Map();
		for (const [term, df] of termDocCounts) {
			this.idfIndex.set(term, Math.log(docCount / df));
		}
	}

	/**
	 * Extract features from a query.
	 */
	extract(query: string): FusionQueryFeatures {
		const tokens = this.tokenize(query);
		const entities = this.extractEntities(query);

		return {
			length: tokens.length,
			entityDensity: tokens.length > 0 ? entities.length / tokens.length : 0,
			hasTemporal: this.detectTemporal(query),
			questionType: this.classifyQuestion(query),
			avgIDF: this.calculateAvgIDF(tokens),
			hasRareTerms: this.hasRareTerms(tokens),
			hasSpecificTerms: entities.length > 0 || this.hasSpecificKeywords(query),
			complexity: this.calculateComplexity(query, tokens),
		};
	}

	/**
	 * Convert features to normalized vector for ML model input.
	 */
	toNormalizedVector(features: FusionQueryFeatures): FusionNormalizedFeatures {
		const vector = [
			features.length / 20, // Normalize to ~0-1 for typical queries
			features.entityDensity,
			features.hasTemporal ? 1 : 0,
			this.encodeQuestionType(features.questionType),
			features.avgIDF / 10, // Normalize IDF
			features.hasRareTerms ? 1 : 0,
			features.hasSpecificTerms ? 1 : 0,
			features.complexity,
		];

		const names = [
			"length_norm",
			"entity_density",
			"has_temporal",
			"question_type",
			"avg_idf_norm",
			"has_rare_terms",
			"has_specific_terms",
			"complexity",
		];

		return { vector, names };
	}

	/**
	 * Simple tokenization (words, lowercase).
	 */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 0);
	}

	/**
	 * Extract named entities using simple heuristics.
	 * Returns capitalized words that aren't at sentence start.
	 */
	private extractEntities(query: string): string[] {
		const entities: string[] = [];

		// Match capitalized words not at the start of the query
		const words = query.split(/\s+/);
		for (let i = 1; i < words.length; i++) {
			const word = words[i].replace(/[^\w]/g, "");
			if (word.length > 1 && /^[A-Z]/.test(word)) {
				entities.push(word);
			}
		}

		// Also match common entity patterns
		const patterns = [
			/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, // Multi-word names
			/\b[A-Z]{2,}\b/g, // Acronyms
			/\b\d{4}\b/g, // Years
		];

		for (const pattern of patterns) {
			const matches = query.match(pattern);
			if (matches) {
				entities.push(...matches);
			}
		}

		return [...new Set(entities)];
	}

	/**
	 * Detect temporal expressions in query.
	 */
	private detectTemporal(query: string): boolean {
		const temporalPatterns =
			/\b(yesterday|today|tomorrow|last|recent|before|after|when|during|since|ago|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/i;
		return temporalPatterns.test(query);
	}

	/**
	 * Classify question type based on query patterns.
	 */
	private classifyQuestion(query: string): QuestionType {
		const lower = query.toLowerCase();

		// Check for temporal markers first (overlaps with factoid)
		if (this.detectTemporal(query) && /^when\b/.test(lower)) {
			return "temporal";
		}

		// Factoid questions (who, what, when, where)
		if (/^(who|what|when|where|which)\b/.test(lower)) {
			return "factoid";
		}

		// List questions
		if (/^(list|enumerate|name|give me all|what are all)\b/.test(lower)) {
			return "list";
		}

		// Comparison questions
		if (/\b(compare|difference|versus|vs|differ|between)\b/.test(lower)) {
			return "comparison";
		}

		// Causal questions (why, how)
		if (/^(why|how)\b/.test(lower)) {
			return "causal";
		}

		// Opinion questions
		if (/\b(think|opinion|feel|believe|should|recommend)\b/.test(lower)) {
			return "opinion";
		}

		return "other";
	}

	/**
	 * Calculate average IDF of query terms.
	 */
	private calculateAvgIDF(tokens: string[]): number {
		if (tokens.length === 0 || this.idfIndex.size === 0) {
			return 0;
		}

		let totalIDF = 0;
		let count = 0;

		for (const token of tokens) {
			const idf = this.idfIndex.get(token);
			if (idf !== undefined) {
				totalIDF += idf;
				count++;
			}
		}

		return count > 0 ? totalIDF / count : 0;
	}

	/**
	 * Check if query contains rare terms (high IDF).
	 */
	private hasRareTerms(tokens: string[]): boolean {
		for (const token of tokens) {
			const idf = this.idfIndex.get(token);
			if (idf !== undefined && idf > this.config.rareTermThreshold) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check for specific keywords that suggest keyword search would help.
	 */
	private hasSpecificKeywords(query: string): boolean {
		// Technical terms, version numbers, etc.
		const specificPatterns = [
			/v\d+(\.\d+)*/i, // Version numbers
			/\b[A-Z][a-z]+[A-Z]\w*\b/, // CamelCase
			/\b\w+[-_]\w+\b/, // Hyphenated/underscored terms
			/"[^"]+"/g, // Quoted phrases
		];

		return specificPatterns.some((p) => p.test(query));
	}

	/**
	 * Calculate query complexity based on structure and content.
	 */
	private calculateComplexity(query: string, tokens: string[]): number {
		let complexity = 0;

		// Length contributes to complexity
		complexity += Math.min(tokens.length / 15, 0.3);

		// Multiple clauses
		if (/\b(and|or|but|however|although)\b/i.test(query)) {
			complexity += 0.2;
		}

		// Nested questions
		if ((query.match(/\?/g) || []).length > 1) {
			complexity += 0.2;
		}

		// Conditional language
		if (/\b(if|when|assuming|given that)\b/i.test(query)) {
			complexity += 0.15;
		}

		// Multiple entities
		const entities = this.extractEntities(query);
		complexity += Math.min(entities.length * 0.1, 0.2);

		return Math.min(complexity, 1.0);
	}

	/**
	 * Encode question type as numeric value for ML model.
	 */
	private encodeQuestionType(type: QuestionType): number {
		const encoding: Record<QuestionType, number> = {
			factoid: 0.0,
			list: 0.15,
			comparison: 0.3,
			causal: 0.45,
			temporal: 0.6,
			opinion: 0.75,
			other: 0.9,
		};
		return encoding[type];
	}
}

/**
 * Recommended fusion weight hints based on query features.
 * This provides rule-based defaults when no trained model is available.
 */
export function getFusionHints(features: FusionQueryFeatures): {
	dense: number;
	sparse: number;
	rerank: number;
} {
	// Default balanced weights
	let dense = 0.4;
	let sparse = 0.3;
	let rerank = 0.3;

	// Factoid queries benefit from dense (semantic)
	if (features.questionType === "factoid") {
		dense = 0.5;
		sparse = 0.2;
		rerank = 0.3;
	}

	// Queries with specific terms benefit from sparse (keyword)
	if (features.hasSpecificTerms || features.hasRareTerms) {
		sparse = 0.4;
		dense = 0.3;
		rerank = 0.3;
	}

	// Complex queries benefit more from reranking
	if (features.complexity > 0.5) {
		rerank = 0.4;
		dense = 0.35;
		sparse = 0.25;
	}

	// Short keyword-like queries favor sparse
	if (features.length <= 3 && !features.hasTemporal) {
		sparse = 0.5;
		dense = 0.25;
		rerank = 0.25;
	}

	return { dense, sparse, rerank };
}
