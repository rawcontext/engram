# Bead: Develop Node Merging Logic

## Context
Sometimes two nodes (e.g., "Person A" and "Person B") turn out to be the same entity.

## Goal
Implement a `mergeEntities` function.

## Logic
1.  Create `(:SAME_AS)` edge between them.
2.  Or, create a new `SuperNode` and redirect edges.
3.  *Decision*: Use `(:SAME_AS)` edges for resolution during query time (Search Service responsibility), rather than destructively merging nodes in Memory.

## Acceptance Criteria
-   [ ] `SAME_AS` edge schema defined.
-   [ ] Logic to crawl `SAME_AS` edges during retrieval.
