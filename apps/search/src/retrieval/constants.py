"""Configuration constants for the retrieval module.

This module defines default values and thresholds used throughout the
retrieval pipeline, including score thresholds, timeouts, and field names.
"""

# Minimum similarity score thresholds for different search strategies
MIN_SCORE_DENSE = 0.75
"""Minimum score threshold for dense vector search.

Dense search uses semantic embeddings and typically produces higher scores
for relevant results. This higher threshold filters out less relevant matches.
"""

MIN_SCORE_SPARSE = 0.1
"""Minimum score threshold for sparse vector search.

Sparse search (SPLADE) uses keyword-based embeddings and produces lower
absolute scores. This lower threshold accommodates the scoring distribution.
"""

MIN_SCORE_HYBRID = 0.5
"""Minimum score threshold for hybrid search.

Hybrid search combines dense and sparse scores using Reciprocal Rank Fusion.
This intermediate threshold balances precision and recall.
"""

# Reranking configuration
DEFAULT_RERANK_DEPTH = 30
"""Default number of results to retrieve for reranking.

Reranking is applied to the top N results before filtering to the final limit.
This allows the reranker to re-order candidates for better precision.
"""

RERANK_TIMEOUT_MS = 500
"""Default timeout for reranking in milliseconds.

Rerankers have varying latencies:
- Fast (FlashRank): ~10ms
- Accurate (Cross-encoder): ~50ms
- ColBERT: ~30ms
- LLM: ~500ms

This timeout protects against slow rerankers while allowing LLM tier to complete.
"""

# Reciprocal Rank Fusion (RRF) constant
RRF_K = 60
"""RRF constant for hybrid search fusion.

The RRF formula is: score = 1 / (k + rank)

A higher k value reduces the impact of rank differences, making the fusion
more conservative. The default of 60 is a common choice that balances
dense and sparse contributions.

See: https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
"""

# Qdrant vector field names
TEXT_DENSE_FIELD = "text_dense"
"""Qdrant vector field name for dense text embeddings.

Used for semantic search on conversational text and documentation.
Model: BAAI/bge-base-en-v1.5 (768 dimensions)
"""

CODE_DENSE_FIELD = "code_dense"
"""Qdrant vector field name for dense code embeddings.

Used for semantic search on code snippets and technical content.
Model: nomic-ai/nomic-embed-text-v1.5 (768 dimensions)
"""

SPARSE_FIELD = "text_sparse"
"""Qdrant sparse vector field name for SPLADE embeddings.

Used for keyword-based search with learned sparse representations.
Model: naver/splade-cocondenser-ensembledistil
"""

# Turn collection vector field names (engram_turns)
TURN_DENSE_FIELD = "turn_dense"
"""Qdrant vector field name for turn-level dense embeddings.

Used for semantic search on complete conversation turns.
Model: BAAI/bge-small-en-v1.5 (384 dimensions)
"""

TURN_SPARSE_FIELD = "turn_sparse"
"""Qdrant sparse vector field name for turn-level SPLADE embeddings.

Used for keyword-based search on complete conversation turns.
Model: naver/splade-cocondenser-ensembledistil
"""

TURN_COLBERT_FIELD = "turn_colbert"
"""Qdrant multi-vector field name for turn-level ColBERT embeddings.

Used for late-interaction search on complete conversation turns.
Model: colbert-ir/colbertv2.0 (128 dimensions per token)
"""
