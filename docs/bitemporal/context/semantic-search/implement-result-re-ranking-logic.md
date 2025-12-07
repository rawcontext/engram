# Bead: Implement Result Re-ranking Logic

## Context
Merging Dense and Sparse results (RRF) is good, but a Cross-Encoder Reranker provides the best precision.

## Goal
Implement a `Reranker` class.

## Strategy
-   **Model**: `BAAI/bge-reranker-v2-m3` (or `jina-reranker-tiny` for speed).
-   **Process**:
    1.  Get top 50 results from Qdrant (Hybrid Fusion).
    2.  Pass `(query, document)` pairs to Reranker.
    3.  Sort by new score.
    4.  Return top 10.

## Acceptance Criteria
-   [ ] `Reranker` service using `xenova/transformers` or `fast-embed`.
-   [ ] Integration test: Retrieve -> Rerank -> Verify order improvement.
