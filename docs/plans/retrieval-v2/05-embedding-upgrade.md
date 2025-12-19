# P5: Embedding Model Upgrade

## Problem Statement

Engram currently uses **E5-small (384d)** for dense embeddings. While fast, it limits retrieval quality. Larger models consistently outperform on MTEB benchmarks.

Current state:
- E5-small: 59.9 MTEB average
- Running on CPU (MacBook)
- ~10 docs/sec embedding speed

## Expected Impact

- **Overall Accuracy**: +2-3%
- **Retrieval Recall**: +5-10%
- **Tradeoff**: Slower inference (mitigated by GPU)

## Model Comparison

Based on [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) and research:

### Open Source Models

| Model | MTEB Avg | Retrieval | Dims | Size | License |
|:------|:--------:|:---------:|:----:|:----:|:--------|
| E5-small | 59.9 | 49.0 | 384 | 33M | MIT |
| E5-base | 61.5 | 50.3 | 768 | 110M | MIT |
| E5-large | 62.3 | 52.0 | 1024 | 335M | MIT |
| GTE-base | 62.4 | 51.1 | 768 | 110M | MIT |
| GTE-large | 63.1 | 52.2 | 1024 | 335M | MIT |
| Stella-base | 64.2 | 53.5 | 768 | 110M | MIT |
| [NV-Embed-v2](https://developer.nvidia.com/blog/nvidia-text-embedding-model-tops-mteb-leaderboard/) | 72.3 | 60.9 | 4096 | 7B | CC-BY-NC |

### Commercial APIs

| Provider | Model | Retrieval | Dims | Price |
|:---------|:------|:---------:|:----:|:------|
| OpenAI | text-embedding-3-large | 54.9 | 3072 | $0.13/1M |
| [Voyage](https://blog.voyageai.com/2024/05/05/voyage-large-2-instruct-instruction-tuned-and-rank-1-on-mteb/) | voyage-3-large | ~58 | 1024 | $0.06/1M |
| Cohere | embed-v3 | 55.0 | 1024 | $0.10/1M |

## Recommended Upgrade Path

### Phase 1: GTE-large (Immediate)

Best balance of quality and practicality:
- +4 MTEB points over E5-small
- Same inference framework (transformers.js)
- MIT license (commercial OK)

```typescript
// packages/search-core/src/embedders/text.ts

export class TextEmbedder {
  private model: string;

  constructor(model: string = "Xenova/gte-large") {
    this.model = model;
  }
}
```

### Phase 2: NV-Embed-v2 (With GPU)

For maximum quality when GPU available:
- +12 MTEB points over E5-small
- Requires CUDA
- 4096 dimensions (larger index)

```typescript
export class NVEmbedder {
  private client: InferenceClient;

  constructor() {
    // Use NVIDIA Inference API or local GPU
    this.client = new InferenceClient({
      model: "nvidia/NV-Embed-v2",
      device: "cuda",
    });
  }
}
```

### Phase 3: Hybrid API + Local

For cost-effective quality:
- Use Voyage API for queries (fast, high quality)
- Use local model for document embedding (batch, cheaper)

## Implementation

### Configuration-Based Model Selection

```typescript
// packages/search-core/src/embedders/factory.ts

export type EmbeddingModel =
  | "e5-small"
  | "e5-base"
  | "e5-large"
  | "gte-base"
  | "gte-large"
  | "stella-base"
  | "nv-embed-v2"
  | "voyage-3"
  | "openai-3-large";

export interface EmbedderConfig {
  model: EmbeddingModel;
  device?: "cpu" | "cuda";
  apiKey?: string;
}

const MODEL_CONFIGS: Record<EmbeddingModel, ModelConfig> = {
  "e5-small": {
    hfModel: "Xenova/e5-small-v2",
    dimensions: 384,
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  "gte-large": {
    hfModel: "Xenova/gte-large",
    dimensions: 1024,
    queryPrefix: "",
    passagePrefix: "",
  },
  "nv-embed-v2": {
    hfModel: "nvidia/NV-Embed-v2",
    dimensions: 4096,
    queryPrefix: "Instruct: Retrieve relevant passages\nQuery: ",
    passagePrefix: "",
    requiresGPU: true,
  },
  // ... other models
};

export function createEmbedder(config: EmbedderConfig): TextEmbedder {
  const modelConfig = MODEL_CONFIGS[config.model];

  if (modelConfig.requiresGPU && config.device !== "cuda") {
    console.warn(`${config.model} requires GPU, falling back to gte-large`);
    return createEmbedder({ ...config, model: "gte-large" });
  }

  if (config.model === "voyage-3" || config.model === "openai-3-large") {
    return new APIEmbedder(config);
  }

  return new LocalEmbedder(modelConfig, config.device);
}
```

### CLI Integration

```typescript
// packages/benchmark/src/cli/index.ts

.option("--embedding-model <model>",
  "Embedding model: e5-small, gte-large, nv-embed-v2, voyage-3",
  "e5-small")
.option("--embedding-device <device>",
  "Device for local models: cpu, cuda",
  "cpu")
```

### Collection Migration

When upgrading embedding model, need to re-embed:

```typescript
// packages/search-core/src/migration.ts

export async function migrateCollection(
  client: QdrantClient,
  oldCollection: string,
  newCollection: string,
  newEmbedder: TextEmbedder
): Promise<void> {
  // 1. Create new collection with new dimensions
  await client.createCollection(newCollection, {
    vectors: {
      dense: {
        size: newEmbedder.dimensions,
        distance: "Cosine",
      },
    },
  });

  // 2. Scroll through old collection
  let offset: string | null = null;
  const batchSize = 100;

  do {
    const results = await client.scroll(oldCollection, {
      limit: batchSize,
      offset,
      with_payload: true,
    });

    // 3. Re-embed and upsert
    const texts = results.points.map(p => p.payload!.content as string);
    const embeddings = await newEmbedder.embed(texts);

    await client.upsert(newCollection, {
      points: results.points.map((p, i) => ({
        id: p.id,
        vector: { dense: embeddings[i] },
        payload: p.payload,
      })),
    });

    offset = results.next_page_offset ?? null;
  } while (offset);

  console.log(`Migrated ${oldCollection} to ${newCollection}`);
}
```

## GPU Deployment Options

### Local GPU (NVIDIA)

```bash
# Install CUDA version of onnxruntime
pip install onnxruntime-gpu

# Or use transformers with CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### Cloud Options

| Provider | GPU | Cost/hr | Best For |
|:---------|:----|:--------|:---------|
| Lambda Labs | A10 | $0.75 | Development |
| RunPod | A100 | $1.99 | Large batches |
| Modal | A10G | $0.000463/sec | Serverless |
| Replicate | A40 | $0.00115/sec | API deployment |

### Modal Deployment Example

```typescript
// Deploy embedding service on Modal
import modal

app = modal.App("engram-embeddings")

@app.function(gpu="A10G", image=modal.Image.debian_slim().pip_install("sentence-transformers"))
def embed_batch(texts: list[str]) -> list[list[float]]:
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("nvidia/NV-Embed-v2")
    return model.encode(texts).tolist()
```

## Benchmark Comparison

Run ablation study to validate upgrade:

```bash
# Baseline with E5-small
npx tsx src/cli/index.ts run longmemeval \
  --dataset data/longmemeval_oracle.json \
  --embeddings engram \
  --embedding-model e5-small \
  --limit 100 \
  --output results/e5-small.jsonl

# Upgraded with GTE-large
npx tsx src/cli/index.ts run longmemeval \
  --dataset data/longmemeval_oracle.json \
  --embeddings engram \
  --embedding-model gte-large \
  --limit 100 \
  --output results/gte-large.jsonl

# Compare
npx tsx src/cli/index.ts compare results/e5-small.jsonl results/gte-large.jsonl
```

## Success Metrics

- Retrieval Recall@10: +5-10%
- Overall accuracy: +2-3%
- Latency (with GPU): <100ms per query

## References

- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [NV-Embed-v2 Blog](https://developer.nvidia.com/blog/nvidia-text-embedding-model-tops-mteb-leaderboard/)
- [Voyage AI Models](https://blog.voyageai.com/2024/05/05/voyage-large-2-instruct-instruction-tuned-and-rank-1-on-mteb/)
- [Modal Embedding Guide](https://modal.com/blog/mteb-leaderboard-article)
- [Choosing Embedding Models (Pinecone)](https://www.pinecone.io/learn/series/rag/embedding-models-rundown/)
