# @engram/vfs

Virtual file system implementations for Engram's bitemporal agent memory system.

## Purpose

Provides file system abstractions for agent sessions, time-travel reconstruction, testing, and production I/O. Used by `@engram/temporal` for VFS state rehydration.

## Installation

```bash
bun install @engram/vfs
```

## Components

### VirtualFileSystem

In-memory file tree for agent sessions with gzip-compressed snapshot support. **Does not implement IFileSystem** - purpose-built for session state.

```typescript
import { VirtualFileSystem } from "@engram/vfs";

const vfs = new VirtualFileSystem();
vfs.writeFile("/src/index.ts", 'console.log("hello");'); // Auto-creates directories
const content = vfs.readFile("/src/index.ts");
const snapshot: Buffer = await vfs.createSnapshot();
await vfs.loadSnapshot(snapshot);
```

**Key Features**: Path traversal protection, automatic parent directory creation, gzip compression.

### NodeFileSystem

Production filesystem wrapper implementing IFileSystem with security features.

```typescript
import { NodeFileSystem } from "@engram/vfs";

const fs = new NodeFileSystem("/workspace"); // All paths restricted to base directory
fs.writeFile("src/index.ts", "const x = 1;");
await fs.writeFileAsync("src/index.ts", "const x = 1;");
```

**Key Features**: Path traversal protection (throws `PathTraversalError`), sync/async operations, IFileSystem interface.

### InMemoryFileSystem

Test-friendly IFileSystem implementation with helper methods.

```typescript
import { InMemoryFileSystem } from "@engram/vfs";

const fs = new InMemoryFileSystem();
fs.mkdir("/src", { recursive: true });
fs.writeFile("/src/index.ts", "const x = 1;");
fs.clear(); // Reset to initial state
```

**Key Features**: No real I/O, test helpers (`clear()`, `getFileCount()`, `getAllFilePaths()`), proper error codes (ENOENT, ENOTDIR).

### PatchManager

Apply unified diffs and search/replace operations to VirtualFileSystem.

```typescript
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

const vfs = new VirtualFileSystem();
const patcher = new PatchManager(vfs);

// Unified diff
patcher.applyUnifiedDiff("/src/index.ts", diffContent);

// Search/replace (with file-level locking)
await patcher.applySearchReplace("/src/index.ts", "hello", "goodbye");
```

**Key Features**: Hunk header validation, handles file creation patches, operation serialization per file.

## Integration Example

```typescript
import { Rehydrator } from "@engram/temporal";
import { VirtualFileSystem } from "@engram/vfs";

const rehydrator = new Rehydrator({ graphClient });
const vfs: VirtualFileSystem = await rehydrator.rehydrate("session-123", timestamp);
const content = vfs.readFile("/src/index.ts");
```

## Exports

```typescript
// Interfaces
export { IFileSystem, FileStat } from "./interfaces";

// Implementations
export { VirtualFileSystem, FileNode, DirectoryNode } from "./vfs";
export { NodeFileSystem, PathTraversalError } from "./node-fs";
export { InMemoryFileSystem } from "./memory-fs";

// Utilities
export { PatchManager } from "./patch";
```

## Dependencies

- `diff` ^8.0.2 - Unified diff patching
- Node.js built-ins: `node:fs`, `node:path`, `node:util`, `node:zlib`
