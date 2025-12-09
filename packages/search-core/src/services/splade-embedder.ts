import { AutoTokenizer, AutoModel, type Tensor } from "@huggingface/transformers";

/**
 * SPLADE sparse embedder using ONNX model.
 * Generates learned sparse representations for hybrid search.
 *
 * SPLADE (Sparse Lexical and Expansion Model) learns to expand queries/documents
 * with semantically related terms while producing sparse vectors compatible with
 * inverted index retrieval.
 */
export class SpladeEmbedder {
	// Model configuration
	private static readonly MODEL_NAME = "sparse-encoder-testing/splade-bert-tiny-nq-onnx";
	private static readonly VOCAB_SIZE = 30522; // BERT vocabulary size

	// Singleton instances (lazy loaded)
	private static model: Awaited<ReturnType<typeof AutoModel.from_pretrained>> | null = null;
	private static tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null =
		null;
	private static modelPromise: Promise<
		Awaited<ReturnType<typeof AutoModel.from_pretrained>>
	> | null = null;
	private static tokenizerPromise: Promise<
		Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>
	> | null = null;

	/**
	 * Get or initialize the ONNX model.
	 * Uses singleton pattern with lazy initialization for efficiency.
	 */
	private async getModel() {
		if (SpladeEmbedder.model) {
			return SpladeEmbedder.model;
		}
		if (!SpladeEmbedder.modelPromise) {
			SpladeEmbedder.modelPromise = AutoModel.from_pretrained(SpladeEmbedder.MODEL_NAME, {
				dtype: "fp32",
			});
		}
		SpladeEmbedder.model = await SpladeEmbedder.modelPromise;
		return SpladeEmbedder.model;
	}

	/**
	 * Get or initialize the tokenizer.
	 */
	private async getTokenizer() {
		if (SpladeEmbedder.tokenizer) {
			return SpladeEmbedder.tokenizer;
		}
		if (!SpladeEmbedder.tokenizerPromise) {
			SpladeEmbedder.tokenizerPromise = AutoTokenizer.from_pretrained(
				SpladeEmbedder.MODEL_NAME,
			);
		}
		SpladeEmbedder.tokenizer = await SpladeEmbedder.tokenizerPromise;
		return SpladeEmbedder.tokenizer;
	}

	/**
	 * Apply SPLADE pooling to MLM logits.
	 * SPLADE pooling: max(log(1 + ReLU(logits)), dim=1)
	 *
	 * This produces sparse vectors where each dimension corresponds to a
	 * vocabulary token, with non-zero values indicating term importance.
	 *
	 * @param logits - MLM logits tensor of shape [batch, seq_len, vocab_size]
	 * @param attentionMask - Attention mask tensor of shape [batch, seq_len]
	 * @returns Sparse vector as {indices, values} for Qdrant
	 */
	private spladePooling(
		logits: Tensor,
		attentionMask: Tensor,
	): { indices: number[]; values: number[] } {
		// Get dimensions
		const logitsData = logits.data as Float32Array;
		const maskData = attentionMask.data as BigInt64Array | Float32Array | Int32Array;
		const [batchSize, seqLen, vocabSize] = logits.dims as [number, number, number];

		// We only handle batch size 1 for now
		if (batchSize !== 1) {
			throw new Error("SpladeEmbedder only supports batch size 1");
		}

		// Apply ReLU + log1p and max pool across sequence dimension
		const pooled = new Float32Array(vocabSize);
		pooled.fill(-Infinity);

		for (let pos = 0; pos < seqLen; pos++) {
			// Skip masked positions
			if (Number(maskData[pos]) === 0) continue;

			const offset = pos * vocabSize;
			for (let v = 0; v < vocabSize; v++) {
				// ReLU: max(0, x)
				const relu = Math.max(0, logitsData[offset + v]);
				// log1p: log(1 + x)
				const value = Math.log1p(relu);
				// Max pooling across sequence
				pooled[v] = Math.max(pooled[v], value);
			}
		}

		// Convert to sparse format - only keep non-zero values
		const indexValuePairs: Array<[number, number]> = [];
		const threshold = 1e-6; // Small threshold to filter out near-zero values

		for (let v = 0; v < vocabSize; v++) {
			const value = pooled[v];
			if (value > threshold && Number.isFinite(value)) {
				indexValuePairs.push([v, value]);
			}
		}

		// Sort by index for consistent ordering (Qdrant expects sorted indices)
		indexValuePairs.sort((a, b) => a[0] - b[0]);

		return {
			indices: indexValuePairs.map(([idx]) => idx),
			values: indexValuePairs.map(([, val]) => val),
		};
	}

	/**
	 * Generate sparse embedding for text using SPLADE.
	 * Returns indices (vocabulary token IDs) and values (term importance weights).
	 *
	 * @param text - Input text to embed
	 * @returns Sparse vector in Qdrant format
	 */
	async embed(text: string): Promise<{ indices: number[]; values: number[] }> {
		const [model, tokenizer] = await Promise.all([this.getModel(), this.getTokenizer()]);

		// Tokenize input
		const encoded = tokenizer(text, {
			padding: true,
			truncation: true,
			max_length: 512,
			return_tensors: "pt",
		});

		// Run model inference to get MLM logits
		const output = await (model as (inputs: unknown) => Promise<{ logits: Tensor }>)(encoded);

		// Apply SPLADE pooling
		return this.spladePooling(output.logits, encoded.attention_mask);
	}

	/**
	 * Generate sparse embedding for a query.
	 * Currently identical to document embedding, but could be tuned differently
	 * (e.g., with query-specific prefix or different pooling).
	 *
	 * @param text - Query text to embed
	 * @returns Sparse vector in Qdrant format
	 */
	async embedQuery(text: string): Promise<{ indices: number[]; values: number[] }> {
		return this.embed(text);
	}

	/**
	 * Check if the model is loaded and ready.
	 */
	isReady(): boolean {
		return SpladeEmbedder.model !== null && SpladeEmbedder.tokenizer !== null;
	}

	/**
	 * Preload the model and tokenizer.
	 * Call this at startup to warm up the model cache.
	 */
	async preload(): Promise<void> {
		await Promise.all([this.getModel(), this.getTokenizer()]);
	}
}
