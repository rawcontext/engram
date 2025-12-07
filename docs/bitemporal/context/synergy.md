# Synergy Report: Bitemporal System Plan

## Status: Discrepancies Found

After a meticulous review of the ~100 bead definitions across the 7 bounded contexts, the following synergy gaps and missing definitions were identified. These must be resolved to ensure the system functions as a cohesive unit.

### 1. Missing `SnapshotNode` Schema (Critical)
*   **Context**: `bitemporal-memory` vs `deterministic-execution`.
*   **Issue**: The **Execution Service**'s `Rehydrator` relies on querying a `SnapshotNode` to reconstruct the Virtual File System state efficiently. However, no `define-snapshot-node-schema.md` exists in the **Bitemporal Memory** context.
*   **Impact**: Time-travel and Replay functionality will fail or be incredibly slow (replaying from genesis) without snapshots.
*   **Fix**: Create `docs/bitemporal/context/bitemporal-memory/define-snapshot-node-schema.md`.

### 2. Event Role Ambiguity
*   **Context**: `cognitive-ingestion` vs `bitemporal-memory`.
*   **Issue**: The `ParsedStreamEventSchema` (Ingestion) extracts content and thought but does not explicitly enforce a `role` field (user/assistant/system). The downstream `ThoughtNode` (Memory) *requires* a `role`.
*   **Impact**: Memory service won't know who "said" the content.
*   **Fix**: Update `docs/bitemporal/context/cognitive-ingestion/define-normalized-event-structure.md` to include `role: z.enum(['user', 'assistant', 'system'])`.

### 3. Search Indexing Trigger Order
*   **Context**: `semantic-search` vs `bitemporal-memory`.
*   **Issue**: The Search plan (`implement-vector-upsert-logic.md`) vaguely states "When Ingestion processes an event OR Memory creates a Node". The `VectorPointSchema` requires a `node_id`. If Ingestion triggers indexing directly, the `node_id` (FalkorDB ID) might not exist yet.
*   **Impact**: Race condition or missing metadata in Vector Search.
*   **Fix**: Explicitly define the architecture as `Ingestion -> Redpanda -> Memory Service -> (Node Created) -> Search Service`. Search is a consumer of Memory's "Write Commit", not Ingestion's raw stream.

### 4. Graph Edge Definition Gaps
*   **Context**: `bitemporal-memory`.
*   **Issue**: `define-standard-edge-schemas.md` lists generic edges (`NEXT`, `TRIGGERS`) but doesn't explicitly link the `SnapshotNode` (once created) to the `Session` or `CodeArtifact`.
*   **Fix**: Add `[:SNAPSHOT_OF]` edge schema to link Snapshots to the Timeline.

## Conclusion
The plan is 95% synergistic. Addressing these 4 specific data-contract issues will ensure the "Soul" functions correctly.
