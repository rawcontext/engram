import { pipeline } from "@huggingface/transformers";
import { BasePipelineEmbedder, type EmbedderConfig } from "./base-embedder";

/**
 * Configuration for CodeEmbedder.
 */
export interface CodeEmbedderConfig extends EmbedderConfig {
	/** Characters per chunk (default: 6000, ~1500 tokens) */
	chunkSize?: number;
	/** Overlap between chunks for context continuity */
	chunkOverlap?: number;
	/** Maximum chunks to process per file */
	maxChunks?: number;
	/** Task prefix for documents (default: "search_document:") */
	documentPrefix?: string;
	/** Task prefix for queries (default: "search_query:") */
	queryPrefix?: string;
}

const DEFAULT_CONFIG: CodeEmbedderConfig = {
	model: "Xenova/nomic-embed-text-v1",
	dimensions: 768,
	maxTokens: 8192,
	chunkSize: 6000,
	chunkOverlap: 500,
	maxChunks: 5,
	documentPrefix: "search_document:",
	queryPrefix: "search_query:",
};

type ExtractorFn = (
	text: string,
	opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/**
 * Code-specific embedding using nomic-embed-text-v1.
 * Extends BasePipelineEmbedder for common functionality.
 *
 * Features:
 * - 8192 token context (using safe 6k char chunks)
 * - Task prefix support for better retrieval
 * - Chunking with overlap for large files
 * - Automatic embedding averaging for chunked content
 */
export class CodeEmbedder extends BasePipelineEmbedder<CodeEmbedderConfig> {
	private static instance: unknown = null;

	constructor(config: Partial<CodeEmbedderConfig> = {}) {
		super({ ...DEFAULT_CONFIG, ...config });
	}

	/**
	 * Get or create singleton pipeline instance.
	 */
	protected async getInstance(): Promise<ExtractorFn> {
		if (!CodeEmbedder.instance) {
			CodeEmbedder.instance = await pipeline("feature-extraction", this.config.model);
		}
		return CodeEmbedder.instance as ExtractorFn;
	}

	/**
	 * Load the model (for preloading).
	 */
	protected async loadModel(): Promise<void> {
		await this.getInstance();
	}

	/**
	 * Embed code content for storage/indexing.
	 * Uses 'search_document:' prefix for retrieval optimization.
	 * Large files are chunked and averaged.
	 */
	async embed(code: string): Promise<number[]> {
		const chunks = this.chunkCode(code);

		if (chunks.length === 1) {
			return this.embedSingle(`${this.config.documentPrefix} ${chunks[0]}`);
		}

		// Multiple chunks: embed each and average
		const embeddings = await Promise.all(
			chunks.map((chunk) => this.embedSingle(`${this.config.documentPrefix} ${chunk}`)),
		);

		return this.averageEmbeddings(embeddings);
	}

	/**
	 * Embed a code query for searching.
	 * Uses 'search_query:' prefix for retrieval optimization.
	 */
	async embedQuery(query: string): Promise<number[]> {
		return this.embedSingle(`${this.config.queryPrefix} ${query}`);
	}

	/**
	 * Embed a single text chunk.
	 */
	private async embedSingle(text: string): Promise<number[]> {
		const extractor = await this.getInstance();
		const output = await extractor(text, { pooling: "mean", normalize: true });
		return Array.from(output.data);
	}

	/**
	 * Split code into overlapping chunks for large files.
	 * Tries to split at natural boundaries (newlines).
	 */
	private chunkCode(code: string): string[] {
		const { chunkSize = 6000, chunkOverlap = 500, maxChunks = 5 } = this.config;

		if (code.length <= chunkSize) {
			return [code];
		}

		const chunks: string[] = [];
		let start = 0;

		while (start < code.length && chunks.length < maxChunks) {
			let end = Math.min(start + chunkSize, code.length);

			// Try to find a natural break point (newline) near the end
			if (end < code.length) {
				const lastNewline = code.lastIndexOf("\n", end);
				if (lastNewline > start + chunkSize * 0.5) {
					end = lastNewline + 1;
				}
			}

			chunks.push(code.slice(start, end));

			// Move start with overlap, but ensure progress
			start = Math.max(start + 1, end - chunkOverlap);
		}

		return chunks;
	}
}
