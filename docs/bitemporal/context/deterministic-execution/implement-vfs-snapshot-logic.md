# Bead: Implement VFS Snapshot Logic

## Context
To enable "Time Travel", we cannot replay every single diff from the beginning of time. We need periodic snapshots.

## Goal
Implement logic to export and import the full VFS state.

## Implementation
-   **Serialize**: `JSON.stringify(vfs.root)`.
-   **Compression**: Use `zlib` (or `gzip`) to compress the snapshot before storage (in Memory/BlobStore).
-   **Hash**: Compute SHA-256 of the snapshot state to verify integrity.

## Interface
```typescript
class VirtualFileSystem {
  // ...
  createSnapshot(): Buffer {
    const json = JSON.stringify(this.root);
    return compress(json);
  }

  loadSnapshot(snapshot: Buffer) {
    const json = decompress(snapshot);
    this.root = JSON.parse(json);
  }
}
```

## Acceptance Criteria
-   [ ] Snapshot methods added to `VirtualFileSystem`.
-   [ ] Compression logic included.
-   [ ] Unit tests verify round-trip persistence.
