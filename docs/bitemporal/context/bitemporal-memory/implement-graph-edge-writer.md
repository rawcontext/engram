# Bead: Implement Graph Edge Writer

## Context
Writing edges (Relationships) with bitemporal properties.

## Goal
Implement `GraphWriter.writeEdge(fromId, toId, relation, props)`.

## Logic
```cypher
MATCH (a {id: $from}), (b {id: $to})
CREATE (a)-[:REL_TYPE { ...bitemporal_props }]->(b)
```

## Acceptance Criteria
-   [ ] Writer implemented.
-   [ ] Validates existence of start/end nodes before writing.
