# Reranker Implementation Plan for Engram

> **Scope**: Billion-scale neural reranking for The Swarm
> **Status**: Draft v1.0
> **Date**: December 2025

---

## Executive Summary

This plan outlines a multi-phase reranker implementation for Engram's hybrid search pipeline. The goal is to maximize relevance precision while maintaining sub-200ms latency at billion-event scale. We propose a **tiered reranking architecture** that leverages existing infrastructure (transformers.js, ONNX) while providing a clear path to distributed inference.

---

## 1. Current Architecture Analysis

### 1.1 Existing Search Pipeline

```
Query → QueryClassifier → Strategy Selection
                              ↓
                    ┌─────────┴─────────┐
                    │                   │
              TextEmbedder        SpladeEmbedder
              (e5-small 384d)     (SPLADE 30k sparse)
                    │                   │
                    └─────────┬─────────┘
                              ↓
                        Qdrant Hybrid
                    (RRF Fusion: Dense + Sparse)
                              ↓
                      Raw Results (Top-K)
                              ↓
                    [RERANKING STAGE] ← NEW
                              ↓
                      Final Results
```

### 1.2 Existing Reranker (Not Integrated)

**File**: `packages/search-core/src/services/reranker.ts`
- Model: `Xenova/bge-reranker-base` (cross-encoder)
- Quantization: INT8 (q8)
- Processing: Sequential (no batching)
- Status: Implemented but **not wired into SearchRetriever**

### 1.3 Current Bottlenecks

| Issue | Impact | Severity |
|-------|--------|----------|
| Sequential document scoring | O(n) latency per query | High |
| No document caching | Redundant embedding | Medium |
| Single reranker model | No query-type optimization | Medium |
| Not integrated | Zero benefit currently | Critical |

---

## 2. Reranking Strategy Comparison

### 2.1 Approach Analysis

| Approach | Latency | Accuracy | Scalability | Implementation |
|----------|---------|----------|-------------|----------------|
| **Cross-Encoder** | 50-200ms | High | Limited by compute | Existing |
| **ColBERT (Late Interaction)** | 10-50ms | High | Excellent (precompute) | New |
| **LLM Listwise** | 500ms-3s | Highest | Poor (API costs) | Future |
| **Hybrid Cascade** | Variable | Highest | Good | Recommended |

### 2.2 Model Recommendations

Based on research from [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2025/06/top-rerankers-for-rag/), [Jina AI](https://jina.ai/reranker/), and [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):

**Tier 1: Fast Cross-Encoder (Default)**
- `Xenova/ms-marco-MiniLM-L-6-v2` - 22M params, fastest
- Use case: All queries, < 50ms target

**Tier 2: Accurate Cross-Encoder (Complex Queries)**
- `Xenova/bge-reranker-base` - 278M params (current)
- `jinaai/jina-reranker-v2-base-multilingual` - 278M, multilingual + code
- Use case: Agentic queries, code search

**Tier 3: Late Interaction (Scale Path)**
- `jinaai/jina-colbert-v2` - 559M, multilingual
- Use case: Billion-scale with precomputed doc representations

**Tier 4: LLM Listwise (Premium)**
- Claude Haiku / GPT-4o-mini via API
- Use case: High-stakes queries, < 10 candidates

---

## 3. Proposed Architecture

### 3.1 Tiered Reranking Pipeline

```
Qdrant Hybrid Results (Top-50)
            ↓
    ┌───────┴───────┐
    │  Fast Filter  │  ← Remove obvious mismatches (score < threshold)
    └───────┬───────┘
            ↓
      Candidates (Top-30)
            ↓
    ┌───────┴───────┐
    │ Query Router  │  ← Classify: simple | complex | code | agentic
    └───────┬───────┘
            ↓
   ┌────────┼────────┐
   │        │        │
 Simple  Complex   Code
   ↓        ↓        ↓
MiniLM   BGE     Jina-v2
(Tier 1) (Tier 2) (Tier 2)
   │        │        │
   └────────┼────────┘
            ↓
      Top-10 Results
            ↓
   ┌────────┴────────┐ (Optional: Premium queries only)
   │  LLM Listwise   │
   └────────┬────────┘
            ↓
      Final Top-K
```

### 3.2 Component Design

#### 3.2.1 RerankerRouter

```typescript
// packages/search-core/src/services/reranker-router.ts

export type RerankerTier = "fast" | "accurate" | "code" | "llm";

export interface RerankerRoutingResult {
  tier: RerankerTier;
  reranker: string;
  maxCandidates: number;
  reason: string;
}

export class RerankerRouter {
  /**
   * Routes queries to appropriate reranker tier based on:
   * - Query complexity (length, operators)
   * - Content type filter (code vs text)
   * - User tier/subscription
   * - Latency budget
   */
  route(query: string, options: RoutingOptions): RerankerRoutingResult;
}
```

#### 3.2.2 BatchedReranker

```typescript
// packages/search-core/src/services/batched-reranker.ts

export interface BatchedRerankerOptions {
  model: string;
  maxBatchSize: number;        // Default: 16
  maxConcurrency: number;      // Default: 4
  quantization: "fp16" | "q8"; // Default: q8
  cacheEnabled: boolean;       // Document representation caching
}

export class BatchedReranker {
  /**
   * Processes documents in parallel batches for efficiency.
   * Key optimizations:
   * - Dynamic batching based on document length
   * - Concurrent batch processing
   * - Query-document pair caching (LRU)
   */
  async rerank(
    query: string,
    documents: DocumentCandidate[],
    topK: number
  ): Promise<RerankResult[]>;
}
```

#### 3.2.3 ColBERTReranker (Late Interaction)

```typescript
// packages/search-core/src/services/colbert-reranker.ts

export class ColBERTReranker {
  /**
   * Uses late interaction for efficient reranking.
   * Document token embeddings can be precomputed and cached.
   * MaxSim scoring at query time.
   */

  // Precompute document representations (offline)
  async encodeDocument(content: string): Promise<Float32Array[]>;

  // Store in Qdrant multivector field
  async indexDocumentEmbeddings(docId: string, embeddings: Float32Array[]): Promise<void>;

  // Fast query-time scoring
  async rerank(
    query: string,
    candidates: CachedDocumentCandidate[],
    topK: number
  ): Promise<RerankResult[]>;
}
```

#### 3.2.4 LLMListwiseReranker

```typescript
// packages/search-core/src/services/llm-reranker.ts

export interface LLMRerankerOptions {
  model: "claude-haiku" | "gpt-4o-mini";
  maxCandidates: number;  // Max 10 for context efficiency
  systemPrompt?: string;  // Custom ranking instructions
}

export class LLMListwiseReranker {
  /**
   * Uses LLM for listwise comparison ranking.
   * Reserved for high-value queries.
   *
   * Advantages over pointwise:
   * - Sees all candidates in context
   * - Can make relative comparisons
   * - Better for complex reasoning queries
   */
  async rerank(
    query: string,
    candidates: DocumentCandidate[],
    topK: number
  ): Promise<RerankResult[]>;
}
```

---

## 4. Integration with SearchRetriever

### 4.1 Updated Retriever Flow

```typescript
// packages/search-core/src/services/retriever.ts (modified)

export interface SearchOptions {
  // Existing
  limit?: number;
  filters?: SearchFilters;
  strategy?: SearchStrategy;

  // New: Reranking control
  rerank?: boolean;              // Default: true
  rerankTier?: RerankerTier;     // Default: auto-routed
  rerankDepth?: number;          // How many to fetch for reranking
}

async search(query: SearchQuery): Promise<SearchResult[]> {
  // 1. Query classification (existing)
  const classification = this.classifier.classify(query.text);

  // 2. Hybrid retrieval (existing) - OVERSAMPLE
  const rerankDepth = query.rerankDepth ?? 30;
  const rawResults = await this.hybridSearch(query.text, rerankDepth, filters);

  // 3. NEW: Reranking stage
  if (query.rerank !== false) {
    const tier = query.rerankTier ?? this.router.route(query.text, { classification });
    const reranker = this.getReranker(tier);

    const reranked = await reranker.rerank(
      query.text,
      rawResults.map(r => r.payload.content),
      query.limit ?? 10
    );

    return this.mergeScores(rawResults, reranked);
  }

  return rawResults.slice(0, query.limit);
}
```

### 4.2 Score Merging Strategy

```typescript
interface MergedResult {
  // Original RRF score from Qdrant
  rrfScore: number;

  // Cross-encoder relevance score (0-1)
  rerankerScore: number;

  // Final combined score
  // Option A: Replace with reranker score
  // Option B: Weighted combination
  // Option C: Rank-based (use reranker ordering, show RRF for UI)
  finalScore: number;
}
```

**Recommendation**: Use **Option C** - The reranker determines final ordering, but preserve both scores in the response for transparency and debugging.

---

## 5. Scaling for Billions of Events

### 5.1 The Scale Challenge

At 1B+ indexed events:
- Qdrant hybrid search: ~10-50ms (already optimized via HNSW + sparse indices)
- Cross-encoder reranking: 30 docs × 10ms = 300ms (unacceptable)

### 5.2 Scaling Strategies

#### Strategy 1: Aggressive Filtering Before Reranking

```typescript
// Only rerank candidates above RRF threshold
const candidates = rawResults.filter(r => r.score > 0.3);

// Dynamic depth based on query confidence
const depth = classification.confidence > 0.8 ? 20 : 30;
```

#### Strategy 2: ColBERT Precomputation

Based on [Qdrant's ColBERT integration](https://qdrant.tech/documentation/fastembed/fastembed-colbert/):

```typescript
// At index time (SearchIndexer)
async indexNode(node: IndexableNode) {
  // Existing dense/sparse vectors
  const textVector = await this.textEmbedder.embed(content);
  const sparseVector = await this.textEmbedder.embedSparse(content);

  // NEW: ColBERT token embeddings for late interaction
  const colbertEmbeddings = await this.colbertEmbedder.encode(content);

  await this.client.upsert(this.collectionName, {
    points: [{
      id: node.id,
      vector: {
        text_dense: textVector,
        sparse: sparseVector,
        colbert: colbertEmbeddings, // Multivector field
      },
      payload,
    }],
  });
}
```

Qdrant's native multivector support enables MaxSim scoring without loading documents.

#### Strategy 3: Distributed Inference (Future)

For 10K+ QPS requirements:
- **Triton Inference Server** with dynamic batching
- **TensorRT** optimization for GPU inference
- **Model sharding** across GPU cluster

Reference: [Microsoft's ONNX Runtime optimization](https://opensource.microsoft.com/blog/2021/06/30/journey-to-optimize-large-scale-transformer-model-inference-with-onnx-runtime/)

### 5.3 Caching Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Cache Layers                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  L1: Query Result Cache (Redis)                     │
│      - Key: hash(query + filters + limit)           │
│      - TTL: 5 minutes                               │
│      - Hit rate target: 30%+                        │
│                                                      │
│  L2: Document Representation Cache (In-Memory)      │
│      - ColBERT token embeddings per doc_id          │
│      - LRU eviction, 1GB budget                     │
│      - Eliminates re-encoding for recent docs       │
│                                                      │
│  L3: Model Warm Cache (Singleton)                   │
│      - Keep transformer models loaded               │
│      - Existing pattern in Reranker class           │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## 6. Implementation Phases

### Phase 1: Integration (Week 1-2)

**Goal**: Wire existing BGE reranker into SearchRetriever

Tasks:
- [ ] Add `rerank` option to `SearchQuery` interface
- [ ] Integrate `Reranker.rerank()` call in `SearchRetriever.search()`
- [ ] Add `rerankerScore` field to search result payload
- [ ] Update API response schema
- [ ] Integration tests with existing hybrid search tests

**Deliverables**:
- Working end-to-end reranking
- Baseline latency measurements
- Quality comparison (RRF-only vs RRF+rerank)

### Phase 2: Optimization (Week 3-4)

**Goal**: Batch processing and multiple reranker tiers

Tasks:
- [ ] Implement `BatchedReranker` with parallel processing
- [ ] Add `ms-marco-MiniLM-L-6-v2` as fast tier
- [ ] Implement `RerankerRouter` for query-based model selection
- [ ] Add reranker latency metrics/tracing
- [ ] Optimize for < 100ms P95 latency

**Deliverables**:
- 2-3x latency improvement via batching
- Query-adaptive reranker selection
- Observability dashboard

### Phase 3: ColBERT Integration (Week 5-6)

**Goal**: Late interaction for scale efficiency

Tasks:
- [ ] Implement `ColBERTEmbedder` using `jinaai/jina-colbert-v2`
- [ ] Add `colbert` multivector field to Qdrant schema
- [ ] Update `SearchIndexer` to generate ColBERT representations
- [ ] Implement `ColBERTReranker` with MaxSim scoring
- [ ] Schema migration for existing data

**Deliverables**:
- ColBERT-based reranking option
- Precomputed representations in Qdrant
- 5-10x reranking speedup for cached docs

### Phase 4: LLM Reranking (Week 7-8)

**Goal**: Premium listwise reranking for complex queries

Tasks:
- [ ] Implement `LLMListwiseReranker`
- [ ] Design prompt templates for ranking
- [ ] Add query complexity detection to router
- [ ] Rate limiting and cost tracking
- [ ] A/B testing framework

**Deliverables**:
- LLM reranking for premium tier
- Cost attribution per query
- Quality uplift metrics

### Phase 5: Scale Preparation (Week 9+)

**Goal**: Production hardening for billion-scale

Tasks:
- [ ] Document representation caching (Redis/in-memory)
- [ ] Query result caching
- [ ] Async reranking option (return RRF, refine async)
- [ ] Distributed inference evaluation (Triton)
- [ ] Load testing at 1K QPS

**Deliverables**:
- Production-ready reranking
- < 200ms P99 latency
- Linear scale path documented

---

## 7. Schema Updates

### 7.1 Qdrant Collection Schema (Updated)

```typescript
// packages/search-core/src/services/schema-manager.ts

const COLLECTION_CONFIG = {
  vectors: {
    text_dense: { size: 384, distance: "Cosine" },
    code_dense: { size: 768, distance: "Cosine" },
    // NEW: ColBERT multivector for late interaction
    colbert: {
      size: 128,  // Jina ColBERT v2 token dim
      distance: "Cosine",
      multivector_config: {
        comparator: "max_sim"  // MaxSim for late interaction
      }
    },
  },
  sparse_vectors: {
    sparse: { index: { on_disk: false } },
  },
};
```

### 7.2 Search Result Schema (Updated)

```typescript
// packages/search-core/src/models/schema.ts

export interface SearchResult {
  id: string;

  // Scores
  rrfScore: number;           // Original hybrid fusion score
  rerankerScore?: number;     // Cross-encoder/ColBERT score
  rerankTier?: RerankerTier;  // Which reranker was used

  // Existing
  payload: SearchResultPayload;
}
```

### 7.3 API Response (Updated)

```typescript
// apps/interface/app/api/search/route.ts

interface SearchAPIResponse {
  success: boolean;
  data: {
    results: SearchResult[];
    meta: {
      query: string;
      strategy: SearchStrategy;
      reranker?: {
        tier: RerankerTier;
        model: string;
        latencyMs: number;
      };
      totalLatencyMs: number;
    };
  };
}
```

---

## 8. UI Updates

### 8.1 Score Display Enhancement

The current UI shows "RRF" score. After reranking:

```typescript
// apps/interface/app/components/SearchResults.tsx

function ScoreBar({ result }: { result: SearchResult }) {
  const hasRerank = result.rerankerScore !== undefined;

  return (
    <div>
      {hasRerank ? (
        <>
          <span title="Cross-encoder relevance score">REL</span>
          <Bar score={result.rerankerScore} />
          <span>{Math.round(result.rerankerScore * 100)}%</span>
        </>
      ) : (
        <>
          <span title="Reciprocal Rank Fusion score">RRF</span>
          <Bar score={result.rrfScore} />
          <span>{Math.round(result.rrfScore * 100)}%</span>
        </>
      )}
    </div>
  );
}
```

### 8.2 Reranking Indicator

Add visual indicator when results have been reranked:

```typescript
// In SearchResults header
{meta?.reranker && (
  <span className="rerank-badge" title={`Reranked by ${meta.reranker.model}`}>
    RERANKED ({meta.reranker.latencyMs}ms)
  </span>
)}
```

---

## 9. Configuration

### 9.1 Environment Variables

```bash
# Reranking configuration
RERANK_ENABLED=true
RERANK_DEFAULT_TIER=fast
RERANK_DEPTH=30
RERANK_TIMEOUT_MS=500

# Model paths (for custom/local models)
RERANK_MODEL_FAST=Xenova/ms-marco-MiniLM-L-6-v2
RERANK_MODEL_ACCURATE=Xenova/bge-reranker-base
RERANK_MODEL_CODE=jinaai/jina-reranker-v2-base-multilingual
RERANK_MODEL_COLBERT=jinaai/jina-colbert-v2

# LLM reranking (premium)
LLM_RERANK_ENABLED=false
LLM_RERANK_MODEL=claude-haiku
LLM_RERANK_MAX_CANDIDATES=10
```

### 9.2 Runtime Configuration

```typescript
// packages/search-core/src/config.ts

export const RERANK_CONFIG = {
  enabled: true,
  defaultTier: "fast" as RerankerTier,

  tiers: {
    fast: {
      model: "Xenova/ms-marco-MiniLM-L-6-v2",
      maxLatencyMs: 50,
      batchSize: 16,
    },
    accurate: {
      model: "Xenova/bge-reranker-base",
      maxLatencyMs: 150,
      batchSize: 8,
    },
    code: {
      model: "jinaai/jina-reranker-v2-base-multilingual",
      maxLatencyMs: 150,
      batchSize: 8,
    },
    llm: {
      model: "claude-haiku",
      maxLatencyMs: 2000,
      maxCandidates: 10,
    },
  },

  routing: {
    // Queries with code patterns → code tier
    codePatterns: [/\w+\.\w+\(/, /function\s+\w+/, /class\s+\w+/],
    // Long/complex queries → accurate tier
    complexThreshold: 50, // characters
    // Agentic queries (tool mentions) → accurate tier
    agenticPatterns: [/tool|function|call|execute/i],
  },

  cache: {
    queryResultTTL: 300,      // 5 minutes
    documentRepresentationTTL: 3600, // 1 hour
    maxCacheSize: 1024 * 1024 * 1024, // 1GB
  },
};
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// packages/search-core/src/services/__tests__/batched-reranker.test.ts

describe("BatchedReranker", () => {
  it("should batch documents correctly", async () => {
    const reranker = new BatchedReranker({ maxBatchSize: 4 });
    const docs = Array(10).fill("test document");

    const results = await reranker.rerank("test query", docs, 5);

    expect(results).toHaveLength(5);
    // Verify batching occurred (mock check)
  });

  it("should respect latency budget", async () => {
    const start = Date.now();
    await reranker.rerank("query", docs, 5);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
```

### 10.2 Integration Tests

```typescript
// packages/search-core/src/services/__tests__/reranker.integration.test.ts

describe("Reranker Integration", () => {
  it("should improve relevance for exact match queries", async () => {
    // Index test documents
    await indexTestDocuments([
      "The quick brown fox",
      "Authentication using JWT tokens",
      "AuthGuard implementation in NestJS",
    ]);

    // Search without reranking
    const rrfResults = await retriever.search({
      text: "AuthGuard",
      rerank: false
    });

    // Search with reranking
    const rerankResults = await retriever.search({
      text: "AuthGuard",
      rerank: true
    });

    // Exact match should rank higher with reranking
    expect(rerankResults[0].payload.content).toContain("AuthGuard");
  });
});
```

### 10.3 Quality Evaluation

```typescript
// scripts/evaluate-reranker.ts

/**
 * Evaluate reranker quality using held-out test set.
 * Metrics: NDCG@10, MRR, MAP
 */
async function evaluateReranker() {
  const testQueries = await loadTestQueries();

  const metrics = {
    rrfOnly: { ndcg: 0, mrr: 0 },
    withRerank: { ndcg: 0, mrr: 0 },
  };

  for (const { query, relevantDocs } of testQueries) {
    const rrfResults = await search(query, { rerank: false });
    const rerankResults = await search(query, { rerank: true });

    metrics.rrfOnly.ndcg += ndcg(rrfResults, relevantDocs, 10);
    metrics.withRerank.ndcg += ndcg(rerankResults, relevantDocs, 10);
  }

  console.log("Quality improvement:",
    (metrics.withRerank.ndcg - metrics.rrfOnly.ndcg) / metrics.rrfOnly.ndcg
  );
}
```

---

## 11. Observability

### 11.1 Metrics

```typescript
// Prometheus metrics for reranking
const rerankLatency = new Histogram({
  name: 'search_rerank_latency_ms',
  help: 'Reranking latency in milliseconds',
  labelNames: ['tier', 'model'],
  buckets: [10, 25, 50, 100, 200, 500, 1000],
});

const rerankCandidates = new Histogram({
  name: 'search_rerank_candidates',
  help: 'Number of candidates sent to reranker',
  labelNames: ['tier'],
  buckets: [5, 10, 20, 30, 50, 100],
});

const rerankScoreImprovement = new Histogram({
  name: 'search_rerank_score_delta',
  help: 'Score improvement from reranking (top result)',
  buckets: [0, 0.1, 0.2, 0.3, 0.5, 1.0],
});
```

### 11.2 Logging

```typescript
logger.info({
  event: "search_rerank",
  query: hashQuery(query),
  tier: selectedTier,
  model: rerankerModel,
  inputCandidates: candidates.length,
  outputResults: results.length,
  latencyMs: elapsed,
  topScoreDelta: results[0].rerankerScore - results[0].rrfScore,
});
```

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Latency regression | Circuit breaker: fall back to RRF if rerank > 500ms |
| Model loading OOM | Lazy loading, model unloading after idle |
| Quality degradation | A/B testing, gradual rollout |
| Cost explosion (LLM) | Hard rate limits, query budget per user |
| Cache invalidation | TTL-based, invalidate on document update |

---

## 13. Success Metrics

### 13.1 Quality

- **NDCG@10 improvement**: Target +15% over RRF-only
- **MRR improvement**: Target +20% for exact match queries
- **User satisfaction**: Search result click-through rate

### 13.2 Performance

- **P50 latency**: < 100ms (with reranking)
- **P99 latency**: < 200ms (with reranking)
- **Throughput**: 1000 QPS at 30-doc rerank depth

### 13.3 Operational

- **Cache hit rate**: > 30% for query cache
- **Error rate**: < 0.1% reranker failures
- **Availability**: 99.9% (with fallback to RRF)

---

## 14. References

### Research

- [A Thorough Comparison of Cross-Encoders and LLMs for Reranking SPLADE](https://arxiv.org/abs/2403.10407)
- [ColBERT: Efficient and Effective Passage Search](https://github.com/stanford-futuredata/ColBERT)
- [Jina Reranker v3: Last but Not Late Interaction](https://arxiv.org/html/2509.25085v2)
- [ListConRanker: Contrastive Text Reranker with Listwise Encoding](https://arxiv.org/html/2501.07111v1)

### Implementation Guides

- [Qdrant: Reranking in Semantic Search](https://qdrant.tech/documentation/search-precision/reranking-semantic-search/)
- [Qdrant: Working with ColBERT](https://qdrant.tech/documentation/fastembed/fastembed-colbert/)
- [Pinecone: Rerankers and Two-Stage Retrieval](https://www.pinecone.io/learn/series/rag/rerankers/)
- [Sentence Transformers: Cross-Encoder Usage](https://sbert.net/docs/cross_encoder/usage/efficiency.html)

### Libraries

- [Transformers.js](https://github.com/huggingface/transformers.js) - Client-side inference
- [RAGatouille](https://github.com/AnswerDotAI/RAGatouille) - ColBERT wrapper
- [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) - BGE models

### Benchmarks

- [The Best Rerankers (2025)](https://medium.com/@markshipman4273/the-best-rerankers-24d9582c3495)
- [10 Rerankers Under 150ms](https://medium.com/@ThinkingLoop/10-rerankers-under-150-ms-splade-colbert-friends-076b1928e618)
- [Should You Use LLMs for Reranking?](https://www.zeroentropy.dev/articles/should-you-use-llms-for-reranking-a-deep-dive-into-pointwise-listwise-and-cross-encoders)

---

## Appendix A: Model Comparison Matrix

| Model | Params | Latency (30 docs) | BEIR NDCG@10 | Languages | License |
|-------|--------|-------------------|--------------|-----------|---------|
| ms-marco-MiniLM-L-6-v2 | 22M | ~30ms | 52.1 | EN | Apache 2.0 |
| bge-reranker-base | 278M | ~100ms | 56.5 | EN | MIT |
| bge-reranker-v2-m3 | 568M | ~150ms | 56.5 | 100+ | MIT |
| jina-reranker-v2 | 278M | ~80ms | 57.2 | 100+ | CC-BY-NC |
| jina-reranker-v3 | 600M | ~120ms | 61.9 | 100+ | CC-BY-NC |
| jina-colbert-v2 | 559M | ~20ms* | 55.8 | 89 | CC-BY-NC |

*With precomputed document representations

---

## Appendix B: Query Routing Heuristics

```typescript
function classifyQueryComplexity(query: string): "simple" | "moderate" | "complex" {
  const features = {
    length: query.length,
    words: query.split(/\s+/).length,
    hasQuotes: /"[^"]+"/.test(query),
    hasOperators: /AND|OR|NOT|\+|-/.test(query),
    hasCode: /[a-zA-Z]+\.[a-zA-Z]+\(|function\s|class\s|=>/.test(query),
    questionWords: /^(what|how|why|when|where|who|which)/i.test(query),
  };

  let score = 0;
  if (features.length > 50) score += 2;
  if (features.words > 8) score += 1;
  if (features.hasQuotes) score += 1;
  if (features.hasOperators) score += 2;
  if (features.hasCode) score += 2;
  if (features.questionWords) score += 1;

  if (score >= 4) return "complex";
  if (score >= 2) return "moderate";
  return "simple";
}
```

---

*Document authored by Claude Code | December 2025*
