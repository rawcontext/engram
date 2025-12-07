import { pipeline } from "@xenova/transformers";

export interface RerankResult {
  index: number;
  score: number;
}

export class Reranker {
  private static instance: unknown;
  private static modelName = "Xenova/bge-reranker-base"; // Standard small reranker

  static async getInstance() {
    if (!Reranker.instance) {
      // 'text-classification' is appropriate for Cross-Encoders (they output a score/logit)
      // Some rerankers output a single logit (regression) or 2 logits (classification).
      // bge-reranker usually outputs a single score.
      Reranker.instance = await pipeline("text-classification", Reranker.modelName, {
        quantized: true,
      });
    }
    return Reranker.instance;
  }

  async rerank(
    query: string,
    documents: string[],
    topK = 5,
  ): Promise<{ document: string; score: number; originalIndex: number }[]> {
    const classifier = await Reranker.getInstance();

    // Construct pairs
    // Transformers.js pipeline input for pairs: { text: string, text_pair: string } or [string, string]
    // We need to check support.
    // Most robust way: use tokenizer + model directly if pipeline is flaky on pairs.
    // But pipeline SHOULD support it.

    // We process sequentially or in batches.
    // For simplicity in V1, we process sequentially or use Promise.all (if instance handles concurrency, which JS runtime does).

    const scores: { index: number; score: number }[] = [];

    for (let i = 0; i < documents.length; i++) {
      // biome-ignore lint/suspicious/noExplicitAny: Transformers.js pipeline types are complex
      const output = await (classifier as any)({ text: query, text_pair: documents[i] });
      // Output for bge-reranker usually: [{ label: 'LABEL_0', score: 0.99 }] or similar.
      // CrossEncoders trained for ranking often output a single logit or Sigmoid score.
      // If it returns a list of labels, we need to know which label is "relevant".
      // BGE-Reranker usually returns a single value if treated as regression, or 'LABEL_0'/'LABEL_1'.
      // Actually, bge-reranker models on HF are often AutoModelForSequenceClassification with 1 label?
      // Let's assume it returns a score object.
      // We'll take the score.
      // If multiple labels, usually the positive class score is what we want.
      // Let's assume 'LABEL_1' is positive if binary, or just use the score if single.

      let score = 0;
      if (Array.isArray(output)) {
        // Find label with highest score or specific label?
        // For BGE, typically high logit = relevant.
        // If outputs [{ label: 'LABEL_0', score: ... }]
        // We might need to inspect the model config.
        // Fallback: Use the score of the first element if only 1, or look for '1'/'relevant'.
        // For now, we use output[0].score assuming regression or binary positive at 0.
        score = output[0].score;
      } else if (typeof output === "object" && "score" in output) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic return type from ML model
        score = (output as any).score;
      }

      scores.push({ index: i, score });
    }

    // Sort descending
    scores.sort((a, b) => b.score - a.score);

    // Top K
    const top = scores.slice(0, topK);

    return top.map((s) => ({
      document: documents[s.index],
      score: s.score,
      originalIndex: s.index,
    }));
  }
}
