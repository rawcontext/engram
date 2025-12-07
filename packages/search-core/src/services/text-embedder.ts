import { pipeline } from "@huggingface/transformers";

export class TextEmbedder {
  private static instance: unknown;
  private static modelName = "Xenova/multilingual-e5-small"; // ONNX quantized version

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
    // @ts-expect-error
    const output = await extractor(`passage: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  async embedQuery(text: string): Promise<number[]> {
    const extractor = await TextEmbedder.getInstance();
    // @ts-expect-error
    const output = await extractor(`query: ${text}`, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  // SPLADE or BM25 sparse embedding would go here.
  // Transformers.js supports some sparse models but it's complex.
  // For V1 we might skip Sparse in the Embedder class and rely on Qdrant's internal (if available) or simple BM25 lib.
  // The plan said "Implement Text Embedding Service... embedSparse".
  // We'll leave sparse as a TODO/Mock for now or use a simple tokenizer-based TF-IDF.
  async embedSparse(_text: string): Promise<{ indices: number[]; values: number[] }> {
    // Stub for Sparse Logic
    return { indices: [], values: [] };
  }
}
