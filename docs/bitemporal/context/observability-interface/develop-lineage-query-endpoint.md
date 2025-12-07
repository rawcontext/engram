# Bead: Develop Lineage Query Endpoint

## Context
Visualizing the "Chain of Thought".

## Goal
`GET /api/lineage/:sessionId`

## Logic
1.  Query FalkorDB for the `Session` node.
2.  Traverse `[:TRIGGERS|:NEXT]*` edges.
3.  Return a linear or branching list of nodes.

## Acceptance Criteria
-   [ ] Route implemented.
-   [ ] Returns JSON graph structure (nodes/links).
