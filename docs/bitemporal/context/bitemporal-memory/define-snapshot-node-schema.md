# Bead: Define SnapshotNode Schema

## Context
To enable efficient "Time Travel" and Replay without re-processing thousands of DiffHunks from the beginning of time, the **Deterministic Execution** service periodically creates full snapshots of the Virtual File System (VFS). These snapshots must be tracked in the **Bitemporal Memory** graph.

## Goal
Define the `SnapshotNode` schema using Zod.

## Schema Definition

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const SnapshotNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['Snapshot']),
  
  // Reference to the blob storage containing the gzipped JSON of the VFS state
  vfs_state_blob_ref: z.string().url(), 
  
  // Hash of the uncompressed state for integrity verification
  state_hash: z.string(),
  
  // The 'valid time' of this snapshot (snapshot_at) is redundant with BaseNode.vt_start,
  // but good for explicit querying.
  snapshot_at: z.number(), // Epoch
});

export type SnapshotNode = z.infer<typeof SnapshotNodeSchema>;
```

## Research & Rationale
-   **Frequency**: Snapshots are created periodically (e.g., every 10 mins or 50 diffs).
-   **Storage**: The actual VFS JSON is too large for Redis/FalkorDB properties (limit 512MB, but performance degrades). Storing it in the BlobStore (`blob_ref`) is the correct pattern.
-   **Edges**: Snapshots will be linked to the `Session` via `[:SNAPSHOT_OF]`.

## Acceptance Criteria
-   [ ] Zod schema defined.
-   [ ] Type exported as `SnapshotNode`.
