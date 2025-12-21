# @engram/temporal

Bitemporal state management and time-travel capabilities for Engram.

## Overview

This package provides the core temporal infrastructure for reconstructing and replaying system state at any point in time. It enables querying historical VFS snapshots, applying incremental diffs, and replaying tool executions for debugging and verification.

## Installation

```bash
npm install @engram/temporal
```

## Core Components

### Rehydrator

Reconstructs Virtual File System (VFS) state at any point in time by loading snapshots from blob storage and applying incremental diffs from the graph.

**Algorithm:**
1. Query graph for the latest `Snapshot` node before `targetTime`
2. Load VFS state from blob storage using `vfs_state_blob_ref`
3. Query graph for all `DiffHunk` nodes between snapshot time and target time
4. Apply patches in chronological order using `PatchManager`

```typescript
import { Rehydrator, createRehydrator } from "@engram/temporal";

// Production usage (uses default Falkor + blob store)
const rehydrator = createRehydrator();

// With dependency injection (for testing)
const rehydrator = createRehydrator({
  graphClient: customGraphClient,
  blobStore: customBlobStore,
});

// Reconstruct VFS at a specific timestamp
const vfs = await rehydrator.rehydrate("session-123", 1640000000000);

// Access files as they existed at that time
const content = vfs.readFile("/src/index.ts");
const files = vfs.readDir("/src");
```

**Bitemporal Filtering:**
The Rehydrator queries only valid, non-deleted snapshots using bitemporal validation:
```cypher
WHERE s.vt_start <= $targetTime AND s.vt_end > $targetTime
  AND s.tt_end = 253402300799000
```

### TimeTravelService

High-level service for retrieving filesystem state at historical points.

```typescript
import { TimeTravelService } from "@engram/temporal";

const service = new TimeTravelService(rehydrator);

// Get VFS at specific time
const vfs = await service.getFilesystemState("session-123", 1640000000000);

// Get compressed snapshot as Buffer
const zippedState = await service.getZippedState("session-123", 1640000000000);

// List files at a path
const files = await service.listFiles("session-123", 1640000000000, "/src");
```

### ReplayEngine

Replays historical tool call events by rehydrating VFS state and re-executing tools. Used for debugging agent decisions and verifying reproducibility.

```typescript
import { ReplayEngine } from "@engram/temporal";

const engine = new ReplayEngine(graphClient);

// Replay a specific tool call and compare outputs
const result = await engine.replay("session-123", "tool-call-event-id");

if (result.success) {
  console.log("Matches original:", result.matches);
  console.log("Original output:", result.originalOutput);
  console.log("Replay output:", result.replayOutput);
} else {
  console.error("Replay failed:", result.error);
}
```

**Supported Tools:**
- `read_file`: Reads file content from rehydrated VFS
- `write_file`: Writes file to rehydrated VFS
- `list_directory`: Lists directory entries from rehydrated VFS

### Error Classification

Utilities for distinguishing user errors from system errors.

```typescript
import { isUserError, type ExecutionError } from "@engram/temporal";

try {
  // Code execution
} catch (err) {
  if (isUserError(err)) {
    // User code issue: SyntaxError, ReferenceError, TypeError, etc.
    console.log("User error:", err.message);
  } else {
    // System error: ECONNREFUSED, ETIMEDOUT, OOM, etc.
    console.error("System error:", err.message);
  }
}
```

## Bitemporal Concepts

| Concept | Description | Field |
|:--------|:------------|:------|
| **Valid Time Start** | When the fact became true in the real world | `vt_start` |
| **Valid Time End** | When the fact stopped being true | `vt_end` |
| **Transaction Time Start** | When we recorded the fact in the system | `tt_start` |
| **Transaction Time End** | When we marked the fact as deleted | `tt_end` |
| **As-Of Query** | What was true at a given valid time? | `WHERE vt_start <= $t AND vt_end > $t` |
| **As-Known Query** | What did we know at a given transaction time? | `WHERE tt_start <= $t AND tt_end > $t` |

All graph nodes in Engram use these four temporal fields to support time-travel queries.

## Architecture

**Graph Relationships:**
```
Session -[:TRIGGERS]-> Thought -[:NEXT*]-> Thought -[:YIELDS]-> ToolCall -[:YIELDS]-> DiffHunk
Session -[:HAS_SNAPSHOT]-> Snapshot
```

**Rehydration Flow:**
```
1. Query FalkorDB for latest Snapshot (bitemporal filtered)
2. Load VFS from blob storage (GCS/local)
3. Query FalkorDB for DiffHunks (session-filtered, time-ordered)
4. Apply patches with PatchManager (continue on partial failures)
5. Return reconstructed VFS
```

## Use Cases

- **Debugging**: See exact file state when a bug was introduced
- **Auditing**: Review what the system knew at any transaction time
- **Recovery**: Restore VFS state from before an error occurred
- **Verification**: Replay tool calls to verify agent decision consistency
- **Analysis**: Compare state across time periods for behavioral analysis

## Dependencies

- **@engram/storage**: FalkorDB client, blob store (GCS/local)
- **@engram/vfs**: Virtual file system, patch manager
- **@engram/common**: RehydrationError and shared utilities
- **zod**: Schema validation (v4.2.1+)

## Exported APIs

```typescript
// Classes
export { Rehydrator } from "./rehydrator";
export { TimeTravelService } from "./time-travel";
export { ReplayEngine } from "./replay";

// Factories
export { createRehydrator } from "./rehydrator";

// Types
export type { RehydratorDeps } from "./rehydrator";
export type { ExecutionError, ExecutionErrorType } from "./errors";

// Utilities
export { isUserError } from "./errors";
```
