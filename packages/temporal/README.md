# @engram/temporal

Bitemporal state management and time-travel capabilities for Engram. Reconstructs Virtual File System state at any point in time and replays historical tool executions.

## Purpose

Enables querying historical VFS snapshots, applying incremental diffs, and replaying tool executions for debugging and verification. All graph nodes use bitemporal fields (`vt_start/vt_end`, `tt_start/tt_end`) to support time-travel queries.

## Core Components

### Rehydrator

Reconstructs VFS state at any timestamp by loading snapshots from blob storage and applying incremental diffs from the graph.

```typescript
import { createRehydrator } from "@engram/temporal";

const rehydrator = createRehydrator();
const vfs = await rehydrator.rehydrate("session-123", 1640000000000);

// Access files as they existed at that time
const content = vfs.readFile("/src/index.ts");
```

**Algorithm:**
1. Query graph for latest `Snapshot` before `targetTime` (bitemporal filtered)
2. Load VFS from blob storage via `vfs_state_blob_ref`
3. Query `DiffHunk` nodes between snapshot and target time
4. Apply patches chronologically using `PatchManager`

### TimeTravelService

High-level service wrapping Rehydrator for common operations.

```typescript
import { TimeTravelService } from "@engram/temporal";

const service = new TimeTravelService(rehydrator);

const vfs = await service.getFilesystemState("session-123", 1640000000000);
const zipped = await service.getZippedState("session-123", 1640000000000);
const files = await service.listFiles("session-123", 1640000000000, "/src");
```

### ReplayEngine

Replays historical tool calls by rehydrating VFS state and re-executing tools. Compares replay output with original for verification.

```typescript
import { ReplayEngine } from "@engram/temporal";

const engine = new ReplayEngine(graphClient);
const result = await engine.replay("session-123", "tool-call-event-id");

console.log("Matches:", result.matches);
console.log("Original:", result.originalOutput);
console.log("Replay:", result.replayOutput);
```

**Supported Tools:** `read_file`, `write_file`, `list_directory`, `mkdir`, `exists`

## Usage

```bash
bun install @engram/temporal
```

```typescript
import { createRehydrator, TimeTravelService, ReplayEngine } from "@engram/temporal";

// Production usage
const rehydrator = createRehydrator();
const service = new TimeTravelService(rehydrator);

// Testing with mocks
const testRehydrator = createRehydrator({
  graphClient: mockGraphClient,
  blobStore: mockBlobStore,
});
```

## Architecture

**Graph Relationships:**
```
Session -[:TRIGGERS]-> Thought -[:NEXT*]-> Thought -[:YIELDS]-> ToolCall -[:YIELDS]-> DiffHunk
Session -[:HAS_SNAPSHOT]-> Snapshot
```

**Bitemporal Fields:**
- `vt_start/vt_end`: Valid time (when fact was true in real world)
- `tt_start/tt_end`: Transaction time (when fact was recorded/deleted)

**Bitemporal Queries:**
```cypher
-- As-of query: what was true at time T?
WHERE vt_start <= $t AND vt_end > $t AND tt_end = 253402300799000

-- As-known query: what did we know at time T?
WHERE tt_start <= $t AND tt_end > $t
```

## Dependencies

- `@engram/storage`: FalkorDB client, blob store
- `@engram/vfs`: Virtual file system, patch manager
- `@engram/common`: RehydrationError and utilities
