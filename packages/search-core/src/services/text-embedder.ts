import { AutoTokenizer, pipeline } from "@huggingface/transformers";

/**
 * BM25-based sparse vector generator for hybrid search.
 * Uses BERT tokenizer for vocabulary-based indexing and BM25 scoring.
 */
class BM25Sparse {
	// BM25 parameters
	private k1 = 1.2; // Term frequency saturation parameter
	private b = 0.75; // Length normalization parameter
	private avgDocLength = 100; // Assumed average document length

	// Tokenizer instance (lazy loaded)
	private static tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
	private static tokenizerPromise: Promise<
		Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>
	> | null = null;

	/**
	 * Get or initialize the BERT tokenizer.
	 * Uses bert-base-uncased vocabulary (30522 tokens).
	 */
	private async getTokenizer() {
		if (BM25Sparse.tokenizer) {
			return BM25Sparse.tokenizer;
		}
		if (!BM25Sparse.tokenizerPromise) {
			BM25Sparse.tokenizerPromise = AutoTokenizer.from_pretrained("Xenova/bert-base-uncased");
		}
		BM25Sparse.tokenizer = await BM25Sparse.tokenizerPromise;
		return BM25Sparse.tokenizer;
	}

	/**
	 * Tokenize text using BERT tokenizer and return token IDs.
	 * Filters out special tokens ([CLS], [SEP], [PAD]).
	 */
	private async tokenize(text: string): Promise<number[]> {
		const tokenizer = await this.getTokenizer();
		const encoded = tokenizer(text, { add_special_tokens: false });
		// Extract token IDs from tensor
		const inputIds = encoded.input_ids;
		const ids: number[] = [];
		// Handle both tensor and array formats
		if (inputIds.data) {
			for (const id of inputIds.data) {
				ids.push(Number(id));
			}
		} else if (Array.isArray(inputIds)) {
			for (const id of inputIds.flat()) {
				ids.push(Number(id));
			}
		}
		return ids;
	}

	/**
	 * Generate sparse vector from text using BM25-like scoring.
	 * Returns indices (BERT vocabulary token IDs) and values (BM25 weights).
	 */
	async embed(text: string): Promise<{ indices: number[]; values: number[] }> {
		const tokenIds = await this.tokenize(text);
		if (tokenIds.length === 0) {
			return { indices: [], values: [] };
		}

		// Count term frequencies by token ID
		const termFreqs = new Map<number, number>();
		for (const tokenId of tokenIds) {
			termFreqs.set(tokenId, (termFreqs.get(tokenId) || 0) + 1);
		}

		// Calculate BM25-like weights
		const docLength = tokenIds.length;
		const lengthNorm = 1 - this.b + this.b * (docLength / this.avgDocLength);

		const indexValuePairs: Array<[number, number]> = [];

		for (const [tokenId, tf] of termFreqs) {
			// BM25 term frequency component (without IDF since we don't have corpus stats)
			// Using sublinear TF scaling: tf / (tf + k1 * lengthNorm)
			const tfScore = tf / (tf + this.k1 * lengthNorm);

			// Apply log scaling to smooth weights
			const weight = Math.log1p(tfScore * 10);

			indexValuePairs.push([tokenId, weight]);
		}

		// Sort by index for consistent ordering (Qdrant expects sorted indices)
		indexValuePairs.sort((a, b) => a[0] - b[0]);

		return {
			indices: indexValuePairs.map(([idx]) => idx),
			values: indexValuePairs.map(([, val]) => val),
		};
	}
}

export class TextEmbedder {
	private static instance: unknown;
	private static modelName = "Xenova/multilingual-e5-small"; // ONNX quantized version
	private sparseEmbedder = new BM25Sparse();

	static async getInstance() {
		if (!TextEmbedder.instance) {
			TextEmbedder.instance = await pipeline("feature-extraction", TextEmbedder.modelName);
		}
		return TextEmbedder.instance;
	}

	async embed(text: string): Promise<number[]> {
		const extractor = await TextEmbedder.getInstance();
		// Normalize "query: " prefix for e5 models if needed, but for general content we use "passage: "
		// The e5 model expects "query: " for queries and "passage: " for docs.
		// For simplicity, we assume this is "passage" (storage).
		// We should probably expose a method for 'query' vs 'document'.
		const extractFn = extractor as (
			text: string,
			opts: { pooling: string; normalize: boolean },
		) => Promise<{ data: Float32Array }>;
		const output = await extractFn(`passage: ${text}`, { pooling: "mean", normalize: true });
		return Array.from(output.data);
	}

	async embedQuery(text: string): Promise<number[]> {
		const extractor = await TextEmbedder.getInstance();
		const extractFn = extractor as (
			text: string,
			opts: { pooling: string; normalize: boolean },
		) => Promise<{ data: Float32Array }>;
		const output = await extractFn(`query: ${text}`, { pooling: "mean", normalize: true });
		return Array.from(output.data);
	}

	/**
	 * Generate sparse vector using BM25-based term weighting.
	 * Returns indices (BERT vocabulary token IDs) and values (BM25 weights).
	 * Uses proper tokenization for better keyword matching in hybrid search.
	 */
	async embedSparse(text: string): Promise<{ indices: number[]; values: number[] }> {
		return this.sparseEmbedder.embed(text);
	}

	/**
	 * Generate sparse vector for queries.
	 * Currently identical to document embedding, but could be tuned differently.
	 */
	async embedSparseQuery(text: string): Promise<{ indices: number[]; values: number[] }> {
		return this.sparseEmbedder.embed(text);
	}
}
