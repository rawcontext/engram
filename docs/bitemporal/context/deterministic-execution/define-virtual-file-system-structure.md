# Bead: Define Virtual File System (VFS) Structure

## Context
**Deterministic Execution** relies on a VFS to provide a sandboxed environment for code execution. This VFS must be reconstructible from the event stream (Memory).

## Goal
Define the in-memory data structures for the VFS.

## Structure
We need a serializable VFS state to support "Snapshotting".

```typescript
export interface FileNode {
  type: 'file';
  name: string;
  content: string; // UTF-8 text for now, Buffer later if needed
  lastModified: number; // Unix Epoch
}

export interface DirectoryNode {
  type: 'directory';
  name: string;
  children: Record<string, FileNode | DirectoryNode>;
}

export interface VFSState {
  root: DirectoryNode;
  cwd: string;
}
```

## Implementation Strategy
-   **Class**: `VirtualFileSystem`
-   **Methods**: `mkdir`, `writeFile`, `readFile`, `readdir`, `stat`.
-   **Path Resolution**: Handle `.` and `..` logic relative to `cwd`.

## Acceptance Criteria
-   [ ] `packages/vfs` library created.
-   [ ] `VirtualFileSystem` class implemented with basic CRUD.
-   [ ] JSON serialization/deserialization supported for Snapshots.
