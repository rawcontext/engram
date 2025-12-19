export enum SearchStrategy {
	Sparse = "sparse",
	Dense = "dense",
	Hybrid = "hybrid",
}

/** Query complexity level for reranker routing */
export type QueryComplexity = "simple" | "moderate" | "complex";

/** Features extracted from a query for classification */
export interface QueryFeatures {
	length: number;
	wordCount: number;
	hasQuotes: boolean;
	hasOperators: boolean;
	hasCode: boolean;
	isQuestion: boolean;
	hasAgentic: boolean;
}

export class QueryClassifier {
	classify(query: string): { strategy: SearchStrategy; alpha: number } {
		// Heuristic:
		// 1. Quoted strings imply exact match intent -> Sparse
		// 2. Code-like patterns (camelCase, snake_case with parens) -> Sparse/Hybrid
		// 3. Natural language -> Dense/Hybrid

		const quoted = query.match(/"([^"]*)"/g);
		if (quoted && quoted.length > 0) {
			// Strong signal for exact match
			return { strategy: SearchStrategy.Sparse, alpha: 0.1 }; // Alpha 0.1 = mostly sparse (if using reciprocal rank fusion where 0 is sparse, 1 is dense. Convention varies.)
			// Let's assume alpha is weight for Dense. So 0.1 means 10% dense, 90% sparse.
		}

		// Simple code detection
		const hasCodeSyntax = /[a-zA-Z0-9_]+\(.*\)|[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+/.test(query);
		if (hasCodeSyntax) {
			return { strategy: SearchStrategy.Hybrid, alpha: 0.3 }; // Lean towards sparse
		}

		// Default: Hybrid leaning dense
		return { strategy: SearchStrategy.Hybrid, alpha: 0.7 };
	}

	/**
	 * Extract features from a query for complexity analysis.
	 */
	extractFeatures(query: string): QueryFeatures {
		return {
			length: query.length,
			wordCount: query.split(/\s+/).filter((w) => w.length > 0).length,
			hasQuotes: /"[^"]+"/.test(query),
			hasOperators: /\b(AND|OR|NOT)\b|\+|-/.test(query),
			hasCode: /[a-zA-Z]+\.[a-zA-Z]+\(|function\s|class\s|=>|import\s|export\s/.test(query),
			isQuestion: /^(what|how|why|when|where|who|which|can|does|is|are)\b/i.test(query),
			hasAgentic: /\b(tool|function|call|execute|invoke|run|api|endpoint)\b/i.test(query),
		};
	}

	/**
	 * Classify query complexity for reranker tier selection.
	 * Used by RerankerRouter to choose between fast/accurate/code tiers.
	 *
	 * Scoring:
	 * - simple: Basic queries, use fast reranker
	 * - moderate: Medium complexity, use accurate reranker
	 * - complex: High complexity or code queries, use code/accurate reranker
	 */
	classifyComplexity(query: string): {
		complexity: QueryComplexity;
		features: QueryFeatures;
		score: number;
	} {
		const features = this.extractFeatures(query);

		let score = 0;

		// Length-based scoring
		if (features.length > 100) score += 3;
		else if (features.length > 50) score += 2;
		else if (features.length > 25) score += 1;

		// Word count scoring
		if (features.wordCount > 12) score += 2;
		else if (features.wordCount > 8) score += 1;

		// Feature-based scoring
		if (features.hasQuotes) score += 1;
		if (features.hasOperators) score += 2;
		if (features.hasCode) score += 3;
		if (features.isQuestion) score += 1;
		if (features.hasAgentic) score += 2;

		// Determine complexity level
		let complexity: QueryComplexity;
		if (score >= 5) {
			complexity = "complex";
		} else if (score >= 2) {
			complexity = "moderate";
		} else {
			complexity = "simple";
		}

		return { complexity, features, score };
	}

	/**
	 * Check if query contains code patterns.
	 * Used for routing to code-specialized reranker.
	 */
	isCodeQuery(query: string): boolean {
		const features = this.extractFeatures(query);
		return features.hasCode;
	}

	/**
	 * Check if query is agentic/tool-related.
	 * May benefit from more accurate reranking.
	 */
	isAgenticQuery(query: string): boolean {
		const features = this.extractFeatures(query);
		return features.hasAgentic;
	}
}
