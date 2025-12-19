/**
 * Base Embedder - Abstract base class for all embedding implementations.
 *
 * This class extracts common patterns from TextEmbedder, CodeEmbedder,
 * ColBERTEmbedder, and SpladeEmbedder to eliminate code duplication.
 *
 * Common patterns extracted:
 * - Singleton instance management with lazy loading
 * - Input validation
 * - Vector normalization
 * - Retry logic integration
 * - Model preloading capability
 *
 * @module @engram/search/services/base-embedder
 */

import { type RetryOptions, withRetry } from "@engram/common";
import type { Logger } from "@engram/logger";

/**
 * Base configuration for all embedders.
 */
export interface EmbedderConfig {
	/** Model identifier (HuggingFace model name) */
	model: string;
	/** Output embedding dimensions */
	dimensions: number;
	/** Maximum input tokens (optional, for validation) */
	maxTokens?: number;
	/** Batch size for batch operations */
	batchSize?: number;
}

/**
 * Options for embedding operations.
 */
export interface EmbedOptions {
	/** Whether to normalize the output vector */
	normalize?: boolean;
	/** Pooling strategy */
	pooling?: "mean" | "cls" | "none";
	/** Prefix to prepend to input (e.g., "passage:", "query:") */
	prefix?: string;
}

/**
 * Sparse vector format compatible with Qdrant.
 */
export interface SparseVector {
	indices: number[];
	values: number[];
}

/**
 * Abstract base class for embedding implementations.
 *
 * Subclasses must implement:
 * - `loadModel()`: Initialize the model instance
 * - `embed()`: Generate embeddings for a single input
 *
 * Subclasses may override:
 * - `embedBatch()`: Optimized batch embedding (default: sequential)
 * - `preload()`: Pre-warm the model (default: calls loadModel)
 *
 * @template TConfig - Configuration type extending EmbedderConfig
 * @template TOutput - Output type (number[] for dense, Float32Array[] for multi-vector, SparseVector for sparse)
 */
export abstract class BaseEmbedder<
	TConfig extends EmbedderConfig = EmbedderConfig,
	TOutput = number[],
> {
	protected config: TConfig;
	protected logger?: Logger;

	constructor(config: TConfig, logger?: Logger) {
		this.config = config;
		this.logger = logger;
	}

	/**
	 * Generate embeddings for a single input.
	 * Must be implemented by subclasses.
	 */
	abstract embed(text: string): Promise<TOutput>;

	/**
	 * Load/initialize the model.
	 * Called lazily on first use or explicitly via preload().
	 */
	protected abstract loadModel(): Promise<void>;

	/**
	 * Generate embeddings for multiple inputs.
	 * Default implementation processes sequentially.
	 * Subclasses can override for optimized batch processing.
	 */
	async embedBatch(texts: string[]): Promise<TOutput[]> {
		const results: TOutput[] = [];
		for (const text of texts) {
			results.push(await this.embed(text));
		}
		return results;
	}

	/**
	 * Pre-load the model for faster first embedding.
	 * Useful for warming up during application startup.
	 */
	async preload(): Promise<void> {
		await this.loadModel();
	}

	/**
	 * Execute a function with retry logic and exponential backoff.
	 * Wraps @engram/common withRetry for embedder-specific defaults.
	 */
	protected async withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
		return withRetry(fn, {
			maxRetries: 3,
			initialDelayMs: 1000,
			maxDelayMs: 10000,
			onRetry: (error, attempt, delayMs) => {
				this.logger?.warn({
					msg: "Embedding retry",
					attempt,
					delayMs,
					error: error instanceof Error ? error.message : String(error),
				});
			},
			...options,
		});
	}

	/**
	 * Validate input text before embedding.
	 * Throws on empty input, warns on potential token limit exceeded.
	 */
	protected validateInput(text: string): void {
		if (!text || text.trim().length === 0) {
			throw new Error("Input text cannot be empty");
		}
		// Rough estimate: 1 token ~= 4 characters for English text
		if (this.config.maxTokens && text.length > this.config.maxTokens * 4) {
			this.logger?.warn({
				msg: "Input may exceed token limit",
				inputLength: text.length,
				maxTokens: this.config.maxTokens,
				estimatedTokens: Math.ceil(text.length / 4),
			});
		}
	}

	/**
	 * L2 normalize a vector for cosine similarity.
	 * Returns the original vector if magnitude is zero.
	 */
	protected normalizeVector(vector: number[]): number[] {
		const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		return magnitude > 0 ? vector.map((v) => v / magnitude) : vector;
	}

	/**
	 * L2 normalize a Float32Array in place for efficiency.
	 * Returns the same array mutated.
	 */
	protected normalizeFloat32Array(vector: Float32Array): Float32Array {
		let sumSquares = 0;
		for (let i = 0; i < vector.length; i++) {
			sumSquares += vector[i] * vector[i];
		}
		const magnitude = Math.sqrt(sumSquares);
		if (magnitude > 0) {
			for (let i = 0; i < vector.length; i++) {
				vector[i] /= magnitude;
			}
		}
		return vector;
	}

	/**
	 * Average multiple embeddings into one and normalize.
	 * Used for combining chunk embeddings (e.g., in CodeEmbedder).
	 */
	protected averageEmbeddings(embeddings: number[][]): number[] {
		if (embeddings.length === 0) return [];
		if (embeddings.length === 1) return embeddings[0];

		const dim = embeddings[0].length;
		const avg = new Array(dim).fill(0);

		for (const emb of embeddings) {
			for (let i = 0; i < dim; i++) {
				avg[i] += emb[i];
			}
		}

		// Average
		for (let i = 0; i < dim; i++) {
			avg[i] /= embeddings.length;
		}

		// L2 normalize
		return this.normalizeVector(avg);
	}
}

/**
 * Abstract base class for dense embedders using HuggingFace pipeline.
 * Provides singleton pattern for model instance management.
 *
 * @template TConfig - Configuration type extending EmbedderConfig
 */
export abstract class BasePipelineEmbedder<
	TConfig extends EmbedderConfig = EmbedderConfig,
> extends BaseEmbedder<TConfig, number[]> {
	/**
	 * Type definition for HuggingFace feature extraction function.
	 */
	protected static extractorType: (
		text: string,
		opts: { pooling: string; normalize: boolean },
	) => Promise<{ data: Float32Array }>;

	/**
	 * Get the singleton model instance.
	 * Must be implemented by subclasses to manage their specific singleton.
	 */
	protected abstract getInstance(): Promise<typeof BasePipelineEmbedder.extractorType>;

	/**
	 * Call the embedding API with the configured options.
	 */
	protected async callEmbeddingAPI(text: string, options: EmbedOptions = {}): Promise<number[]> {
		const extractor = await this.getInstance();
		const pooling = options.pooling ?? "mean";
		const normalize = options.normalize ?? true;
		const input = options.prefix ? `${options.prefix} ${text}` : text;

		const output = await extractor(input, { pooling, normalize });
		return Array.from(output.data);
	}
}

/**
 * Abstract base class for multi-vector embedders (e.g., ColBERT).
 * Returns token-level embeddings instead of pooled single vectors.
 *
 * @template TConfig - Configuration type extending EmbedderConfig
 */
export abstract class BaseMultiVectorEmbedder<
	TConfig extends EmbedderConfig = EmbedderConfig,
> extends BaseEmbedder<TConfig, Float32Array[]> {
	/** Token embedding dimension (e.g., 128 for ColBERT) */
	protected tokenDimension: number;

	constructor(config: TConfig, tokenDimension: number, logger?: Logger) {
		super(config, logger);
		this.tokenDimension = tokenDimension;
	}

	/**
	 * Split a flat Float32Array into per-token embeddings.
	 */
	protected splitIntoTokenEmbeddings(data: Float32Array): Float32Array[] {
		const numTokens = data.length / this.tokenDimension;
		const tokenEmbeddings: Float32Array[] = [];

		for (let i = 0; i < numTokens; i++) {
			const start = i * this.tokenDimension;
			const end = start + this.tokenDimension;
			tokenEmbeddings.push(data.slice(start, end) as Float32Array);
		}

		return tokenEmbeddings;
	}
}

/**
 * Abstract base class for sparse embedders (e.g., SPLADE).
 * Returns sparse vectors with indices and values.
 *
 * @template TConfig - Configuration type extending EmbedderConfig
 */
export abstract class BaseSparseEmbedder<
	TConfig extends EmbedderConfig = EmbedderConfig,
> extends BaseEmbedder<TConfig, SparseVector> {
	/**
	 * Check if the model is loaded and ready.
	 */
	abstract isReady(): boolean;
}
