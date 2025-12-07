# Bead: Implement Transaction Time Logic (Update/Delete)

## Context
Updating a node in a bitemporal system means "retiring" the old record and creating a new one (if it's a value change) or just retiring it (if it's a delete).

## Goal
Implement `updateNode` and `deleteNode` handling.

## Update Logic
1.  **Match** the existing "Current" node (`tt_end = MAX`).
2.  **SET** its `tt_end` to NOW.
3.  **CREATE** a copy with new properties, `tt_start` = NOW, `tt_end` = MAX.
4.  **Clone Edges**: Any edges pointing to the old node must be re-created pointing to the new node (propagation). *Complexity*: This is the hardest part.
    *   *Alternative*: Keep edges pointing to a stable "Entity ID" node, and have that point to the "Version" node.
    *   *Decision*: For simplicity in V1, we will treat Nodes as immutable for most high-volume data (Thoughts). If we need to "Edit" a thought, we create a new Thought node and link it via a `REPLACES` edge, rather than doing strict bitemporal row updates. This simplifies the graph significantly.
    *   *Revised Logic*: Use "Append-Only" log semantics. `updateNode` is actually `createNode(NewVersion) -[:REPLACES]-> (OldVersion)`.

## Acceptance Criteria
-   [ ] Document the "Append-Only + REPLACES edge" strategy as the primary update mechanism to avoid massive edge-cloning overhead in Cypher.
