# Bead: Develop Semantic Deduplication Logic

## Context
Users often repeat themselves. We don't want 10 copies of "Hello" in the index.

## Goal
Prevent indexing duplicates.

## Logic
1.  Before Upsert, `qdrant.search(content_vector)`.
2.  If `top_score > 0.98` (near identical), skip indexing or merge metadata.
3.  *Optimization*: Use `content_hash` (SHA256) check in Memory (FalkorDB) first. Only vector search if hash differs but content might be semantically identical (rare for exact logging, common for ideas).
4.  *Decision*: Rely on **Content Hash** in `ThoughtNode` for strict dedupe. Semantic dedupe is too risky (false positives).

## Acceptance Criteria
-   [ ] Document strategy: Strict Hash Dedupe in Memory Layer, Search Layer just reflects Memory.
