# Engram Configuration Defaults

This document provides a comprehensive audit of all configuration parameters in the Engram system, with recommendations grounded in industry best practices and research.

## Table of Contents

- [Configuration Philosophy](#configuration-philosophy)
- [Search Configuration](#search-configuration)
- [Reranker Configuration](#reranker-configuration)
- [Abstention Detection](#abstention-detection)
- [HNSW Index Settings](#hnsw-index-settings)
- [Timeouts](#timeouts)
- [Limits](#limits)
- [Environment Variables Reference](#environment-variables-reference)
- [Recommendations for Production](#recommendations-for-production)

---

## Configuration Philosophy

Engram's configuration follows a three-tier hierarchy:

1. **Hardcoded defaults** - Sensible values for development/testing
2. **Environment variables** - Override defaults for deployment
3. **Runtime configuration** - Hot-reload support for select parameters

### Design Principles

- **Conservative defaults**: Favor precision over recall to reduce noise
- **Fail-safe behavior**: When uncertain, abstain rather than hallucinate
- **Latency budgets**: Reranking tiers have explicit latency bounds
- **Cost awareness**: LLM tier has rate limiting and budget caps

---

## Search Configuration

### Score Thresholds

| Parameter | Default | Env Variable | Recommended Range | Notes |
|-----------|---------|--------------|-------------------|-------|
| `minScore.dense` | **0.75** | `SEARCH_MIN_SCORE_DENSE` | 0.7-0.85 | e5-small cosine similarity; relevant items typically score 0.7-0.9 |
| `minScore.sparse` | **0.1** | `SEARCH_MIN_SCORE_SPARSE` | 0.05-0.2 | BM25/SPLADE scores are unbounded; this is relative |
| `minScore.hybrid` | **0.5** | `SEARCH_MIN_SCORE_HYBRID` | 0.4-0.6 | RRF fusion produces 0-1 normalized scores |
| `retrieval.scoreThreshold` | **0.7** | `RETRIEVAL_SCORE_THRESHOLD` | 0.5-0.8 | General retrieval cutoff |

**Research Grounding:**
- [Qdrant documentation](https://qdrant.tech/documentation/concepts/search/) recommends using `score_threshold` to filter low-quality results
- For semantic search, thresholds between 0.7-0.85 typically provide good precision ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/best-practices))

### Result Limits

| Parameter | Default | Env Variable | Recommended Range |
|-----------|---------|--------------|-------------------|
| `limits.defaultResults` | **10** | `SEARCH_DEFAULT_RESULTS` | 5-20 |
| `limits.maxResults` | **100** | `SEARCH_MAX_RESULTS` | 50-200 |
| `retrieval.defaultLimit` | **10** | `RETRIEVAL_DEFAULT_LIMIT` | 5-20 |
| `retrieval.maxLimit` | **100** | `RETRIEVAL_MAX_LIMIT` | 50-200 |

**Assessment:** Current defaults are aligned with best practices. Research shows [top-10 retrieval](https://docs.llamaindex.ai/en/stable/examples/evaluation/retrieval/retriever_eval/) is sufficient for most RAG applications.

---

## Reranker Configuration

### Global Settings

| Parameter | Default | Env Variable | Recommended Range | Notes |
|-----------|---------|--------------|-------------------|-------|
| `enabled` | **true** | `RERANKER_ENABLED` | - | Reranking improves precision significantly |
| `defaultTier` | **fast** | `RERANKER_DEFAULT_TIER` | fast/accurate | Use "fast" for low-latency, "accurate" for batch |
| `depth` | **30** | `RERANKER_DEPTH` | 20-50 | Candidates to fetch before reranking |
| `timeoutMs` | **500** | `RERANKER_TIMEOUT_MS` | 200-1000 | Falls back to RRF on timeout |

**Research Grounding:**
- Reranking with cross-encoders [consistently improves search quality](https://www.elastic.co/search-labs/blog/elastic-semantic-reranker-part-1)
- Depth of 30 provides good recall while limiting computational cost ([OpenAI Cookbook](https://cookbook.openai.com/examples/search_reranking_with_cross-encoders))

### Tier Configuration

#### Fast Tier (MiniLM)

| Parameter | Default | Env Variable | Notes |
|-----------|---------|--------------|-------|
| `model` | `Xenova/ms-marco-MiniLM-L-6-v2` | `RERANKER_FAST_MODEL` | ~22M params, fastest |
| `maxLatencyMs` | **50** | - | Hardcoded target |
| `batchSize` | **16** | `RERANKER_FAST_BATCH_SIZE` | Optimal for CPU inference |
| `maxCandidates` | **50** | `RERANKER_FAST_MAX_CANDIDATES` | Safe upper bound |

**Research Grounding:**
- MiniLM benchmarks show [~12.3ms per single inference](https://docs.metarank.ai/guides/index/cross-encoders)
- Batch size of 16-32 is optimal for CPU ([sentence-transformers#2482](https://github.com/UKPLab/sentence-transformers/issues/2482))

#### Accurate Tier (BGE)

| Parameter | Default | Env Variable | Notes |
|-----------|---------|--------------|-------|
| `model` | `Xenova/bge-reranker-base` | `RERANKER_ACCURATE_MODEL` | ~110M params |
| `maxLatencyMs` | **150** | - | Hardcoded target |
| `batchSize` | **8** | `RERANKER_ACCURATE_BATCH_SIZE` | Smaller due to larger model |
| `maxCandidates` | **30** | `RERANKER_ACCURATE_MAX_CANDIDATES` | Balance quality/latency |

#### Code Tier (Jina)

| Parameter | Default | Env Variable | Notes |
|-----------|---------|--------------|-------|
| `model` | `jinaai/jina-reranker-v2-base-multilingual` | `RERANKER_CODE_MODEL` | Optimized for code |
| `maxLatencyMs` | **150** | - | Hardcoded target |
| `batchSize` | **8** | `RERANKER_CODE_BATCH_SIZE` | Smaller due to larger model |
| `maxCandidates` | **30** | `RERANKER_CODE_MAX_CANDIDATES` | Balance quality/latency |

#### LLM Tier (Grok)

| Parameter | Default | Env Variable | Notes |
|-----------|---------|--------------|-------|
| `model` | `grok-4-1-fast-reasoning` | `RERANKER_LLM_MODEL` | xAI API |
| `maxLatencyMs` | **2000** | - | External API latency |
| `batchSize` | **1** | - | Always 1 for LLM |
| `maxCandidates` | **10** | `RERANKER_LLM_MAX_CANDIDATES` | Cost optimization |

**Research Grounding:**
- LLM rerankers [outperform cross-encoders on complex queries](https://arxiv.org/html/2403.10407v1)
- Limiting to 10 candidates balances quality with API costs

### Query Routing

| Parameter | Default | Env Variable | Notes |
|-----------|---------|--------------|-------|
| `complexThreshold` | **50** | `RERANKER_COMPLEXITY_THRESHOLD` | Character count for "complex" |
| `codePatternWeight` | **0.8** | `RERANKER_CODE_PATTERN_WEIGHT` | Boost for code-like queries |
| `latencyBudgetDefault` | **500** | `RERANKER_LATENCY_BUDGET` | Max latency in ms |

**Code Detection Patterns:**
```typescript
[
  /\w+\.\w+\(/,        // method calls
  /function\s+\w+/,    // function declarations
  /class\s+\w+/,       // class declarations
  /import\s+/,         // import statements
  /export\s+/,         // export statements
  /const\s+\w+\s*=/,   // variable declarations
  /interface\s+\w+/,   // interface declarations
  /type\s+\w+/,        // type declarations
]
```

---

## Abstention Detection

The abstention system implements a three-layer defense against hallucination.

### Layer 1: Retrieval Confidence

| Parameter | Default | Recommended Range | Notes |
|-----------|---------|-------------------|-------|
| `minRetrievalScore` | **0.3** | 0.2-0.5 | Minimum score to proceed |
| `minScoreGap` | **0.1** | 0.05-0.2 | Gap required between top-2 results |
| `gapDetectionThreshold` | **0.5** | 0.4-0.6 | Score below which gap detection applies |

**Research Grounding:**
- Score gap analysis helps detect uncertain matches ([Qdrant tutorial](https://qdrant.tech/documentation/beginner-tutorials/retrieval-quality/))
- Conservative threshold of 0.3 prevents low-confidence retrieval

### Layer 2: NLI Grounding

| Parameter | Default | Recommended Range | Notes |
|-----------|---------|-------------------|-------|
| `useNLI` | **false** | - | Disabled by default (adds latency) |
| `nliThreshold` | **0.7** | 0.6-0.8 | Neutral score triggering abstention |
| `nliModel` | `Xenova/mobilebert-uncased-mnli` | - | Lightweight NLI model |

**Research Grounding:**
- NLI-based grounding [catches hallucinations](https://arxiv.org/html/2404.10774v1) but has limitations with RLHF-trained models
- Threshold of 0.7 balances false positive/negative rates ([arxiv:2303.16857](https://arxiv.org/html/2303.16857))

**Caveat:** Recent research shows [embedding/NLI methods have limitations](https://arxiv.org/html/2512.15068) with semantically plausible hallucinations. Consider supplementing with reasoning-based verification.

### Layer 3: Hedging Detection

13 regex patterns detect uncertainty phrases:
- "I'm not sure", "I don't know"
- "maybe", "possibly", "perhaps"
- "cannot find/determine/answer"
- "it seems/appears"
- etc.

**Assessment:** Current patterns are comprehensive and well-grounded in linguistic research on hedging markers.

---

## HNSW Index Settings

Engram uses Qdrant's HNSW index for vector search. While these are typically set at collection creation, understanding optimal values is important.

### Recommended Settings for High Recall

| Parameter | Default (Qdrant) | Recommended for High Recall | Notes |
|-----------|------------------|----------------------------|-------|
| `m` | 16 | **24-48** | More connections = better recall |
| `ef_construction` | 100 | **200-400** | Higher = better index quality |
| `ef_search` | 128 | **200-500** | Query-time search depth |

**Research Grounding:**
- [OpenSearch guide](https://opensearch.org/blog/a-practical-guide-to-selecting-hnsw-hyperparameters/): "M=12-48 is ok for most use cases"
- [Pinecone](https://www.pinecone.io/learn/series/faiss/hnsw/): Higher M (24+) works better for high-dimensional data
- ef_construction=400 + M=24 achieves ~98% recall ([hnswlib docs](https://github.com/nmslib/hnswlib/blob/master/ALGO_PARAMS.md))

### Memory vs. Recall Trade-offs

```
Configuration        | Memory  | Recall@10 | Build Time | Query Time
---------------------|---------|-----------|------------|-----------
m=16, ef=100 (low)   | 1x      | ~85%      | Fast       | ~1ms
m=24, ef=200 (mid)   | 1.5x    | ~95%      | Medium     | ~2ms
m=48, ef=400 (high)  | 3x      | ~99%      | Slow       | ~5ms
```

---

## Timeouts

### Graph Database (FalkorDB)

| Timeout | Value | Notes |
|---------|-------|-------|
| `QUERY_MS` | **10,000** | Standard query timeout |
| `TRAVERSAL_MS` | **30,000** | Complex graph traversal |
| `CONNECTION_MS` | **5,000** | Connection attempts |
| `TRANSACTION_MS` | **15,000** | Transaction commits |

### Search Operations

| Timeout | Value | Notes |
|---------|-------|-------|
| `QUERY_MS` | **5,000** | Search query timeout |
| `EMBEDDING_MS` | **30,000** | Embedding generation |
| `RERANK_FAST_MS` | **500** | Fast tier reranking |
| `RERANK_ACCURATE_MS` | **2,000** | Accurate tier reranking |
| `RERANK_LLM_MS` | **10,000** | LLM reranking |

### Tool Execution

| Timeout | Value | Notes |
|---------|-------|-------|
| `EXECUTION_MS` | **60,000** | Default tool execution |
| `MCP_CONNECTION_MS` | **10,000** | MCP server connection |
| `MCP_INVOCATION_MS` | **120,000** | MCP tool invocation |
| `SHELL_EXECUTION_MS` | **300,000** | Shell command (5 min) |

**Assessment:** Current timeouts are reasonable and well-structured.

---

## Limits

### Content Limits

| Limit | Value | Notes |
|-------|-------|-------|
| `MAX_EVENT_CONTENT_BYTES` | **100KB** | Single event content |
| `MAX_THOUGHT_CONTENT_BYTES` | **50KB** | Thought/turn content |
| `MAX_CONTEXT_TOKENS` | **200K** | LLM context window |
| `MAX_FILE_INDEX_BYTES` | **1MB** | Max file for indexing |
| `MAX_BLOB_BYTES` | **10MB** | Maximum blob size |

### Batch Limits

| Limit | Value | Notes |
|-------|-------|-------|
| `DEFAULT_BATCH_SIZE` | **100** | Default batch size |
| `MAX_BATCH_SIZE` | **1,000** | Maximum batch size |
| `EMBEDDING_BATCH_SIZE` | **32** | Embedding generation |
| `RERANK_FAST_BATCH_SIZE` | **16** | Fast reranking |
| `RERANK_ACCURATE_BATCH_SIZE` | **8** | Accurate reranking |

**Research Grounding:**
- Embedding batch size of 32 is optimal for most embedding models
- Reranker batch sizes aligned with [sentence-transformers recommendations](https://github.com/UKPLab/sentence-transformers/issues/2482)

---

## Environment Variables Reference

### Search Configuration

```bash
# Score thresholds
SEARCH_MIN_SCORE_DENSE=0.75
SEARCH_MIN_SCORE_SPARSE=0.1
SEARCH_MIN_SCORE_HYBRID=0.5

# Limits
SEARCH_MAX_RESULTS=100
SEARCH_DEFAULT_RESULTS=10
RETRIEVAL_DEFAULT_LIMIT=10
RETRIEVAL_MAX_LIMIT=100
RETRIEVAL_SCORE_THRESHOLD=0.7

# Cache
SEARCH_CACHE_ENABLED=true
SEARCH_CACHE_TTL=300
```

### Reranker Configuration

```bash
# Global
RERANKER_ENABLED=true
RERANKER_DEFAULT_TIER=fast
RERANKER_DEPTH=30
RERANKER_TIMEOUT_MS=500

# Fast tier
RERANKER_FAST_MODEL=Xenova/ms-marco-MiniLM-L-6-v2
RERANKER_FAST_BATCH_SIZE=16
RERANKER_FAST_MAX_CANDIDATES=50
RERANKER_FAST_ENABLED=true

# Accurate tier
RERANKER_ACCURATE_MODEL=Xenova/bge-reranker-base
RERANKER_ACCURATE_BATCH_SIZE=8
RERANKER_ACCURATE_MAX_CANDIDATES=30
RERANKER_ACCURATE_ENABLED=true

# Code tier
RERANKER_CODE_MODEL=jinaai/jina-reranker-v2-base-multilingual
RERANKER_CODE_BATCH_SIZE=8
RERANKER_CODE_MAX_CANDIDATES=30
RERANKER_CODE_ENABLED=true

# LLM tier
RERANKER_LLM_MODEL=grok-4-1-fast-reasoning
RERANKER_LLM_MAX_CANDIDATES=10
RERANKER_LLM_ENABLED=true
XAI_API_KEY=your-api-key

# Routing
RERANKER_COMPLEXITY_THRESHOLD=50
RERANKER_CODE_PATTERN_WEIGHT=0.8
RERANKER_LATENCY_BUDGET=500

# Cache
RERANKER_CACHE_ENABLED=true
RERANKER_QUERY_CACHE_TTL=300
RERANKER_DOC_CACHE_TTL=3600
RERANKER_MAX_CACHE_SIZE=1073741824  # 1GB
RERANKER_EMBEDDING_CACHE_MAX_SIZE=10000
RERANKER_EMBEDDING_CACHE_TTL_MS=3600000
RERANKER_QUERY_CACHE_TTL_MS=300000

# Rate limiting
RERANKER_RATE_LIMIT_REQUESTS_PER_HOUR=100
RERANKER_RATE_LIMIT_BUDGET=1000
RERANKER_RATE_LIMIT_COST_PER_REQUEST=5

# A/B testing
RERANKER_AB_ENABLED=false
RERANKER_AB_ROLLOUT=100
```

---

## Recommendations for Production

### High-Quality Configuration (Maximize Precision)

```bash
# Higher thresholds = fewer but more relevant results
SEARCH_MIN_SCORE_DENSE=0.80
SEARCH_MIN_SCORE_HYBRID=0.55
RETRIEVAL_SCORE_THRESHOLD=0.75

# Use accurate reranker by default
RERANKER_DEFAULT_TIER=accurate
RERANKER_DEPTH=50
RERANKER_TIMEOUT_MS=1000

# Enable NLI grounding (adds ~100-200ms latency)
# Configure via AbstentionConfig in code
```

### Low-Latency Configuration (Maximize Speed)

```bash
# Lower thresholds = faster, more results
SEARCH_MIN_SCORE_DENSE=0.70
SEARCH_MIN_SCORE_HYBRID=0.45

# Fast reranker with smaller window
RERANKER_DEFAULT_TIER=fast
RERANKER_DEPTH=20
RERANKER_TIMEOUT_MS=300
RERANKER_FAST_MAX_CANDIDATES=30
```

### Cost-Conscious Configuration

```bash
# Disable LLM tier
RERANKER_LLM_ENABLED=false

# Or limit LLM usage
RERANKER_RATE_LIMIT_REQUESTS_PER_HOUR=50
RERANKER_RATE_LIMIT_BUDGET=500
```

---

## Sources

- [Qdrant Search Documentation](https://qdrant.tech/documentation/concepts/search/)
- [OpenSearch HNSW Guide](https://opensearch.org/blog/a-practical-guide-to-selecting-hnsw-hyperparameters/)
- [Pinecone HNSW Explained](https://www.pinecone.io/learn/series/faiss/hnsw/)
- [Elasticsearch Semantic Reranking](https://www.elastic.co/search-labs/blog/elastic-semantic-reranker-part-1)
- [OpenAI Cookbook: Cross-Encoder Reranking](https://cookbook.openai.com/examples/search_reranking_with_cross-encoders)
- [MiniCheck: Fact-Checking LLMs](https://arxiv.org/html/2404.10774v1)
- [LlamaIndex Retrieval Evaluation](https://docs.llamaindex.ai/en/stable/examples/evaluation/retrieval/retriever_eval/)
- [RAGAS Evaluation Framework](https://docs.ragas.io/en/stable/)
- [hnswlib Algorithm Parameters](https://github.com/nmslib/hnswlib/blob/master/ALGO_PARAMS.md)
