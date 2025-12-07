# Bead: Create Embedding Batch Processor

## Context
Indexing history or large imports requires batch processing to avoid OOM/RateLimits.

## Goal
Implement a queue-based batch processor.

## Logic
-   **Queue**: In-memory or Redpanda consumer group.
-   **Batch Size**: 32 or 64 items (optimal for embedding models).
-   **Flush**: Generate embeddings for the batch, then `qdrant.upsert`.

## Acceptance Criteria
-   [ ] `BatchIndexer` class.
-   [ ] Configurable batch size/latency.
