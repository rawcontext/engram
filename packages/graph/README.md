# @engram/graph

Bitemporal graph models, repositories, and utilities for FalkorDB-backed agent memory.

## Overview

Provides Zod-validated graph node/edge schemas, type-safe repositories with time-travel support, and utilities for graph maintenance. All entities are bitemporal, tracking both valid time (when facts were true) and transaction time (when facts were recorded).

## Installation

```bash
npm install @engram/graph
```

## Core Features

- **Bitemporal versioning**: All nodes/edges track `vt_start/vt_end` (valid time) and `tt_start/tt_end` (transaction time)
- **Type-safe repositories**: CRUD operations with Zod validation for Session, Turn, Reasoning, and ToolCall entities
- **Time-travel queries**: Query graph state at any point in valid time or transaction time
- **Graph utilities**: Merge duplicate nodes, prune old history, build Cypher queries fluently
- **Cypher injection protection**: Validated identifiers for labels and relationship types

## Graph Models

### Node Types

All nodes extend `BaseNode` with bitemporal properties (epoch milliseconds):

```typescript
import type { BaseNode, SessionNode, TurnNode, ReasoningNode, ToolCallNode } from "@engram/graph";

// Base properties for all nodes
interface BaseNode {
  id: string;           // ULID
  labels: string[];     // Node labels
  vt_start: number;     // Valid time start
  vt_end: number;       // Valid time end (MAX_DATE if current)
  tt_start: number;     // Transaction time start
  tt_end: number;       // Transaction time end (MAX_DATE if current)
}
```

**Primary Node Types:**

- **SessionNode**: Agent conversation session with project context (`working_dir`, `git_remote`, `agent_type`)
- **TurnNode**: Single conversation turn (user prompt + assistant response) with aggregated metrics
- **ReasoningNode**: Thinking/reasoning block within a turn (`chain_of_thought`, `reflection`, etc.)
- **ToolCallNode**: Tool invocation with execution status and arguments
- **FileTouchNode**: File operation tracking (`read`, `edit`, `create`, `delete`)
- **ObservationNode**: Tool execution results linked to ToolCall
- **MemoryNode**: User-defined or auto-extracted memories with semantic embeddings
- **CodeArtifactNode**: Code content snapshots
- **DiffHunkNode**: Code change patches
- **SnapshotNode**: VFS state snapshots

### Edge Types

All edges are bitemporal. Defined in `EdgeTypes`:

```typescript
import { EdgeTypes } from "@engram/graph";

// Session hierarchy
EdgeTypes.HAS_TURN    // Session -> Turn
EdgeTypes.NEXT        // Turn -> Turn (sequential)

// Turn contents
EdgeTypes.CONTAINS    // Turn -> Reasoning
EdgeTypes.INVOKES     // Turn -> ToolCall

// Causal lineage
EdgeTypes.TRIGGERS    // Reasoning -> ToolCall
EdgeTypes.TOUCHES     // ToolCall -> FileTouch
EdgeTypes.YIELDS      // ToolCall -> Observation

// Code relationships
EdgeTypes.MODIFIES    // DiffHunk -> CodeArtifact
EdgeTypes.SNAPSHOT_OF // Snapshot -> VFS state

// Versioning
EdgeTypes.REPLACES    // New version -> Old version
EdgeTypes.SAME_AS     // Deduplication link
```

## Repositories

Type-safe CRUD operations with automatic bitemporal management:

### Session Repository

```typescript
import { FalkorSessionRepository } from "@engram/graph";

const sessionRepo = new FalkorSessionRepository(graphClient);

// Create session
const session = await sessionRepo.create({
  userId: "user_123",
  agentType: "claude-code",
  workingDir: "/home/user/projects/app",
  gitRemote: "github.com/user/app",
});

// Find by ID
const found = await sessionRepo.findById(session.id);

// Update session
await sessionRepo.update(session.id, {
  title: "Implement authentication",
  summary: "Added OAuth2 login flow with JWT tokens",
});

// List sessions for user
const sessions = await sessionRepo.findByUserId("user_123");
```

### Turn Repository

```typescript
import { FalkorTurnRepository } from "@engram/graph";

const turnRepo = new FalkorTurnRepository(graphClient);

// Create turn
const turn = await turnRepo.create({
  sessionId: session.id,
  userContent: "Add user authentication",
  userContentHash: "sha256_hash",
  assistantPreview: "I'll implement OAuth2...",
  sequenceIndex: 0,
  filesTouched: ["src/auth/login.ts"],
  toolCallsCount: 5,
});

// Find turns for session
const turns = await turnRepo.findBySessionId(session.id);

// Update turn metrics
await turnRepo.update(turn.id, {
  inputTokens: 1500,
  outputTokens: 800,
  costUsd: 0.025,
  durationMs: 3200,
});
```

### Reasoning Repository

```typescript
import { FalkorReasoningRepository } from "@engram/graph";

const reasoningRepo = new FalkorReasoningRepository(graphClient);

// Create reasoning block
const reasoning = await reasoningRepo.create({
  turnId: turn.id,
  contentHash: "sha256_hash",
  preview: "I need to implement OAuth2 flow...",
  reasoningType: "planning",
  sequenceIndex: 0,
});

// Find reasoning for turn
const blocks = await reasoningRepo.findByTurnId(turn.id);
```

### ToolCall Repository

```typescript
import { FalkorToolCallRepository } from "@engram/graph";

const toolCallRepo = new FalkorToolCallRepository(graphClient);

// Create tool call
const toolCall = await toolCallRepo.create({
  turnId: turn.id,
  callId: "toolu_01ABC123",
  toolName: "Read",
  toolType: "file_read",
  argumentsJson: JSON.stringify({ file_path: "src/auth.ts" }),
  status: "pending",
  sequenceIndex: 1,
});

// Update with result
await toolCallRepo.updateResult(toolCall.id, {
  status: "success",
  executionTimeMs: 45,
});

// Find tool calls for turn
const toolCalls = await toolCallRepo.findByTurnId(turn.id);
```

## GraphWriter

Low-level write operations with automatic bitemporal field injection:

```typescript
import { GraphWriter } from "@engram/graph";

const writer = new GraphWriter(falkorClient);

// Create node (bitemporal fields added automatically)
await writer.writeNode("Session", {
  id: "session_123",
  user_id: "user_456",
  started_at: Date.now(),
});

// Create edge
await writer.writeEdge(
  "session_123",
  "turn_789",
  "HAS_TURN",
  { sequence: 0 }
);

// Update node (creates new version with REPLACES edge)
await writer.updateNode(
  "session_123",
  "Session",
  { id: "session_123_v2", title: "New title" }
);

// Soft delete (closes transaction time)
await writer.deleteNode("session_123_v2");
```

## QueryBuilder

Fluent Cypher query builder with time-travel support:

```typescript
import { QueryBuilder } from "@engram/graph";

// Build basic query
const { cypher, params } = new QueryBuilder()
  .match("(s:Session)-[:HAS_TURN]->(t:Turn)")
  .where("s.user_id = $userId")
  .return("s, t")
  .build();

// Time-travel query: what turns existed at timestamp T?
const { cypher, params } = new QueryBuilder()
  .match("(t:Turn)")
  .at(["t"], { vt: 1704067200000 })  // Valid time
  .return("t")
  .build();

// Query current knowledge (transaction time)
const { cypher, params } = new QueryBuilder()
  .match("(s:Session)")
  .at(["s"], { tt: "current" })
  .return("s")
  .build();

await graphClient.query(cypher, params);
```

## Graph Utilities

### GraphMerger

Merge duplicate nodes while preserving relationships:

```typescript
import { GraphMerger } from "@engram/graph";

const merger = new GraphMerger(falkorClient);

// Merge source node into target (re-links all edges, deletes source)
await merger.mergeNodes("target_id", "source_id");
```

### GraphPruner

Archive and delete old transaction history:

```typescript
import { GraphPruner } from "@engram/graph";

const pruner = new GraphPruner(graphClient, blobStore);

// Prune nodes older than 30 days (archives to blob storage first)
const result = await pruner.pruneHistory({
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  batchSize: 1000,
  maxBatches: 10,
});

console.log(`Archived: ${result.archived}, Deleted: ${result.deleted}`);
console.log(`Archive URI: ${result.archiveUri}`);
```

## Time Utilities

```typescript
import { now, createBitemporal, MAX_DATE } from "@engram/graph";

// Current timestamp (epoch ms)
const timestamp = now();

// Create bitemporal properties for new node
const temporal = createBitemporal(timestamp);
// Returns: { vt_start: timestamp, vt_end: MAX_DATE, tt_start: now(), tt_end: MAX_DATE }

// Maximum date constant (9999-12-31)
console.log(MAX_DATE); // 253402300799000
```

## Bitemporal Model

Every node and edge tracks two independent time dimensions:

| Field | Type | Description |
|-------|------|-------------|
| `vt_start` | number | When this fact became true in reality (epoch ms) |
| `vt_end` | number | When this fact stopped being true (MAX_DATE if current) |
| `tt_start` | number | When we recorded this fact in the database (epoch ms) |
| `tt_end` | number | When we superseded/corrected this record (MAX_DATE if current) |

**Valid Time (VT)**: Models when facts were true in the real world. Use for "what happened when?" queries.

**Transaction Time (TT)**: Models when facts were recorded in the database. Use for "what did we know when?" queries and audit trails.

**Query Patterns:**

```typescript
// Current facts (default)
WHERE n.vt_end = ${MAX_DATE} AND n.tt_end = ${MAX_DATE}

// Point-in-time: what was true on Jan 1, 2024?
WHERE n.vt_start <= $timestamp AND n.vt_end > $timestamp AND n.tt_end = ${MAX_DATE}

// As-of: what did we know on Jan 1, 2024?
WHERE n.tt_start <= $timestamp AND n.tt_end > $timestamp

// Time-travel: what did we think was true on Jan 1 as of Feb 1?
WHERE n.vt_start <= $vt AND n.vt_end > $vt AND n.tt_start <= $tt AND n.tt_end > $tt
```

## Dependencies

- **@engram/storage**: FalkorDB client interface
- **zod**: Runtime type validation and schema inference
- **ulid**: ULID generation for node IDs

## Architecture

```
Session (user_id, working_dir, git_remote)
  └─[HAS_TURN]→ Turn (user_content, assistant_preview, metrics)
       ├─[CONTAINS]→ Reasoning (preview, reasoning_type)
       │              └─[TRIGGERS]→ ToolCall
       └─[INVOKES]→ ToolCall (tool_name, status, arguments)
                      ├─[TOUCHES]→ FileTouch (file_path, action)
                      └─[YIELDS]→ Observation (content, is_error)
```

All relationships flow through ToolCall to maintain complete causal lineage from reasoning to file changes.
