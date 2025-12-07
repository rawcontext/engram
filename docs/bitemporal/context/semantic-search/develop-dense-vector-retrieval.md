# Bead: Develop Dense Vector Retrieval

## Context
Execute the Dense part of the search.

## Goal
Wrapper around `qdrant.search({ vector_name: 'dense' })`.

## Acceptance Criteria
-   [ ] `DenseRetriever` class.
-   [ ] Maps `SearchQuery` filters to Qdrant filter DSL.
