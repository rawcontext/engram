/**
 * Session Summarizer for hierarchical retrieval.
 *
 * Generates summaries for conversation sessions to enable two-stage retrieval:
 * 1. Stage 1: Retrieve relevant sessions based on summaries
 * 2. Stage 2: Retrieve turns within matched sessions
 *
 * Based on SGMem and LiCoMemory research.
 * @see https://arxiv.org/html/2509.21212 (SGMem)
 * @see https://arxiv.org/html/2511.01448 (LiCoMemory)
 */

import { pipeline } from "@huggingface/transformers";
import { TextEmbedder } from "./text-embedder";

/**
 * A turn in a conversation session
 */
export interface Turn {
	/** Unique turn ID */
	id: string;
	/** Session this turn belongs to */
	sessionId: string;
	/** Role of the speaker (user, assistant, system) */
	role: "user" | "assistant" | "system";
	/** Content of the turn */
	content: string;
	/** Timestamp of the turn */
	timestamp: Date;
}

/**
 * Summary of a conversation session for hierarchical retrieval
 */
export interface SessionSummary {
	/** Session ID */
	sessionId: string;
	/** Generated summary of session content */
	summary: string;
	/** Key topics discussed (extracted via keyword extraction) */
	topics: string[];
	/** Named entities mentioned (extracted via NER) */
	entities: string[];
	/** Start time of session */
	startTime: Date;
	/** End time of session */
	endTime: Date;
	/** Number of turns in session */
	turnCount: number;
	/** Embedding of summary for retrieval */
	embedding: number[];
}

/**
 * LLM provider interface for summarization
 */
export interface LLMProvider {
	complete(prompt: string, options?: LLMOptions): Promise<LLMResponse>;
}

export interface LLMOptions {
	temperature?: number;
	maxTokens?: number;
	stopSequences?: string[];
}

export interface LLMResponse {
	text: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
	};
}

/**
 * Configuration for SessionSummarizer
 */
export interface SessionSummarizerConfig {
	/** Maximum number of keywords/topics to extract (default: 5) */
	maxTopics: number;
	/** NER model for entity extraction (default: Xenova/bert-base-NER) */
	nerModel: string;
	/** Keyword extraction model (default: Xenova/all-MiniLM-L6-v2) */
	keywordModel: string;
	/** Minimum entity score to include (default: 0.7) */
	minEntityScore: number;
}

/**
 * Default configuration for session summarization
 */
export const DEFAULT_SESSION_SUMMARIZER_CONFIG: SessionSummarizerConfig = {
	maxTopics: 5,
	nerModel: "Xenova/bert-base-NER",
	keywordModel: "Xenova/all-MiniLM-L6-v2",
	minEntityScore: 0.7,
};

/**
 * NER result from HuggingFace pipeline
 */
interface NEREntity {
	word: string;
	entity: string;
	score: number;
	start: number;
	end: number;
}

/**
 * NER pipeline function type
 */
type NERPipeline = (text: string) => Promise<NEREntity[]>;

/**
 * Feature extraction pipeline for keyword extraction
 */
type FeatureExtractionPipeline = (
	texts: string[],
	options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }[]>;

/**
 * SessionSummarizer generates session summaries for hierarchical retrieval.
 *
 * Features:
 * - LLM-based summarization (2-3 sentences)
 * - Keyword/topic extraction (KeyBERT-style)
 * - Named entity recognition (NER)
 * - Summary embedding for retrieval
 *
 * @example
 * ```typescript
 * const summarizer = new SessionSummarizer(llm);
 *
 * const summary = await summarizer.summarize(turns);
 * console.log(summary.summary); // "Discussion about project setup..."
 * console.log(summary.topics);  // ["project setup", "deployment", ...]
 * console.log(summary.entities); // ["AWS", "Docker", "John", ...]
 * ```
 */
export class SessionSummarizer {
	private config: SessionSummarizerConfig;
	private llm: LLMProvider;
	private embedder: TextEmbedder;
	private nerPipeline: NERPipeline | null = null;
	private nerLoadingPromise: Promise<NERPipeline> | null = null;
	private keywordPipeline: FeatureExtractionPipeline | null = null;
	private keywordLoadingPromise: Promise<FeatureExtractionPipeline> | null = null;

	constructor(llm: LLMProvider, config: Partial<SessionSummarizerConfig> = {}) {
		this.config = { ...DEFAULT_SESSION_SUMMARIZER_CONFIG, ...config };
		this.llm = llm;
		this.embedder = new TextEmbedder();
	}

	/**
	 * Generate a summary for a conversation session.
	 *
	 * @param turns - Array of turns in the session (should be chronologically ordered)
	 * @returns SessionSummary with summary text, topics, entities, and embedding
	 */
	async summarize(turns: Turn[]): Promise<SessionSummary> {
		if (turns.length === 0) {
			throw new Error("Cannot summarize empty session");
		}

		// Build conversation context
		const context = turns.map((t) => `${t.role}: ${t.content}`).join("\n");

		// Run summarization, topic extraction, and entity extraction in parallel
		const [summary, topics, entities] = await Promise.all([
			this.generateSummary(context),
			this.extractTopics(context),
			this.extractEntities(context),
		]);

		// Generate embedding for the summary
		const embedding = await this.embedder.embed(summary);

		return {
			sessionId: turns[0].sessionId,
			summary,
			topics,
			entities,
			startTime: turns[0].timestamp,
			endTime: turns[turns.length - 1].timestamp,
			turnCount: turns.length,
			embedding,
		};
	}

	/**
	 * Generate a summary using the LLM.
	 *
	 * @param context - Full conversation text
	 * @returns 2-3 sentence summary
	 */
	private async generateSummary(context: string): Promise<string> {
		const prompt = `Summarize this conversation in 2-3 sentences, focusing on:
1. Main topics discussed
2. Key facts or decisions
3. Named entities mentioned

Conversation:
${context}

Summary:`;

		const response = await this.llm.complete(prompt, {
			temperature: 0.3, // Low temp for factual summary
			maxTokens: 150,
		});

		return response.text.trim();
	}

	/**
	 * Extract key topics/keywords from the conversation.
	 *
	 * Uses a KeyBERT-style approach:
	 * 1. Generate embeddings for the document and candidate keywords
	 * 2. Rank keywords by cosine similarity to document embedding
	 *
	 * @param text - Conversation text
	 * @returns Array of top keywords/topics
	 */
	async extractTopics(text: string): Promise<string[]> {
		// Extract candidate keywords using simple n-gram extraction
		const candidates = this.extractCandidateKeywords(text);

		if (candidates.length === 0) {
			return [];
		}

		// Get embeddings for document and candidates
		const featureExtractor = await this.loadKeywordPipeline();

		// Embed document
		const docEmbeddingResult = await featureExtractor([text], {
			pooling: "mean",
			normalize: true,
		});
		const docEmbedding = Array.from(docEmbeddingResult[0].data);

		// Embed candidates in batch
		const candidateEmbeddingsResult = await featureExtractor(candidates, {
			pooling: "mean",
			normalize: true,
		});

		// Calculate cosine similarity for each candidate
		const scored = candidates.map((candidate, idx) => {
			const candidateEmbedding = Array.from(candidateEmbeddingsResult[idx].data);
			const similarity = this.cosineSimilarity(docEmbedding, candidateEmbedding);
			return { keyword: candidate, score: similarity };
		});

		// Sort by score and take top N
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, this.config.maxTopics).map((s) => s.keyword);
	}

	/**
	 * Extract named entities from the conversation using NER.
	 *
	 * @param text - Conversation text
	 * @returns Array of unique entity names
	 */
	async extractEntities(text: string): Promise<string[]> {
		const ner = await this.loadNERPipeline();
		const entities = await ner(text);

		// Filter by score and deduplicate
		const filtered = entities
			.filter((e) => e.score >= this.config.minEntityScore)
			.map((e) => this.cleanEntityWord(e.word));

		// Deduplicate (case-insensitive)
		const seen = new Set<string>();
		const unique: string[] = [];
		for (const entity of filtered) {
			const lower = entity.toLowerCase();
			if (!seen.has(lower) && entity.length > 1) {
				seen.add(lower);
				unique.push(entity);
			}
		}

		return unique;
	}

	/**
	 * Extract candidate keywords using simple n-gram extraction.
	 * Focuses on nouns and noun phrases by filtering common stopwords.
	 */
	private extractCandidateKeywords(text: string): string[] {
		// Common English stopwords
		const stopwords = new Set([
			"a",
			"an",
			"the",
			"and",
			"or",
			"but",
			"in",
			"on",
			"at",
			"to",
			"for",
			"of",
			"with",
			"by",
			"from",
			"as",
			"is",
			"was",
			"are",
			"were",
			"been",
			"be",
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
			"this",
			"that",
			"these",
			"those",
			"i",
			"you",
			"he",
			"she",
			"it",
			"we",
			"they",
			"me",
			"him",
			"her",
			"us",
			"them",
			"my",
			"your",
			"his",
			"its",
			"our",
			"their",
			"what",
			"which",
			"who",
			"whom",
			"when",
			"where",
			"why",
			"how",
			"all",
			"each",
			"every",
			"both",
			"few",
			"more",
			"most",
			"other",
			"some",
			"such",
			"no",
			"not",
			"only",
			"own",
			"same",
			"so",
			"than",
			"too",
			"very",
			"just",
			"also",
			"now",
			"here",
			"there",
			"then",
			"user",
			"assistant",
			"system",
		]);

		// Tokenize and filter
		const words = text
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !stopwords.has(w));

		// Get unique words
		const uniqueWords = [...new Set(words)];

		// Generate bigrams (2-word phrases)
		const bigrams: string[] = [];
		for (let i = 0; i < words.length - 1; i++) {
			const bigram = `${words[i]} ${words[i + 1]}`;
			if (!stopwords.has(words[i]) && !stopwords.has(words[i + 1])) {
				bigrams.push(bigram);
			}
		}
		const uniqueBigrams = [...new Set(bigrams)];

		// Combine unigrams and bigrams (prioritize bigrams)
		return [...uniqueBigrams.slice(0, 20), ...uniqueWords.slice(0, 20)];
	}

	/**
	 * Calculate cosine similarity between two vectors.
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have same length");
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom === 0 ? 0 : dotProduct / denom;
	}

	/**
	 * Clean entity word from NER (remove ## prefix from subword tokens).
	 */
	private cleanEntityWord(word: string): string {
		// Remove BERT subword prefix
		return word.replace(/^##/, "");
	}

	/**
	 * Lazy load the NER pipeline.
	 */
	private async loadNERPipeline(): Promise<NERPipeline> {
		if (this.nerPipeline) {
			return this.nerPipeline;
		}

		if (this.nerLoadingPromise) {
			return this.nerLoadingPromise;
		}

		this.nerLoadingPromise = this.initNERPipeline();

		try {
			this.nerPipeline = await this.nerLoadingPromise;
			return this.nerPipeline;
		} finally {
			this.nerLoadingPromise = null;
		}
	}

	/**
	 * Initialize the NER pipeline.
	 */
	private async initNERPipeline(): Promise<NERPipeline> {
		const pipelineFn = pipeline as (task: string, model: string) => Promise<NERPipeline>;
		return pipelineFn("token-classification", this.config.nerModel);
	}

	/**
	 * Lazy load the keyword extraction pipeline.
	 */
	private async loadKeywordPipeline(): Promise<FeatureExtractionPipeline> {
		if (this.keywordPipeline) {
			return this.keywordPipeline;
		}

		if (this.keywordLoadingPromise) {
			return this.keywordLoadingPromise;
		}

		this.keywordLoadingPromise = this.initKeywordPipeline();

		try {
			this.keywordPipeline = await this.keywordLoadingPromise;
			return this.keywordPipeline;
		} finally {
			this.keywordLoadingPromise = null;
		}
	}

	/**
	 * Initialize the keyword extraction pipeline.
	 */
	private async initKeywordPipeline(): Promise<FeatureExtractionPipeline> {
		const pipelineFn = pipeline as (
			task: string,
			model: string,
		) => Promise<FeatureExtractionPipeline>;
		return pipelineFn("feature-extraction", this.config.keywordModel);
	}

	/**
	 * Preload models for faster first summarization.
	 */
	async preload(): Promise<void> {
		await Promise.all([
			this.loadNERPipeline(),
			this.loadKeywordPipeline(),
			this.embedder.preload(),
		]);
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): Readonly<SessionSummarizerConfig> {
		return this.config;
	}

	/**
	 * Update configuration at runtime.
	 */
	updateConfig(config: Partial<SessionSummarizerConfig>): void {
		this.config = { ...this.config, ...config };
	}
}
