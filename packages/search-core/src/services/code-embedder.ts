import { pipeline } from "@huggingface/transformers";

// Chunk configuration for code embeddings
const CHUNK_SIZE = 6000; // Characters (~1500 tokens, safe for model limits)
const CHUNK_OVERLAP = 500; // Overlap between chunks for context continuity
const MAX_CHUNKS = 5; // Limit chunks to avoid excessive processing

/**
 * Code-specific embedding using nomic-embed-text-v1.
 * Features:
 * - 8192 token context (using safe 6k char chunks)
 * - Task prefix support for better retrieval
 * - Chunking with overlap for large files
 */
export class CodeEmbedder {
	private static instance: unknown;
	// nomic-embed-text-v1: 8k context, designed for long text, works well for code
	// Has task prefixes: search_document, search_query
	private static modelName = "Xenova/nomic-embed-text-v1";

	static async getInstance() {
		if (!CodeEmbedder.instance) {
			CodeEmbedder.instance = await pipeline("feature-extraction", CodeEmbedder.modelName);
		}
		return CodeEmbedder.instance;
	}

	/**
	 * Embed code content for storage/indexing.
	 * Uses 'search_document:' prefix for retrieval optimization.
	 * Large files are chunked and averaged.
	 */
	async embed(code: string): Promise<number[]> {
		const chunks = this.chunkCode(code);

		if (chunks.length === 1) {
			return this.embedSingle(`search_document: ${chunks[0]}`);
		}

		// Multiple chunks: embed each and average
		const embeddings = await Promise.all(
			chunks.map((chunk) => this.embedSingle(`search_document: ${chunk}`)),
		);

		return this.averageEmbeddings(embeddings);
	}

	/**
	 * Embed a code query for searching.
	 * Uses 'search_query:' prefix for retrieval optimization.
	 */
	async embedQuery(query: string): Promise<number[]> {
		return this.embedSingle(`search_query: ${query}`);
	}

	/**
	 * Embed a single text chunk.
	 */
	private async embedSingle(text: string): Promise<number[]> {
		const extractor = await CodeEmbedder.getInstance();
		const extractFn = extractor as (
			text: string,
			opts: { pooling: string; normalize: boolean },
		) => Promise<{ data: Float32Array }>;
		const output = await extractFn(text, { pooling: "mean", normalize: true });
		return Array.from(output.data);
	}

	/**
	 * Split code into overlapping chunks for large files.
	 * Tries to split at natural boundaries (newlines).
	 */
	private chunkCode(code: string): string[] {
		if (code.length <= CHUNK_SIZE) {
			return [code];
		}

		const chunks: string[] = [];
		let start = 0;

		while (start < code.length && chunks.length < MAX_CHUNKS) {
			let end = Math.min(start + CHUNK_SIZE, code.length);

			// Try to find a natural break point (newline) near the end
			if (end < code.length) {
				const lastNewline = code.lastIndexOf("\n", end);
				if (lastNewline > start + CHUNK_SIZE * 0.5) {
					end = lastNewline + 1;
				}
			}

			chunks.push(code.slice(start, end));

			// Move start with overlap, but ensure progress
			start = Math.max(start + 1, end - CHUNK_OVERLAP);
		}

		return chunks;
	}

	/**
	 * Average multiple embeddings into one.
	 * Normalizes the result for cosine similarity.
	 */
	private averageEmbeddings(embeddings: number[][]): number[] {
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
		const norm = Math.sqrt(avg.reduce((sum, val) => sum + val * val, 0));
		if (norm > 0) {
			for (let i = 0; i < dim; i++) {
				avg[i] /= norm;
			}
		}

		return avg;
	}
}
