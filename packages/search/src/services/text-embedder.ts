import { pipeline } from "@huggingface/transformers";
import { BasePipelineEmbedder, type EmbedderConfig } from "./base-embedder";
import { SpladeEmbedder } from "./splade-embedder";

/**
 * Configuration for TextEmbedder.
 */
export interface TextEmbedderConfig extends EmbedderConfig {
	/** Task prefix for passages (default: "passage:") */
	passagePrefix?: string;
	/** Task prefix for queries (default: "query:") */
	queryPrefix?: string;
}

const DEFAULT_CONFIG: TextEmbedderConfig = {
	model: "Xenova/multilingual-e5-small",
	dimensions: 384,
	maxTokens: 512,
	passagePrefix: "passage:",
	queryPrefix: "query:",
};

type ExtractorFn = (
	text: string,
	opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/**
 * Text embedder using multilingual-e5-small model.
 * Extends BasePipelineEmbedder for common functionality.
 *
 * Features:
 * - Dense embeddings via HuggingFace pipeline
 * - Sparse embeddings via SPLADE delegation
 * - Task prefix support for retrieval optimization
 */
export class TextEmbedder extends BasePipelineEmbedder<TextEmbedderConfig> {
	private static instance: unknown = null;
	private sparseEmbedder = new SpladeEmbedder();

	constructor(config: Partial<TextEmbedderConfig> = {}) {
		super({ ...DEFAULT_CONFIG, ...config });
	}

	/**
	 * Get or create singleton pipeline instance.
	 */
	protected async getInstance(): Promise<ExtractorFn> {
		if (!TextEmbedder.instance) {
			TextEmbedder.instance = await pipeline("feature-extraction", this.config.model);
		}
		return TextEmbedder.instance as ExtractorFn;
	}

	/**
	 * Load the model (for preloading).
	 */
	protected async loadModel(): Promise<void> {
		await this.getInstance();
	}

	/**
	 * Embed document (passage) for storage/indexing.
	 */
	async embed(text: string): Promise<number[]> {
		return this.callEmbeddingAPI(text, {
			prefix: this.config.passagePrefix,
			pooling: "mean",
			normalize: true,
		});
	}

	/**
	 * Embed query for searching.
	 */
	async embedQuery(text: string): Promise<number[]> {
		return this.callEmbeddingAPI(text, {
			prefix: this.config.queryPrefix,
			pooling: "mean",
			normalize: true,
		});
	}

	/**
	 * Generate sparse vector using SPLADE learned sparse embeddings.
	 * Returns indices (vocabulary token IDs) and values (term importance weights).
	 */
	async embedSparse(text: string): Promise<{ indices: number[]; values: number[] }> {
		return this.sparseEmbedder.embed(text);
	}

	/**
	 * Generate sparse vector for queries using SPLADE.
	 */
	async embedSparseQuery(text: string): Promise<{ indices: number[]; values: number[] }> {
		return this.sparseEmbedder.embedQuery(text);
	}

	/**
	 * Preload the SPLADE model for faster first embedding.
	 */
	async preloadSparse(): Promise<void> {
		await this.sparseEmbedder.preload();
	}
}
