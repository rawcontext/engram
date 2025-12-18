import type { EngramDocument, MappedInstance } from "./mapper.js";

/**
 * Configuration for the retrieval stage
 */
export interface RetrieverConfig {
	/** Retrieval method */
	method: "dense" | "bm25" | "hybrid";
	/** Number of documents to retrieve */
	topK: number;
	/** Time-aware query expansion (improves temporal reasoning by 7-11%) */
	timeAwareExpansion: boolean;
	/** Similarity threshold (0-1) */
	similarityThreshold?: number;
}

/**
 * Default retriever configuration
 */
export const DEFAULT_RETRIEVER_CONFIG: RetrieverConfig = {
	method: "dense",
	topK: 10,
	timeAwareExpansion: false,
	similarityThreshold: 0.5,
};

/**
 * Result of a retrieval operation
 */
export interface RetrievalResult {
	/** Retrieved documents */
	documents: EngramDocument[];
	/** Similarity scores for each document */
	scores: number[];
	/** IDs of retrieved documents */
	retrievedIds: string[];
	/** Time range extracted from query (if time-aware) */
	extractedTimeRange?: { start: Date; end: Date };
}

/**
 * Interface for embedding providers
 */
export interface EmbeddingProvider {
	/** Generate embeddings for texts */
	embed(texts: string[]): Promise<number[][]>;
	/** Get the embedding dimension */
	dimension: number;
}

/**
 * Simple in-memory vector store for benchmarking
 * In production, this would use Qdrant
 */
export class InMemoryVectorStore {
	private documents: EngramDocument[] = [];
	private embeddings: number[][] = [];
	private embeddingProvider: EmbeddingProvider;

	constructor(embeddingProvider: EmbeddingProvider) {
		this.embeddingProvider = embeddingProvider;
	}

	/**
	 * Index documents for retrieval
	 */
	async index(documents: EngramDocument[]): Promise<void> {
		const texts = documents.map((d) => d.content);
		const embeddings = await this.embeddingProvider.embed(texts);

		this.documents = documents;
		this.embeddings = embeddings;
	}

	/**
	 * Search for similar documents
	 */
	async search(query: string, topK: number): Promise<RetrievalResult> {
		const [queryEmbedding] = await this.embeddingProvider.embed([query]);

		// Compute cosine similarities
		const similarities = this.embeddings.map((docEmb) => cosineSimilarity(queryEmbedding, docEmb));

		// Get top-K indices
		const indices = similarities
			.map((score, index) => ({ score, index }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((item) => item.index);

		const documents = indices.map((i) => this.documents[i]);
		const scores = indices.map((i) => similarities[i]);
		const retrievedIds = documents.map((d) => d.id);

		return {
			documents,
			scores,
			retrievedIds,
		};
	}

	/**
	 * Clear the index
	 */
	clear(): void {
		this.documents = [];
		this.embeddings = [];
	}
}

/**
 * Computes cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error("Vectors must have the same dimension");
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	normA = Math.sqrt(normA);
	normB = Math.sqrt(normB);

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (normA * normB);
}

/**
 * Retriever class that handles document retrieval for LongMemEval
 */
export class Retriever {
	private config: RetrieverConfig;
	private vectorStore: InMemoryVectorStore;

	constructor(embeddingProvider: EmbeddingProvider, config?: Partial<RetrieverConfig>) {
		this.config = { ...DEFAULT_RETRIEVER_CONFIG, ...config };
		this.vectorStore = new InMemoryVectorStore(embeddingProvider);
	}

	/**
	 * Index a mapped instance for retrieval
	 */
	async indexInstance(mapped: MappedInstance): Promise<void> {
		await this.vectorStore.index(mapped.documents);
	}

	/**
	 * Retrieve relevant documents for a question
	 */
	async retrieve(question: string, questionDate?: Date): Promise<RetrievalResult> {
		let query = question;
		let extractedTimeRange: { start: Date; end: Date } | undefined;

		// Apply time-aware query expansion if enabled
		if (this.config.timeAwareExpansion && questionDate) {
			const extraction = extractTemporalContext(question, questionDate);
			if (extraction) {
				query = extraction.expandedQuery;
				extractedTimeRange = extraction.timeRange;
			}
		}

		const result = await this.vectorStore.search(query, this.config.topK);

		// Filter by time range if extracted
		if (extractedTimeRange) {
			const filtered = result.documents.filter((doc) => {
				const docTime = doc.validTime.getTime();
				return (
					docTime >= extractedTimeRange!.start.getTime() &&
					docTime <= extractedTimeRange!.end.getTime()
				);
			});

			// If filtering removes too many, fall back to unfiltered
			if (filtered.length >= this.config.topK / 2) {
				result.documents = filtered.slice(0, this.config.topK);
				result.retrievedIds = result.documents.map((d) => d.id);
				result.scores = result.scores.slice(0, result.documents.length);
			}
		}

		result.extractedTimeRange = extractedTimeRange;

		return result;
	}

	/**
	 * Clear the index
	 */
	clear(): void {
		this.vectorStore.clear();
	}
}

/**
 * Extracts temporal context from a question
 * This is a simplified version - production would use LLM extraction
 */
function extractTemporalContext(
	question: string,
	questionDate: Date,
): { expandedQuery: string; timeRange: { start: Date; end: Date } } | null {
	const lowerQuestion = question.toLowerCase();

	// Common temporal patterns
	const patterns = [
		{ regex: /last (?:week|7 days)/i, daysBack: 7 },
		{ regex: /last (?:month|30 days)/i, daysBack: 30 },
		{ regex: /last (?:year|12 months)/i, daysBack: 365 },
		{ regex: /yesterday/i, daysBack: 1 },
		{ regex: /this (?:week|month)/i, daysBack: 7 },
	];

	for (const pattern of patterns) {
		if (pattern.regex.test(lowerQuestion)) {
			const end = new Date(questionDate);
			const start = new Date(questionDate);
			start.setDate(start.getDate() - pattern.daysBack);

			return {
				expandedQuery: question,
				timeRange: { start, end },
			};
		}
	}

	// Check for specific month/year mentions
	const monthYearMatch = lowerQuestion.match(
		/(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?/i,
	);

	if (monthYearMatch) {
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
		const monthIndex = monthNames.indexOf(monthYearMatch[1].toLowerCase());
		const year = monthYearMatch[2]
			? Number.parseInt(monthYearMatch[2], 10)
			: questionDate.getFullYear();

		const start = new Date(year, monthIndex, 1);
		const end = new Date(year, monthIndex + 1, 0);

		return {
			expandedQuery: question,
			timeRange: { start, end },
		};
	}

	return null;
}

/**
 * Computes retrieval metrics for evaluation
 */
export function computeRetrievalMetrics(
	result: RetrievalResult,
	evidenceDocIds: string[],
): {
	recall: number;
	precision: number;
	recallAtK: Record<number, number>;
} {
	const evidenceSet = new Set(evidenceDocIds);
	const retrievedSet = new Set(result.retrievedIds);

	// Compute recall and precision
	let hits = 0;
	for (const id of result.retrievedIds) {
		if (evidenceSet.has(id)) {
			hits++;
		}
	}

	const recall = evidenceDocIds.length > 0 ? hits / evidenceDocIds.length : 0;
	const precision = result.retrievedIds.length > 0 ? hits / result.retrievedIds.length : 0;

	// Compute recall@K for K = 1, 5, 10
	const recallAtK: Record<number, number> = {};
	for (const k of [1, 5, 10]) {
		const topKIds = result.retrievedIds.slice(0, k);
		let hitsAtK = 0;
		for (const id of topKIds) {
			if (evidenceSet.has(id)) {
				hitsAtK++;
			}
		}
		recallAtK[k] = evidenceDocIds.length > 0 ? hitsAtK / evidenceDocIds.length : 0;
	}

	return { recall, precision, recallAtK };
}
