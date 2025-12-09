import { pipeline } from "@huggingface/transformers";
import { SpladeEmbedder } from "./splade-embedder";

export class TextEmbedder {
	private static instance: unknown;
	private static modelName = "Xenova/multilingual-e5-small"; // ONNX quantized version
	private sparseEmbedder = new SpladeEmbedder();

	static async getInstance() {
		if (!TextEmbedder.instance) {
			TextEmbedder.instance = await pipeline("feature-extraction", TextEmbedder.modelName);
		}
		return TextEmbedder.instance;
	}

	async embed(text: string): Promise<number[]> {
		const extractor = await TextEmbedder.getInstance();
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
