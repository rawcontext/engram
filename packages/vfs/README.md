# @engram/vfs

Virtual File System for representing and mutating code snapshots.

## Overview

Efficient in-memory representation of code state, supporting compression and patch-based updates for session reconstruction.

## Installation

```bash
npm install @engram/vfs
```

## Core Components

### VirtualFileSystem

In-memory file tree with directories and files.

```typescript
import { VirtualFileSystem } from "@engram/vfs";

const vfs = new VirtualFileSystem();

// Create directories
vfs.mkdir("/src");
vfs.mkdir("/src/components");

// Write files
vfs.writeFile("/src/index.ts", 'console.log("hello");');

// Read files
const content = vfs.readFile("/src/index.ts");

// Check existence
if (vfs.exists("/src/index.ts")) {
  // File exists
}

// Remove files
vfs.removeFile("/src/old.ts");

// List directory contents
const files = vfs.readdir("/src");
```

### PatchManager

Apply unified diffs to file content.

```typescript
import { PatchManager } from "@engram/vfs";

const patcher = new PatchManager();

const patch = `
--- a/src/index.ts
+++ b/src/index.ts
@@ -1 +1 @@
-console.log("hello");
+console.log("goodbye");
`;

const newContent = patcher.apply(originalContent, patch);
```

### Compression

```typescript
import { gzip, gunzip } from "@engram/vfs";

// Compress content
const compressed = await gzip(content);

// Decompress content
const decompressed = await gunzip(compressed);
```

## File System Structure

```typescript
interface FileNode {
  type: "file";
  content: string;
}

interface DirectoryNode {
  type: "directory";
  children: Map<string, FileNode | DirectoryNode>;
}
```

## Use Cases

- **Session State**: Track file changes during coding sessions
- **Time Travel**: Reconstruct file state at any point
- **Diff Generation**: Compare states and generate patches
- **Testing**: Mock file system for unit tests

## Integration with Temporal

The VFS works with `@engram/temporal` for time-travel capabilities:

```typescript
import { Rehydrator } from "@engram/temporal";
import { VirtualFileSystem } from "@engram/vfs";

const rehydrator = new Rehydrator(graphClient);
const vfs: VirtualFileSystem = await rehydrator.rehydrate({
  sessionId: "session-123",
  asOf: timestamp,
});
```
