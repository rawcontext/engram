# Refactoring Analysis: apps/execution

**Date**: 2025-12-09
**Analyzed By**: Refactor Guru
**Scope**: `/Users/ccheney/Projects/the-system/apps/execution` and related packages

---

## Executive Summary

The execution app is a minimal MCP (Model Context Protocol) server providing VFS and time-travel capabilities. While the codebase is relatively small (~130 LOC in the app, ~340 LOC in execution-core), several architectural issues and code smells limit maintainability, testability, and extensibility.

**Key Findings**:
- No tests exist for the main app (`apps/execution/src/index.ts`)
- Heavy reliance on `as any` type casts to bypass TypeScript
- Tool registration pattern creates tight coupling
- Duplicated error handling across all tool handlers
- Silent error swallowing in critical paths
- Missing dependency injection pattern

---

## 1. Code Smells and Complexity Issues

### 1.1 Type Safety Bypass with `as any` Casts

| File | Line | Severity | Description |
|------|------|----------|-------------|
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 37-38 | **HIGH** | `inputSchema` and handler cast to `any` |
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 61-62 | **HIGH** | Same pattern repeated |
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 88-89 | **HIGH** | Same pattern repeated |
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 52, 77, 113 | **HIGH** | Handler functions cast to `any` |

**Current Code** (lines 31-53):
```typescript
server.registerTool(
	"read_file",
	{
		description: "Read a file from the Virtual File System",
		inputSchema: {
			path: z.string(),
		} as any,  // <-- Type safety bypassed
	},
	(async ({ path }: { path: string }) => {
		// ...
	}) as any,  // <-- Type safety bypassed
);
```

**Impact**: Loss of compile-time type checking, potential runtime errors, harder to refactor.

### 1.2 Silent Error Swallowing

| File | Line | Severity | Description |
|------|------|----------|-------------|
| `/Users/ccheney/Projects/the-system/packages/execution-core/src/rehydrator.ts` | 33-43 | **HIGH** | JSON parse errors silently ignored |
| `/Users/ccheney/Projects/the-system/packages/execution-core/src/rehydrator.ts` | 74-76 | **MEDIUM** | Patch failures logged but swallowed |
| `/Users/ccheney/Projects/the-system/packages/execution-core/src/time-travel.ts` | 29-30 | **MEDIUM** | readDir errors return empty array |

**Example** (rehydrator.ts lines 31-43):
```typescript
try {
	await vfs.loadSnapshot(Buffer.from(blobContent));
} catch (_e) {
	// If gzip fails, try loading as JSON directly
	try {
		const parsed = JSON.parse(blobContent);
		if (parsed.root) {
			vfs.root = parsed.root;
		}
	} catch (_jsonErr) {
		// Continue with empty VFS if loading fails  <-- Silent failure
	}
}
```

**Impact**: Debugging becomes extremely difficult; data corruption or partial state may go unnoticed.

### 1.3 Unused Variable

| File | Line | Severity | Description |
|------|------|----------|-------------|
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 27-29 | **LOW** | `_ReadFileSchema` defined but never used |

```typescript
const _ReadFileSchema = {
	path: z.string(),
};
```

---

## 2. Architecture Improvements

### 2.1 Missing Dependency Injection

**Severity**: HIGH

**Current State** (index.ts lines 16-20):
```typescript
// Initialize Core Services - Hard-coded dependencies
const vfs = new VirtualFileSystem();
const patchManager = new PatchManager(vfs);
const falkor = createFalkorClient();
const rehydrator = new Rehydrator(falkor);
const timeTravel = new TimeTravelService(rehydrator);
```

**Issues**:
- Services cannot be mocked for testing
- Configuration is hard-coded
- No lifecycle management
- Tight coupling between services

**Recommended Architecture**:
```typescript
// services/container.ts
interface ServiceContainer {
  vfs: VirtualFileSystem;
  patchManager: PatchManager;
  falkor: FalkorClient;
  rehydrator: Rehydrator;
  timeTravel: TimeTravelService;
}

function createServiceContainer(config: Config): ServiceContainer {
  const vfs = new VirtualFileSystem();
  const patchManager = new PatchManager(vfs);
  const falkor = createFalkorClient(config.falkorUrl);
  const rehydrator = new Rehydrator(falkor);
  const timeTravel = new TimeTravelService(rehydrator);

  return { vfs, patchManager, falkor, rehydrator, timeTravel };
}
```

### 2.2 Tool Registration Pattern - God Function Anti-Pattern

**Severity**: MEDIUM

**Current State**: All tool registrations happen inline in `index.ts` with duplicated error handling.

**Recommended Architecture**:
```typescript
// tools/base-tool.ts
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  handler: (input: TInput, services: ServiceContainer) => Promise<TOutput>;
}

// tools/read-file.ts
export const readFileTool: ToolDefinition<{ path: string }, ToolResult> = {
  name: "read_file",
  description: "Read a file from the Virtual File System",
  inputSchema: z.object({ path: z.string() }),
  handler: async ({ path }, { vfs }) => {
    const content = vfs.readFile(path);
    return { content: [{ type: "text", text: content }] };
  }
};

// tools/registry.ts
export function registerAllTools(server: McpServer, services: ServiceContainer) {
  const tools = [readFileTool, applyPatchTool, listFilesAtTimeTool];
  tools.forEach(tool => registerTool(server, tool, services));
}
```

### 2.3 Missing Error Domain Model

**Severity**: MEDIUM

The `errors.ts` file in execution-core is essentially a stub:

```typescript
// packages/execution-core/src/errors.ts
export const isUserError = (_err: unknown): boolean => {
	// Logic to distinguish syntax/runtime errors from sandbox crashes
	return true; // Default  <-- Always returns true, no real implementation
};
```

**Recommendation**: Implement proper error classification for better debugging and user feedback.

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Error Handling Pattern Duplication

**Severity**: HIGH

The same try-catch pattern is repeated 3 times in `index.ts`:

**Pattern** (appears at lines 40-51, 64-77, 100-112):
```typescript
try {
	// ... tool logic
	return {
		content: [{ type: "text", text: result }],
	};
} catch (e: unknown) {
	const message = e instanceof Error ? e.message : String(e);
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		isError: true,
	};
}
```

**Recommendation**: Extract to a higher-order function:
```typescript
function withErrorHandling<T>(
  handler: (input: T) => Promise<string>
): (input: T) => Promise<ToolResult> {
  return async (input: T) => {
    try {
      const result = await handler(input);
      return { content: [{ type: "text", text: result }] };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  };
}
```

### 3.2 FalkorDB Connection Check Duplication

**Severity**: MEDIUM

Multiple places call `await falkor.connect()` before queries:

| File | Line | Description |
|------|------|-------------|
| `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` | 101 | In `list_files_at_time` handler |
| `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts` | 108, 266, 302 | Multiple places |

The FalkorClient itself handles this internally but the pattern is inconsistent.

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP) Violation

**File**: `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts`
**Severity**: MEDIUM

The main `index.ts` handles:
1. Logger initialization
2. Service instantiation
3. Tool definitions
4. Tool registration
5. Server setup
6. Main entry point

**Recommendation**: Split into separate modules:
```
apps/execution/src/
  index.ts          # Entry point only
  config.ts         # Logger and configuration
  container.ts      # Service instantiation
  tools/
    index.ts        # Tool registry
    read-file.ts
    apply-patch.ts
    time-travel.ts
  server.ts         # MCP server setup
```

### 4.2 Dependency Inversion Principle (DIP) Violation

**Severity**: HIGH

High-level modules directly depend on concrete implementations:

```typescript
// Direct dependency on concrete class
const rehydrator = new Rehydrator(falkor);
```

**Recommendation**: Use interfaces:
```typescript
interface IRehydrator {
  rehydrate(sessionId: string, targetTime?: number): Promise<VirtualFileSystem>;
}

interface ITimeTravelService {
  getFilesystemState(sessionId: string, targetTime: number): Promise<VirtualFileSystem>;
  listFiles(sessionId: string, targetTime: number, path?: string): Promise<string[]>;
}
```

### 4.3 Open/Closed Principle (OCP) Violation

**Severity**: MEDIUM

**File**: `/Users/ccheney/Projects/the-system/packages/execution-core/src/replay.ts` (lines 171-193)

The `executeTool` method uses a switch statement that must be modified to add new tools:

```typescript
private async executeTool(
	toolName: string,
	args: Record<string, unknown>,
	vfs: VirtualFileSystem,
): Promise<unknown> {
	switch (toolName) {
		case "read_file": { ... }
		case "write_file": { ... }
		case "list_directory": { ... }
		default:
			return { error: `Tool '${toolName}' replay not implemented`, args };
	}
}
```

**Recommendation**: Use a tool registry pattern with extensible handlers.

---

## 5. Dependency Issues

### 5.1 Package Version Mismatch

**File**: `/Users/ccheney/Projects/the-system/apps/execution/package.json`
**Severity**: LOW

```json
"zod": "^3.25.76"
```

This is a very recent version. Consider pinning for stability.

### 5.2 Dockerfile Mismatch

**File**: `/Users/ccheney/Projects/the-system/apps/execution/Dockerfile`
**Severity**: MEDIUM

The Dockerfile uses Bun runtime but the dev script uses tsx:

```dockerfile
# Dockerfile uses bun
FROM oven/bun:1.3.4 AS builder
CMD ["bun", "run", "dist/index.js"]
```

```json
// package.json uses tsx for dev
"dev": "tsx --env-file=.env src/index.ts"
```

This inconsistency could lead to runtime behavior differences between development and production.

### 5.3 Missing Explicit Peer Dependencies

**Severity**: LOW

The execution app depends on `@engram/execution-core`, `@engram/vfs`, etc., but these packages don't declare peer dependencies properly for shared dependencies like `zod`.

---

## 6. Testing Gaps

### 6.1 Missing Tests for Main App

**Severity**: CRITICAL

| Component | Test File | Status |
|-----------|-----------|--------|
| `apps/execution/src/index.ts` | None | **MISSING** |
| `packages/execution-core/src/rehydrator.ts` | `rehydrator.test.ts` | EXISTS |
| `packages/execution-core/src/replay.ts` | `replay.test.ts` | EXISTS |
| `packages/execution-core/src/time-travel.ts` | `time-travel.test.ts` | EXISTS |
| `packages/execution-core/src/errors.ts` | None | **MISSING** |

### 6.2 Test Quality Issues

**File**: `/Users/ccheney/Projects/the-system/packages/execution-core/src/rehydrator.test.ts`
**Line**: 16
**Severity**: LOW

```typescript
let mockFalkorQuery: ReturnType<typeof mock>;  // 'mock' is undefined
```

This appears to be a copy-paste error; should be `vi.fn`.

### 6.3 Missing Integration Tests

**Severity**: HIGH

No tests verify:
- MCP server tool registration
- End-to-end tool invocation
- Error handling paths
- Service lifecycle

---

## 7. Type Safety Issues

### 7.1 Schema Definition Issues

**File**: `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts`
**Severity**: HIGH

The MCP SDK likely expects a specific schema format, but the code bypasses this with `as any`:

```typescript
inputSchema: {
	path: z.string(),
} as any,
```

**Recommendation**: Investigate the correct MCP SDK schema format and use proper typing.

### 7.2 Unsafe Property Access

**File**: `/Users/ccheney/Projects/the-system/packages/execution-core/src/rehydrator.ts`
**Lines**: 24-27
**Severity**: MEDIUM

```typescript
if (snapshots && Array.isArray(snapshots) && snapshots.length > 0) {
	const snap = snapshots[0];
	const blobRef = snap[0] as string;  // Unsafe array access
	lastSnapshotTime = snap[1] as number;  // Unsafe array access
}
```

The query result shape is not validated before access.

### 7.3 Missing Return Types

**Severity**: LOW

Several functions lack explicit return type annotations, relying on inference:

| File | Function | Line |
|------|----------|------|
| `rehydrator.ts` | `rehydrate` | 9 |
| `time-travel.ts` | `getFilesystemState` | 11 |
| `replay.ts` | `executeTool` | 165 |

---

## 8. Error Handling Patterns

### 8.1 Inconsistent Error Handling

| Location | Pattern | Issue |
|----------|---------|-------|
| `index.ts` tools | Return `isError: true` | Good for MCP |
| `rehydrator.ts` | Silent catch | Bad - loses context |
| `time-travel.ts` | Return empty array | Hides errors |
| `replay.ts` | Return error object | Inconsistent with others |

### 8.2 Missing Error Types

**Severity**: MEDIUM

No custom error classes exist. Errors are generic `Error` instances or strings.

**Recommendation**:
```typescript
// errors.ts
export class RehydrationError extends Error {
  constructor(
    message: string,
    public readonly sessionId: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RehydrationError';
  }
}

export class PatchApplicationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PatchApplicationError';
  }
}
```

---

## Metrics Summary

### Before Refactoring

| Metric | Value | Target |
|--------|-------|--------|
| Lines of Code (App) | 131 | - |
| Lines of Code (Core) | ~340 | - |
| Test Coverage (App) | 0% | 80%+ |
| Test Coverage (Core) | ~60% | 80%+ |
| Type Safety Bypasses (`as any`) | 6 | 0 |
| Silent Error Catches | 4 | 0 |
| DRY Violations | 3 | 0 |
| Cyclomatic Complexity (max) | 6 | <10 (OK) |

### After Refactoring (Projected)

| Metric | Current | Projected | Change |
|--------|---------|-----------|--------|
| Lines of Code (App) | 131 | ~200 | +53% (more modular) |
| Files (App) | 1 | 6 | +500% (proper separation) |
| Test Coverage (App) | 0% | 85% | +85% |
| Type Safety Bypasses | 6 | 0 | -100% |
| Silent Error Catches | 4 | 0 | -100% |

---

## Refactoring Roadmap

### Phase 1: Type Safety (Priority: HIGH)
1. Fix MCP SDK schema typing (remove `as any`)
2. Add proper Zod-to-JSON schema conversion if needed
3. Add explicit return types to all public functions

### Phase 2: Error Handling (Priority: HIGH)
1. Create custom error classes
2. Replace silent catches with proper error propagation
3. Add structured logging for errors

### Phase 3: Architecture (Priority: MEDIUM)
1. Extract tool definitions to separate files
2. Implement service container for DI
3. Create tool registry pattern
4. Add configuration module

### Phase 4: Testing (Priority: HIGH)
1. Add unit tests for `index.ts`
2. Add integration tests for MCP tool invocation
3. Add tests for error paths
4. Increase coverage to 80%+

### Phase 5: Polish (Priority: LOW)
1. Remove unused code (`_ReadFileSchema`)
2. Align dev and production runtimes
3. Document API contracts

---

## Architecture Diagram (Target State)

```
apps/execution/
+-------------------+
|     index.ts      |  Entry point
+--------+----------+
         |
         v
+--------+----------+
|    container.ts   |  Dependency injection
+--------+----------+
         |
    +----+----+
    |         |
    v         v
+---+---+ +---+---+
| tools/| |server |
+---+---+ +---+---+
    |
    +---> read-file.ts
    +---> apply-patch.ts
    +---> time-travel.ts
    +---> registry.ts (registers all tools)

packages/execution-core/
+-------------------+
|    rehydrator.ts  |  VFS state reconstruction
+-------------------+
|   time-travel.ts  |  Time-travel queries
+-------------------+
|     replay.ts     |  Deterministic replay
+-------------------+
|     errors.ts     |  Custom error types
+-------------------+
```

---

## References

- `/Users/ccheney/Projects/the-system/apps/execution/src/index.ts` - Main app entry
- `/Users/ccheney/Projects/the-system/packages/execution-core/src/rehydrator.ts` - Rehydration logic
- `/Users/ccheney/Projects/the-system/packages/execution-core/src/time-travel.ts` - Time travel service
- `/Users/ccheney/Projects/the-system/packages/execution-core/src/replay.ts` - Replay engine
- `/Users/ccheney/Projects/the-system/packages/execution-core/src/errors.ts` - Error types (stub)
- `/Users/ccheney/Projects/the-system/packages/vfs/src/vfs.ts` - Virtual filesystem
- `/Users/ccheney/Projects/the-system/packages/vfs/src/patch.ts` - Patch manager
