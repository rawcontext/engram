# @engram/graph

Graph database abstraction with bitemporal node and edge models.

## Overview

Abstracts FalkorDB operations and ensures all nodes/edges support bitemporal versioning (valid time and transaction time). Provides a fluent query builder and graph maintenance utilities.

## Installation

```bash
npm install @engram/graph
```

## Exports

### GraphWriter

```typescript
import { GraphWriter } from "@engram/graph";

const writer = new GraphWriter(client);

// Write nodes with bitemporal fields
await writer.createNode("Session", {
  id: "session-123",
  started_at: new Date().toISOString(),
  vt_start: new Date().toISOString(),
  tt_start: new Date().toISOString(),
});

// Create edges
await writer.createEdge("HAS_TURN", sessionId, turnId);
```

### Node Models

```typescript
import { BaseNode, SessionNode, TurnNode, ReasoningNode } from "@engram/graph";

// All nodes include bitemporal fields
interface BaseNode {
  id: string;
  vt_start: string; // Valid time start
  vt_end?: string; // Valid time end
  tt_start: string; // Transaction time start
  tt_end?: string; // Transaction time end
}
```

### QueryBuilder

```typescript
import { QueryBuilder } from "@engram/graph";

const query = new QueryBuilder()
  .match("(s:Session)")
  .where("s.id = $id")
  .return("s")
  .build();
```

### Utilities

```typescript
import { Merger, Pruner } from "@engram/graph";

// Merge duplicate nodes
const merger = new Merger(client);
await merger.mergeNodes("Session", "id");

// Prune old nodes
const pruner = new Pruner(client);
await pruner.pruneOlderThan(30); // days
```

## Bitemporal Model

Every node and edge tracks two time dimensions:

| Field | Description |
|:------|:------------|
| `vt_start` | When the fact became true in the real world |
| `vt_end` | When the fact stopped being true |
| `tt_start` | When we recorded this fact |
| `tt_end` | When we corrected/superseded this record |

This enables:
- **Point-in-time queries**: What did we know at time T?
- **As-of queries**: What was true at time T?
- **Audit trails**: Complete history of changes
