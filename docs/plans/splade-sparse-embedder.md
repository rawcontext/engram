# SPLADE Sparse Embedder Implementation Plan

## Overview

Replace the current BM25-based sparse embedding with a learned SPLADE model for better semantic retrieval.

**Current State:**
- `BM25Sparse` class in `packages/search-core/src/services/text-embedder.ts`
- Uses BERT tokenizer + BM25-like term frequency scoring
- No IDF weighting (treats all terms equally)
- No learned term expansion (misses synonyms/related terms)

**Target State:**
- `SpladeEmbedder` class using pre-converted ONNX model
- Learned sparse representations via MLM head
- Query/document expansion (adds semantically related terms)
- Better synonym and vocabulary mismatch handling

---

## Part 1: Model Selection

### 1.1 Recommended Model

| Property | Value |
|----------|-------|
| Model | `sparse-encoder-testing/splade-bert-tiny-nq-onnx` |
| Parameters | 4.42M (tiny, fast for JS) |
| Output Dimensions | 30,522 (BERT vocabulary) |
| Architecture | MLMTransformer + SpladePooling(max, relu) |
| License | Apache 2.0 |
| Performance | NanoBEIR Mean NDCG@10 = 0.2627 |

### 1.2 Alternative Models (if needed)

| Model | Size | Trade-off |
|-------|------|-----------|
| `andersonbcdefg/distilbert-splade-onnx` | 66.4M | Better quality, slower |
| `castorini/splade-v3-onnx` | ~110M | Best quality, largest |

---

## Part 2: Architecture

### 2.1 SPLADE Pooling Algorithm

The SPLADE model outputs MLM logits that need post-processing:

```typescript
/**
 * SPLADE pooling: max pooling over sequence + ReLU + log(1+x) scaling.
 *
 * Input: MLM logits [seqLen, vocabSize]
 * Output: Sparse vector { indices: number[], values: number[] }
 */
function spladePooling(
  mlmLogits: Float32Array,
  seqLen: number,
  vocabSize: number
): { indices: number[]; values: number[] } {
  const sparse = new Float32Array(vocabSize);

  // Max pooling over sequence length
  for (let v = 0; v < vocabSize; v++) {
    let maxVal = -Infinity;
    for (let s = 0; s < seqLen; s++) {
      const logit = mlmLogits[s * vocabSize + v];
      maxVal = Math.max(maxVal, logit);
    }
    // ReLU + log(1 + x) for SPLADE scoring
    sparse[v] = maxVal > 0 ? Math.log1p(maxVal) : 0;
  }

  // Extract non-zero indices and values
  const indices: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < vocabSize; i++) {
    if (sparse[i] > 0) {
      indices.push(i);
      values.push(sparse[i]);
    }
  }

  return { indices, values };
}
```

### 2.2 Class Interface

```typescript
// packages/search-core/src/services/splade-embedder.ts

import * as ort from "onnxruntime-node";
import { AutoTokenizer } from "@huggingface/transformers";

export interface SparseVector {
  indices: number[];
  values: number[];
}

export class SpladeEmbedder {
  private static session: ort.InferenceSession | null = null;
  private static tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
  private static modelPath = "sparse-encoder-testing/splade-bert-tiny-nq-onnx";

  /**
   * Embed document for storage.
   */
  async embed(text: string): Promise<SparseVector>;

  /**
   * Embed query for search.
   * Note: SPLADE often uses different weights for queries vs documents.
   */
  async embedQuery(text: string): Promise<SparseVector>;

  /**
   * Batch embed multiple texts.
   */
  async embedBatch(texts: string[]): Promise<SparseVector[]>;
}
```

### 2.3 Integration Points

```
TextEmbedder (existing)
├── embed() → Dense vector (e5-small)
├── embedQuery() → Dense vector (e5-small)
├── embedSparse() → calls SpladeEmbedder.embed()  [CHANGE]
└── embedSparseQuery() → calls SpladeEmbedder.embedQuery()  [CHANGE]
```

---

## Part 3: Implementation Steps

### Step 1: Download and Cache Model

```typescript
// packages/search-core/src/services/splade-embedder.ts

import { env } from "@huggingface/transformers";
import * as ort from "onnxruntime-node";
import { existsSync } from "fs";
import { join } from "path";

// Configure cache directory
env.cacheDir = process.env.HF_CACHE_DIR || "./.cache/huggingface";

async function downloadModel(): Promise<string> {
  const modelId = "sparse-encoder-testing/splade-bert-tiny-nq-onnx";
  const modelPath = join(env.cacheDir, "models", modelId, "model.onnx");

  if (!existsSync(modelPath)) {
    // Use huggingface_hub to download
    // Or fetch directly from HF URL
  }

  return modelPath;
}
```

### Step 2: ONNX Runtime Session

```typescript
private async getSession(): Promise<ort.InferenceSession> {
  if (SpladeEmbedder.session) {
    return SpladeEmbedder.session;
  }

  const modelPath = await downloadModel();

  SpladeEmbedder.session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"], // or "cuda" if available
    graphOptimizationLevel: "all",
  });

  return SpladeEmbedder.session;
}
```

### Step 3: Inference Pipeline

```typescript
async embed(text: string): Promise<SparseVector> {
  const [session, tokenizer] = await Promise.all([
    this.getSession(),
    this.getTokenizer(),
  ]);

  // Tokenize
  const encoded = tokenizer(text, {
    padding: true,
    truncation: true,
    max_length: 512,
    return_tensors: "pt",
  });

  // Create ONNX tensors
  const inputIds = new ort.Tensor("int64", encoded.input_ids.data, encoded.input_ids.dims);
  const attentionMask = new ort.Tensor("int64", encoded.attention_mask.data, encoded.attention_mask.dims);

  // Run inference
  const outputs = await session.run({
    input_ids: inputIds,
    attention_mask: attentionMask,
  });

  // Get MLM logits
  const logits = outputs.logits || outputs.last_hidden_state;
  const seqLen = encoded.input_ids.dims[1];
  const vocabSize = 30522;

  // Apply SPLADE pooling
  return spladePooling(logits.data as Float32Array, seqLen, vocabSize);
}
```

### Step 4: Update TextEmbedder

```typescript
// packages/search-core/src/services/text-embedder.ts

import { SpladeEmbedder } from "./splade-embedder";

export class TextEmbedder {
  // Replace BM25Sparse with SpladeEmbedder
  private sparseEmbedder = new SpladeEmbedder();

  // Keep existing dense embedding methods unchanged
  // ...

  async embedSparse(text: string): Promise<{ indices: number[]; values: number[] }> {
    return this.sparseEmbedder.embed(text);
  }

  async embedSparseQuery(text: string): Promise<{ indices: number[]; values: number[] }> {
    return this.sparseEmbedder.embedQuery(text);
  }
}
```

---

## Part 4: Testing & Benchmarking

### 4.1 Unit Tests

```typescript
// packages/search-core/src/services/splade-embedder.test.ts

describe("SpladeEmbedder", () => {
  it("should generate sparse vectors with indices and values", async () => {
    const embedder = new SpladeEmbedder();
    const sparse = await embedder.embed("machine learning is great");

    expect(sparse.indices).toBeInstanceOf(Array);
    expect(sparse.values).toBeInstanceOf(Array);
    expect(sparse.indices.length).toBeGreaterThan(0);
    expect(sparse.indices.length).toBeLessThan(1000); // Sparse!
  });

  it("should expand query terms semantically", async () => {
    const embedder = new SpladeEmbedder();
    const sparse = await embedder.embedQuery("ML");

    // Should include related terms like "machine", "learning"
    // (after decoding token IDs)
    expect(sparse.indices.length).toBeGreaterThan(1);
  });

  it("should handle empty input", async () => {
    const embedder = new SpladeEmbedder();
    const sparse = await embedder.embed("");
    expect(sparse).toEqual({ indices: [], values: [] });
  });
});
```

### 4.2 Benchmark Script

```typescript
// scripts/benchmark-sparse-embedders.ts

import { TextEmbedder } from "@engram/search-core";
import { BM25Sparse } from "./bm25-sparse"; // Keep old impl for comparison

const testQueries = [
  "how to implement authentication",
  "react hooks tutorial",
  "typescript generics explained",
  // ... more test queries
];

async function benchmark() {
  const bm25 = new BM25Sparse();
  const splade = new SpladeEmbedder();

  console.log("=== Latency Comparison ===");

  // BM25 benchmark
  const bm25Start = Date.now();
  for (const q of testQueries) await bm25.embed(q);
  console.log(`BM25: ${Date.now() - bm25Start}ms`);

  // SPLADE benchmark
  const spladeStart = Date.now();
  for (const q of testQueries) await splade.embed(q);
  console.log(`SPLADE: ${Date.now() - spladeStart}ms`);

  console.log("\n=== Sparsity Comparison ===");
  const bm25Sparse = await bm25.embed(testQueries[0]);
  const spladeeSparse = await splade.embed(testQueries[0]);
  console.log(`BM25 non-zero: ${bm25Sparse.indices.length}`);
  console.log(`SPLADE non-zero: ${spladeeSparse.indices.length}`);
}
```

### 4.3 Qdrant Integration Test

```typescript
// Test hybrid search with SPLADE sparse vectors
describe("Qdrant Hybrid Search", () => {
  it("should return results using SPLADE sparse vectors", async () => {
    const embedder = new TextEmbedder();

    // Index document
    const doc = "TypeScript is a typed superset of JavaScript";
    const dense = await embedder.embed(doc);
    const sparse = await embedder.embedSparse(doc);

    await qdrant.upsert("test", {
      points: [{
        id: "doc1",
        vector: {
          dense: dense,
          sparse: { indices: sparse.indices, values: sparse.values },
        },
        payload: { text: doc },
      }],
    });

    // Query with synonym
    const query = "JS typing system"; // Not exact match!
    const queryDense = await embedder.embedQuery(query);
    const querySparse = await embedder.embedSparseQuery(query);

    const results = await qdrant.search("test", {
      vector: {
        dense: queryDense,
        sparse: { indices: querySparse.indices, values: querySparse.values },
      },
    });

    expect(results[0].id).toBe("doc1");
  });
});
```

---

## Part 5: Dependencies

### 5.1 New Packages

```bash
bun add onnxruntime-node
# or for web: bun add onnxruntime-web
```

### 5.2 Package Updates

```json
// packages/search-core/package.json
{
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "onnxruntime-node": "^1.19.0"
  }
}
```

---

## Part 6: Rollout Plan

### Phase 1: Implementation (Day 1)
- [ ] Create `SpladeEmbedder` class with model loading
- [ ] Implement SPLADE pooling algorithm
- [ ] Add unit tests for new embedder
- [ ] Keep BM25Sparse as fallback

### Phase 2: Integration (Day 1-2)
- [ ] Update `TextEmbedder` to use `SpladeEmbedder`
- [ ] Run benchmark comparison
- [ ] Test Qdrant hybrid search integration
- [ ] Document any API changes

### Phase 3: Validation (Day 2)
- [ ] Test on real search queries
- [ ] Verify retrieval quality improvement
- [ ] Profile memory/CPU usage
- [ ] Update search-core documentation

### Phase 4: Cleanup
- [ ] Remove or deprecate BM25Sparse class
- [ ] Update sparse-embedding-evaluation.md with results
- [ ] Close implementation bead

---

## Part 7: Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Model download size (4MB) | Cache in `.cache/huggingface`, lazy load |
| ONNX runtime memory | Use single session instance |
| Inference latency | Batch embeddings where possible |
| Token limit (512) | Truncate with warning log |
| Model accuracy | Benchmark against BM25 first |

---

## Part 8: Success Criteria

1. **Latency**: Embedding time < 100ms per query
2. **Sparsity**: < 500 non-zero dimensions per embedding (avg)
3. **Quality**: Subjective improvement on synonym queries
4. **Tests**: All existing tests pass, new tests added

---

## Appendix: Reference Links

- [splade-bert-tiny-nq-onnx](https://huggingface.co/sparse-encoder-testing/splade-bert-tiny-nq-onnx)
- [ONNX Runtime Node.js](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
- [Sentence Transformers Sparse Encoder](https://sbert.net/examples/sparse_encoder/)
- [Qdrant Sparse Vectors](https://qdrant.tech/documentation/concepts/vectors/#sparse-vectors)
- [SPLADE Paper](https://arxiv.org/abs/2107.05720)
