# Bead: Define Standard Edge Schemas

## Context
Edges define the relationships. In our Bitemporal system, edges *also* have valid/transaction times.

## Schemas
1.  **NEXT**: `(:Thought)-[:NEXT]->(:Thought)` - Linear conversation flow.
2.  **MOTIVATED_BY**: `(:ToolCall)-[:MOTIVATED_BY]->(:Thought)` - Why the agent called the tool.
3.  **TRIGGERS**: `(:Session)-[:TRIGGERS]->(:Thought)` - Start of a chain.
4.  **MODIFIES**: `(:DiffHunk)-[:MODIFIES]->(:CodeArtifact)` - File changes.
5.  **YIELDS**: `(:ToolCall)-[:YIELDS]->(:Observation)` - Result link.
6.  **SNAPSHOT_OF**: `(:Snapshot)-[:SNAPSHOT_OF]->(:Session)` - Links a VFS state snapshot to the session it belongs to at a specific time.

## Implementation
All edges will carry `Bitemporal` properties.

## Acceptance Criteria
-   [ ] Zod schemas for all edge types defined in `packages/memory-core/src/models/edges.ts`.
