import { pipeline } from "@huggingface/transformers";
import {
	BasePipelineEmbedder,
	type EmbedderConfig,
	getDefaultDevice,
	getDefaultDtype,
} from "./base-embedder";
import { SpladeEmbedder } from "./splade-embedder";

/**
 * Supported embedding model identifiers.
 */
export type EmbeddingModel =
	| "e5-small"
	| "e5-base"
	| "e5-large"
	| "gte-base"
	| "gte-large"
	| "bge-small"
	| "bge-base"
	| "bge-large";

/**
 * Model configuration with HuggingFace model ID and settings.
 */
export interface ModelConfig {
	/** HuggingFace model identifier */
	hfModel: string;
	/** Embedding dimensions */
	dimensions: number;
	/** Prefix for query embeddings */
	queryPrefix: string;
	/** Prefix for passage embeddings */
	passagePrefix: string;
	/** Maximum tokens */
	maxTokens: number;
}

/**
 * Configuration for creating embedders.
 */
export interface EmbedderFactoryConfig {
	/** Model to use */
	model: EmbeddingModel;
	/** Whether to include sparse embeddings */
	sparse?: boolean;
}

/**
 * Model configurations for supported embedding models.
 */
export const MODEL_CONFIGS: Record<EmbeddingModel, ModelConfig> = {
	"e5-small": {
		hfModel: "Xenova/multilingual-e5-small",
		dimensions: 384,
		queryPrefix: "query:",
		passagePrefix: "passage:",
		maxTokens: 512,
	},
	"e5-base": {
		hfModel: "Xenova/multilingual-e5-base",
		dimensions: 768,
		queryPrefix: "query:",
		passagePrefix: "passage:",
		maxTokens: 512,
	},
	"e5-large": {
		hfModel: "Xenova/multilingual-e5-large",
		dimensions: 1024,
		queryPrefix: "query:",
		passagePrefix: "passage:",
		maxTokens: 512,
	},
	"gte-base": {
		hfModel: "Xenova/gte-base",
		dimensions: 768,
		queryPrefix: "",
		passagePrefix: "",
		maxTokens: 512,
	},
	"gte-large": {
		hfModel: "Xenova/gte-large",
		dimensions: 1024,
		queryPrefix: "",
		passagePrefix: "",
		maxTokens: 512,
	},
	"bge-small": {
		hfModel: "Xenova/bge-small-en-v1.5",
		dimensions: 384,
		queryPrefix: "Represent this sentence for searching relevant passages:",
		passagePrefix: "",
		maxTokens: 512,
	},
	"bge-base": {
		hfModel: "Xenova/bge-base-en-v1.5",
		dimensions: 768,
		queryPrefix: "Represent this sentence for searching relevant passages:",
		passagePrefix: "",
		maxTokens: 512,
	},
	"bge-large": {
		hfModel: "Xenova/bge-large-en-v1.5",
		dimensions: 1024,
		queryPrefix: "Represent this sentence for searching relevant passages:",
		passagePrefix: "",
		maxTokens: 512,
	},
};

type ExtractorFn = (
	text: string,
	opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/**
 * Configurable text embedder supporting multiple models.
 *
 * Features:
 * - Support for E5, GTE, and BGE model families
 * - Configuration-based model selection
 * - Optional sparse embeddings via SPLADE
 *
 * @example
 * ```typescript
 * const embedder = createEmbedder({ model: "gte-large" });
 * const vector = await embedder.embedQuery("What is machine learning?");
 * // Returns 1024-dimensional vector
 * ```
 */
export class ConfigurableTextEmbedder extends BasePipelineEmbedder<EmbedderConfig> {
	private static instances = new Map<string, unknown>();
	private sparseEmbedder?: SpladeEmbedder;
	private modelConfig: ModelConfig;
	private includeSparse: boolean;

	constructor(config: EmbedderFactoryConfig) {
		const modelConfig = MODEL_CONFIGS[config.model];
		if (!modelConfig) {
			throw new Error(
				`Unknown model: ${config.model}. Supported: ${Object.keys(MODEL_CONFIGS).join(", ")}`,
			);
		}

		super({
			model: modelConfig.hfModel,
			dimensions: modelConfig.dimensions,
			maxTokens: modelConfig.maxTokens,
		});

		this.modelConfig = modelConfig;
		this.includeSparse = config.sparse ?? false;

		if (this.includeSparse) {
			this.sparseEmbedder = new SpladeEmbedder();
		}
	}

	/**
	 * Get embedding dimensions for this model.
	 */
	get dimensions(): number {
		return this.modelConfig.dimensions;
	}

	/**
	 * Get the model identifier.
	 */
	get modelName(): string {
		return this.modelConfig.hfModel;
	}

	/**
	 * Get or create singleton pipeline instance for this model.
	 */
	protected async getInstance(): Promise<ExtractorFn> {
		const key = this.modelConfig.hfModel;
		if (!ConfigurableTextEmbedder.instances.has(key)) {
			ConfigurableTextEmbedder.instances.set(
				key,
				await pipeline("feature-extraction", this.modelConfig.hfModel, {
					dtype: this.config.dtype ?? getDefaultDtype(),
					device: this.config.device ?? getDefaultDevice(),
				}),
			);
		}
		return ConfigurableTextEmbedder.instances.get(key) as ExtractorFn;
	}

	/**
	 * Load the model (for preloading).
	 */
	protected async loadModel(): Promise<void> {
		await this.getInstance();
		if (this.sparseEmbedder) {
			await this.sparseEmbedder.preload();
		}
	}

	/**
	 * Embed document (passage) for storage/indexing.
	 */
	async embed(text: string): Promise<number[]> {
		return this.callEmbeddingAPI(text, {
			prefix: this.modelConfig.passagePrefix,
			pooling: "mean",
			normalize: true,
		});
	}

	/**
	 * Embed query for searching.
	 */
	async embedQuery(text: string): Promise<number[]> {
		return this.callEmbeddingAPI(text, {
			prefix: this.modelConfig.queryPrefix,
			pooling: "mean",
			normalize: true,
		});
	}

	/**
	 * Generate sparse vector using SPLADE.
	 * Only available if sparse=true was passed to constructor.
	 */
	async embedSparse(text: string): Promise<{ indices: number[]; values: number[] }> {
		if (!this.sparseEmbedder) {
			throw new Error("Sparse embeddings not enabled. Pass sparse: true to constructor.");
		}
		return this.sparseEmbedder.embed(text);
	}

	/**
	 * Generate sparse vector for queries.
	 * Only available if sparse=true was passed to constructor.
	 */
	async embedSparseQuery(text: string): Promise<{ indices: number[]; values: number[] }> {
		if (!this.sparseEmbedder) {
			throw new Error("Sparse embeddings not enabled. Pass sparse: true to constructor.");
		}
		return this.sparseEmbedder.embedQuery(text);
	}

	/**
	 * Preload the SPLADE model.
	 */
	async preloadSparse(): Promise<void> {
		if (this.sparseEmbedder) {
			await this.sparseEmbedder.preload();
		}
	}

	/**
	 * Check if sparse embeddings are available.
	 */
	hasSparse(): boolean {
		return this.includeSparse;
	}
}

/**
 * Create an embedder with the specified configuration.
 *
 * @example
 * ```typescript
 * // E5-small (default, 384d)
 * const embedder = createEmbedder({ model: "e5-small" });
 *
 * // GTE-large (1024d) with sparse
 * const embedder = createEmbedder({ model: "gte-large", sparse: true });
 * ```
 */
export function createEmbedder(config: EmbedderFactoryConfig): ConfigurableTextEmbedder {
	return new ConfigurableTextEmbedder(config);
}

/**
 * Get model configuration without creating an embedder.
 */
export function getModelConfig(model: EmbeddingModel): ModelConfig {
	const config = MODEL_CONFIGS[model];
	if (!config) {
		throw new Error(`Unknown model: ${model}`);
	}
	return config;
}

/**
 * List all supported embedding models.
 */
export function listModels(): EmbeddingModel[] {
	return Object.keys(MODEL_CONFIGS) as EmbeddingModel[];
}
