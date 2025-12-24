# @engram/vfs

Virtual file system implementations and utilities for Engram's bitemporal agent memory system.

## Overview

Provides three file system implementations with different use cases:
- **VirtualFileSystem**: In-memory file tree for agent sessions and snapshot creation
- **NodeFileSystem**: Real filesystem wrapper with path traversal protection
- **InMemoryFileSystem**: Test-friendly IFileSystem implementation

Also includes patch management utilities for applying unified diffs and search/replace operations.

## Installation

```bash
npm install @engram/vfs
```

## Core Components

### VirtualFileSystem

In-memory file tree designed for agent session state management and time-travel reconstruction. Uses gzip compression for efficient snapshot storage.

```typescript
import { VirtualFileSystem } from "@engram/vfs";

const vfs = new VirtualFileSystem();

// Create directories
vfs.mkdir("/src");
vfs.mkdir("/src/components");

// Write files (automatically creates parent directories)
vfs.writeFile("/src/index.ts", 'console.log("hello");');

// Read files
const content = vfs.readFile("/src/index.ts");

// Check existence
if (vfs.exists("/src/index.ts")) {
  // File exists
}

// List directory contents
const files = vfs.readDir("/src");

// Create compressed snapshot
const snapshot: Buffer = await vfs.createSnapshot();

// Restore from snapshot
await vfs.loadSnapshot(snapshot);
```

**Key Features:**
- Path traversal protection (sanitizes all paths)
- Automatic parent directory creation on writeFile
- Gzip compression for snapshots
- Designed for in-memory state, not IFileSystem interface

**Structure:**
```typescript
interface FileNode {
  type: "file";
  name: string;
  content: string;
  lastModified: number;
}

interface DirectoryNode {
  type: "directory";
  name: string;
  children: Record<string, FileNode | DirectoryNode>;
}
```

### NodeFileSystem

Production file system implementation that wraps Node.js `fs` module with security features.

```typescript
import { NodeFileSystem } from "@engram/vfs";

// Create instance with base directory (all paths restricted to this directory)
const fs = new NodeFileSystem("/path/to/workspace");

// Synchronous operations
fs.mkdir("src", { recursive: true });
fs.writeFile("src/index.ts", "const x = 1;");
const content = fs.readFile("src/index.ts");
const files = fs.readDir("src");
const exists = fs.exists("src/index.ts");
const stats = fs.stat("src/index.ts");

// Asynchronous operations
await fs.mkdirAsync("src", { recursive: true });
await fs.writeFileAsync("src/index.ts", "const x = 1;");
const content = await fs.readFileAsync("src/index.ts");
const files = await fs.readDirAsync("src");
```

**Key Features:**
- Path traversal protection (throws `PathTraversalError`)
- All paths validated against base directory
- Full IFileSystem interface implementation
- Both sync and async variants of all operations

### InMemoryFileSystem

Complete in-memory IFileSystem implementation for testing.

```typescript
import { InMemoryFileSystem } from "@engram/vfs";

const fs = new InMemoryFileSystem();

// Standard file operations
fs.mkdir("/src", { recursive: true });
fs.writeFile("/src/index.ts", "const x = 1;");
const content = fs.readFile("/src/index.ts");

// Test helper methods
fs.clear();                    // Reset to initial state
const fileCount = fs.getFileCount();
const dirCount = fs.getDirectoryCount();
const allFiles = fs.getAllFilePaths();
```

**Key Features:**
- Full IFileSystem interface implementation
- Test-specific helper methods
- No real filesystem I/O
- Proper error codes (ENOENT, ENOTDIR, etc.)

### PatchManager

Apply unified diffs and search/replace operations to VirtualFileSystem.

```typescript
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

const vfs = new VirtualFileSystem();
const patcher = new PatchManager(vfs);

// Apply unified diff
const patch = `
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-console.log("hello");
+console.log("goodbye");
`;
patcher.applyUnifiedDiff("/src/index.ts", patch);

// Apply search/replace (serialized to prevent race conditions)
await patcher.applySearchReplace(
  "/src/index.ts",
  'console.log("hello")',
  'console.log("goodbye")'
);
```

**Key Features:**
- Validates hunk headers to catch off-by-one errors
- Handles file creation patches (missing files)
- Search/replace with operation locking per file
- Built on `diff` library's `applyPatch`

### IFileSystem Interface

Abstract interface for dependency injection and testing.

```typescript
interface IFileSystem {
  // Existence checks
  exists(path: string): boolean;
  existsAsync(path: string): Promise<boolean>;

  // Directory operations
  mkdir(path: string, options?: { recursive?: boolean }): void;
  mkdirAsync(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): string[];
  readDirAsync(path: string): Promise<string[]>;
  rmdir(path: string, options?: { recursive?: boolean }): void;
  rmdirAsync(path: string, options?: { recursive?: boolean }): Promise<void>;

  // File operations
  writeFile(path: string, content: string | Buffer): void;
  writeFileAsync(path: string, content: string | Buffer): Promise<void>;
  readFile(path: string): string;
  readFileAsync(path: string): Promise<string>;
  unlink(path: string): void;
  unlinkAsync(path: string): Promise<void>;

  // Metadata
  stat(path: string): FileStat;
  statAsync(path: string): Promise<FileStat>;
}
```

## Exported APIs

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

- `diff` ^8.0.2 - Unified diff patching (used by PatchManager)
- `@types/diff` ^8.0.0 - TypeScript types for diff library
- Node.js built-ins: `node:fs`, `node:path`, `node:util`, `node:zlib`

## Use Cases

### Agent Session State
Track file changes during coding sessions with VirtualFileSystem and create compressed snapshots for bitemporal storage.

### Time Travel
Reconstruct file state at any point in time by loading snapshots and applying incremental patches.

### Testing
Use InMemoryFileSystem to test code that depends on file operations without touching the real filesystem.

### Production File I/O
Use NodeFileSystem when you need real filesystem access with built-in security against path traversal attacks.

## Integration with Engram

VirtualFileSystem is used by `@engram/temporal` for time-travel reconstruction and `apps/control` for session orchestration:

```typescript
import { Rehydrator } from "@engram/temporal";
import { VirtualFileSystem } from "@engram/vfs";

const rehydrator = new Rehydrator({ graphClient });
const vfs: VirtualFileSystem = await rehydrator.rehydrate("session-123", timestamp);
```
