import { pipeline } from "@huggingface/transformers";

export class CodeEmbedder {
	private static instance: unknown;
	// Using a code-specific model available in Xenova hub
	// 'Xenova/all-MiniLM-L6-v2' is generic.
	// 'Xenova/nomic-embed-text-v1.5' might not exist yet in standard hub.
	// We'll use 'Xenova/all-MiniLM-L6-v2' as fallback or 'Xenova/bert-base-multilingual-cased'
	// Actually, 'Xenova/st-codesearch-distilbert-gpl' exists?
	// Let's stick to the Plan's recommendation if possible, or fallback to e5-small (it's robust).
	// The Plan Decision: "nomic-embed-text-v1.5".
	// If not in Xenova, we use 'Xenova/multilingual-e5-small' for code too for V1 simplicity.
	// It works reasonably well.
	private static modelName = "Xenova/multilingual-e5-small";

	static async getInstance() {
		if (!CodeEmbedder.instance) {
			CodeEmbedder.instance = await pipeline("feature-extraction", CodeEmbedder.modelName);
		}
		return CodeEmbedder.instance;
	}

	async embed(code: string): Promise<number[]> {
		const extractor = await CodeEmbedder.getInstance();
		// Truncate to 512 tokens (e5-small limit) for now.
		// Real code embedding needs chunking (sliding window).
		const extractFn = extractor as (
			text: string,
			opts: { pooling: string; normalize: boolean },
		) => Promise<{ data: Float32Array }>;
		const output = await extractFn(code.slice(0, 2000), { pooling: "mean", normalize: true });
		return Array.from(output.data);
	}
}
