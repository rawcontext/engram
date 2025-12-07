# Bead: Implement Vector Upsert Logic

## Context
The **Semantic Search** service maintains an index of the knowledge graph. To ensure consistency and access to stable IDs, indexing must occur **downstream of Memory persistence**. 

Search is a consumer of "Node Created" events emitted by the Memory Service, ensuring that every vector point corresponds to a valid, committed Graph Node ID (FalkorDB ID).

## Goal
Implement `SearchIndexer.index(committedNode)`.

## Logic
1.  **Trigger**: Listen for `memory.node_created` events (via Redpanda) from the Memory Service.
2.  **Extract Text**: Get `content` from `ThoughtNode` or `patch_content` from `DiffHunkNode`.
3.  **Generate Vectors**: Call `TextEmbedder.embed()` and `TextEmbedder.embedSparse()`.
4.  **Construct Payload**: Map metadata (including the authoritative `node_id`).
5.  **Upsert**: `qdrantClient.upsert(...)`.

## Acceptance Criteria
-   [ ] Indexer service implemented.
-   [ ] Explicitly consumes `node_created` events, NOT raw ingestion events.
-   [ ] Handles batching (upserting 100 points is faster than 1 by 1).
