import { pipeline as hfPipeline } from "@huggingface/transformers";
import {
	BasePipelineEmbedder,
	type EmbedderConfig,
	getDefaultDevice,
	getDefaultDtype,
} from "./base-embedder";
import { SpladeEmbedder } from "./splade-embedder";

// Workaround for TS2590: Expression produces a union type that is too complex
// The @huggingface/transformers pipeline function has complex overloads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipeline = hfPipeline as any;

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
	private static loadingPromise: Promise<unknown> | null = null;
	private sparseEmbedder = new SpladeEmbedder();

	constructor(config: Partial<TextEmbedderConfig> = {}) {
		super({ ...DEFAULT_CONFIG, ...config });
	}

	/**
	 * Get or create singleton pipeline instance.
	 * Uses a loading promise to prevent concurrent model loading race conditions.
	 */
	protected async getInstance(): Promise<ExtractorFn> {
		// Already loaded - return immediately
		if (TextEmbedder.instance) {
			return TextEmbedder.instance as ExtractorFn;
		}

		// Another call is already loading - wait for it
		if (TextEmbedder.loadingPromise) {
			await TextEmbedder.loadingPromise;
			return TextEmbedder.instance as ExtractorFn;
		}

		// We're the first - create and store the loading promise
		const device = this.config.device ?? getDefaultDevice();
		const dtype = this.config.dtype ?? getDefaultDtype();
		console.log(
			`[TextEmbedder] Loading model ${this.config.model} on device=${device} dtype=${dtype}`,
		);
		const start = Date.now();

		TextEmbedder.loadingPromise = pipeline("feature-extraction", this.config.model, {
			dtype,
			device,
		});

		try {
			TextEmbedder.instance = await TextEmbedder.loadingPromise;
			console.log(`[TextEmbedder] Model loaded in ${Date.now() - start}ms`);
			return TextEmbedder.instance as ExtractorFn;
		} finally {
			TextEmbedder.loadingPromise = null;
		}
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
