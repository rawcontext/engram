# @engram/graph

Bitemporal graph models, repositories, and utilities for FalkorDB-backed agent memory.

## Purpose

Type-safe graph layer with Zod validation, time-travel queries, and automatic bitemporal versioning. All nodes/edges track **valid time** (when facts were true) and **transaction time** (when facts were recorded).

## Models

**Core Nodes**: `SessionNode`, `TurnNode`, `ReasoningNode`, `ToolCallNode`, `FileTouchNode`, `ObservationNode`, `MemoryNode`

**Base Properties** (all nodes):
```typescript
interface BaseNode {
  id: string;        // ULID
  vt_start: number;  // Valid time start (epoch ms)
  vt_end: number;    // Valid time end (MAX_DATE if current)
  tt_start: number;  // Transaction time start
  tt_end: number;    // Transaction time end (MAX_DATE if current)
}
```

**Edges**: `HAS_TURN`, `NEXT`, `CONTAINS`, `INVOKES`, `TRIGGERS`, `TOUCHES`, `YIELDS`, `REPLACES`

## Repositories

Type-safe CRUD with automatic bitemporal management. Repositories support both **single-tenant (legacy)** and **multi-tenant** modes.

### Single-Tenant Mode (Legacy)

```typescript
import { FalkorSessionRepository, FalkorTurnRepository } from "@engram/graph";
import { createFalkorClient } from "@engram/storage";

const graphClient = createFalkorClient();
const sessionRepo = new FalkorSessionRepository(graphClient);
const session = await sessionRepo.create({
  userId: "user_123",
  agentType: "claude-code",
  workingDir: "/home/user/projects/app",
});

const turnRepo = new FalkorTurnRepository(graphClient);
const turn = await turnRepo.create({
  sessionId: session.id,
  userContent: "Add authentication",
  sequenceIndex: 0,
  toolCallsCount: 5,
});
```

### Multi-Tenant Mode

For production deployments with multiple organizations, use `TenantAwareFalkorClient`:

```typescript
import { FalkorSessionRepository } from "@engram/graph";
import { FalkorClient, TenantAwareFalkorClient } from "@engram/storage";
import type { TenantContext } from "@engram/common/types";

// Initialize base client
const falkorClient = new FalkorClient("redis://localhost:6179");
const tenantClient = new TenantAwareFalkorClient(falkorClient);

// Extract tenant context from OAuth token
const tenantContext: TenantContext = {
  orgId: "01ABCDEF123456789012345678",
  orgSlug: "acme-corp",
  userId: "user_123",
  isAdmin: false,
};

// Create tenant-scoped repository
const sessionRepo = new FalkorSessionRepository(tenantClient, tenantContext);

// All operations are automatically scoped to tenant graph: engram_acme-corp_01ABCDEF123456789012345678
const session = await sessionRepo.create({
  userId: tenantContext.userId,
  agentType: "claude-code",
  workingDir: "/home/user/projects/app",
});
```

**Graph Isolation**: Each tenant gets a dedicated FalkorDB graph named `engram_{orgSlug}_{orgId}`. This ensures complete data isolation between organizations.

**Available**: `FalkorSessionRepository`, `FalkorTurnRepository`, `FalkorReasoningRepository`, `FalkorToolCallRepository`

## QueryBuilder

Fluent Cypher builder with time-travel support:

```typescript
import { QueryBuilder } from "@engram/graph";

// Basic query
const { cypher, params } = new QueryBuilder()
  .match("(s:Session)-[:HAS_TURN]->(t:Turn)")
  .where("s.user_id = $userId")
  .return("s, t")
  .build();

// Time-travel: what turns existed at timestamp T?
const query = new QueryBuilder()
  .match("(t:Turn)")
  .at(["t"], { vt: 1704067200000 })  // Valid time
  .return("t")
  .build();

// Current knowledge (transaction time)
const current = new QueryBuilder()
  .match("(s:Session)")
  .at(["s"], { tt: "current" })
  .return("s")
  .build();
```

## GraphWriter

Low-level write operations with bitemporal injection:

```typescript
import { GraphWriter } from "@engram/graph";

const writer = new GraphWriter(falkorClient);

// Create node (bitemporal fields added automatically)
await writer.writeNode("Session", { id: "session_123", user_id: "user_456" });

// Create edge
await writer.writeEdge("session_123", "turn_789", "HAS_TURN", { sequence: 0 });

// Update node (creates new version with REPLACES edge)
await writer.updateNode("session_123", "Session", { title: "New title" });
```

## Utilities

**GraphMerger**: Merge duplicate nodes, preserving relationships
```typescript
import { GraphMerger } from "@engram/graph";
const merger = new GraphMerger(falkorClient);
await merger.mergeNodes("target_id", "source_id");
```

**GraphPruner**: Archive and delete old transaction history
```typescript
import { GraphPruner } from "@engram/graph";
const pruner = new GraphPruner(graphClient, blobStore);
await pruner.pruneHistory({ retentionMs: 30 * 24 * 60 * 60 * 1000 });
```

## Usage

```typescript
import { FalkorSessionRepository, QueryBuilder, createBitemporal } from "@engram/graph";

// See packages/graph/src/writer.ts for bitemporal node creation
// See packages/graph/src/queries/builder.ts for time-travel patterns
```
