# @engram/search

Full semantic search stack with embeddings, reranking, and retrieval.

## Overview

Comprehensive search engine with multi-stage retrieval, hybrid search (dense + sparse via SPLADE), caching, and performance optimization. Integrates with Qdrant for vector storage.

## Installation

```bash
npm install @engram/search
```

## Core Components

### Embedders

```typescript
import {
  TextEmbedder,
  CodeEmbedder,
  ColbertEmbedder,
  SpladeEmbedder,
} from "@engram/search";

const embedder = new TextEmbedder({ model: "e5-small" });
const embedding = await embedder.embed("query text");
```

### Retrieval

```typescript
import { SearchRetriever, SessionRetriever } from "@engram/search";

const retriever = new SearchRetriever({
  qdrantUrl: "http://localhost:6333",
  collection: "engram",
});

const results = await retriever.search({
  query: "how to implement auth",
  topK: 10,
});
```

### Reranking

```typescript
import { Reranker, RerankerRouter } from "@engram/search";

const reranker = new Reranker({ tier: "accurate" });
const reranked = await reranker.rerank(query, documents);

// Or use the router for automatic tier selection
const router = new RerankerRouter();
const results = await router.rerank(query, documents, { tier: "auto" });
```

### Hybrid Search

```typescript
import { MultiQueryRetriever, LearnedFusion } from "@engram/search";

// Multi-query with fusion
const retriever = new MultiQueryRetriever({
  dense: denseRetriever,
  sparse: sparseRetriever,
  fusion: new LearnedFusion(),
});
```

## Reranker Tiers

| Tier | Model | Latency | Use Case |
|:-----|:------|:--------|:---------|
| `fast` | MiniLM-L-6-v2 | ~50ms | Quick lookups |
| `accurate` | BGE-reranker-base | ~150ms | Complex queries |
| `code` | Jina-reranker-v2 | ~150ms | Code search |
| `colbert` | ColBERT-v2 | ~200ms | Token-level matching |

## Caching

```typescript
import { QueryCache, EmbeddingCache } from "@engram/search";

const queryCache = new QueryCache({ ttl: 3600 });
const embeddingCache = new EmbeddingCache({ maxSize: 10000 });
```

## Analysis & Metrics

```typescript
import { QueryClassifier, RerankMetrics, CacheMetrics } from "@engram/search";

const classifier = new QueryClassifier();
const features = classifier.classify(query);
// { isCode: true, hasTemporal: false, complexity: "medium" }
```

## Configuration

```typescript
import { SearchConfig } from "@engram/search";

const config: SearchConfig = {
  qdrantUrl: "http://localhost:6333",
  collection: "engram",
  embeddingModel: "e5-small",
  hybridSearch: true,
  rerank: true,
  rerankTier: "accurate",
  rerankDepth: 30,
};
```
