import { pipeline } from "@huggingface/transformers";
import { BaseMultiVectorEmbedder, type EmbedderConfig } from "./base-embedder";

/**
 * Configuration for ColBERTEmbedder.
 */
export interface ColBERTEmbedderConfig extends EmbedderConfig {
	/** Token embedding dimension (default: 128) */
	tokenDimension?: number;
	/** Model quantization type */
	dtype?: "fp32" | "fp16" | "q8" | "q4";
	/** Prefix for passages */
	passagePrefix?: string;
	/** Prefix for queries */
	queryPrefix?: string;
}

const DEFAULT_CONFIG: ColBERTEmbedderConfig = {
	model: "jinaai/jina-colbert-v2",
	dimensions: 128, // Token-level dimension
	tokenDimension: 128,
	// Note: jina-colbert-v2 only provides fp32 ONNX weights (no quantized version available)
	// See: https://huggingface.co/jinaai/jina-colbert-v2/tree/main/onnx
	dtype: "fp32",
	passagePrefix: "passage:",
	queryPrefix: "query:",
};

type ExtractorFn = (
	text: string,
	opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/**
 * ColBERTEmbedder generates token-level embeddings for late interaction reranking.
 * Extends BaseMultiVectorEmbedder for multi-vector output.
 *
 * Model: jinaai/jina-colbert-v2 (559M parameters, 89 languages)
 * - Token dimension: 128
 * - Late interaction via MaxSim scoring
 * - 180x fewer FLOPs than cross-encoders at k=10
 *
 * Architecture:
 * 1. Documents: Pre-computed token embeddings stored in Qdrant multivector field
 * 2. Queries: Token embeddings computed at search time
 * 3. Scoring: MaxSim algorithm between query and document tokens
 */
export class ColBERTEmbedder extends BaseMultiVectorEmbedder<ColBERTEmbedderConfig> {
	private static instance: unknown = null;

	constructor(config: Partial<ColBERTEmbedderConfig> = {}) {
		const mergedConfig = { ...DEFAULT_CONFIG, ...config };
		super(mergedConfig, mergedConfig.tokenDimension ?? 128);
	}

	/**
	 * Get or create singleton pipeline instance.
	 * Uses lazy loading - model is only loaded on first use.
	 */
	static async getInstance(): Promise<ExtractorFn> {
		if (!ColBERTEmbedder.instance) {
			console.log(`[ColBERTEmbedder] Loading model ${DEFAULT_CONFIG.model}...`);
			ColBERTEmbedder.instance = await pipeline("feature-extraction", DEFAULT_CONFIG.model, {
				dtype: DEFAULT_CONFIG.dtype,
			});
			console.log("[ColBERTEmbedder] Model loaded successfully");
		}
		return ColBERTEmbedder.instance as ExtractorFn;
	}

	/**
	 * Load the model (for preloading).
	 */
	protected async loadModel(): Promise<void> {
		await ColBERTEmbedder.getInstance();
	}

	/**
	 * Encode document into token-level embeddings (128d per token).
	 * These embeddings are pre-computed at index time and stored in Qdrant.
	 *
	 * @param content - Document text to encode
	 * @returns Array of token embeddings (each token is 128d vector)
	 */
	async embed(content: string): Promise<Float32Array[]> {
		return this.encodeDocument(content);
	}

	/**
	 * Encode document into token-level embeddings (128d per token).
	 * These embeddings are pre-computed at index time and stored in Qdrant.
	 *
	 * @param content - Document text to encode
	 * @returns Array of token embeddings (each token is 128d vector)
	 */
	async encodeDocument(content: string): Promise<Float32Array[]> {
		const extractor = await ColBERTEmbedder.getInstance();

		// ColBERT uses token-level embeddings (no pooling)
		// Returns shape: [num_tokens, 128]
		const output = await extractor(`${this.config.passagePrefix} ${content}`, {
			pooling: "none", // Token-level embeddings
			normalize: true,
		});

		// Split flat array into per-token embeddings
		return this.splitIntoTokenEmbeddings(output.data);
	}

	/**
	 * Encode query for MaxSim scoring.
	 * Computed at search time for each query.
	 *
	 * @param query - Query text to encode
	 * @returns Array of token embeddings (each token is 128d vector)
	 */
	async encodeQuery(query: string): Promise<Float32Array[]> {
		const extractor = await ColBERTEmbedder.getInstance();

		// ColBERT uses token-level embeddings (no pooling)
		// Returns shape: [num_tokens, 128]
		const output = await extractor(`${this.config.queryPrefix} ${query}`, {
			pooling: "none", // Token-level embeddings
			normalize: true,
		});

		// Split flat array into per-token embeddings
		return this.splitIntoTokenEmbeddings(output.data);
	}
}
