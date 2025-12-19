# Execution Service

> **DEPRECATED**: This standalone MCP server has been merged into the [Control Service](../control/README.md).
> The functionality is now available via `ExecutionService` in `apps/control/src/execution/`.
> This app is kept for backward compatibility but will be removed in a future release.

## Migration

The execution tools (`read_file`, `apply_patch`, `list_files_at_time`) are now integrated directly into the Control Service via `ToolRouter`:

```typescript
import { ExecutionService } from "./execution";
import { ToolRouter } from "./tools/router";

const executionService = new ExecutionService({ graphClient: falkor });
const toolRouter = new ToolRouter(executionService, mcpAdapter);
```

## Why Was This Changed?

Using MCP for internal service-to-service communication was not idiomatic. MCP is designed for AI-to-tool interfaces, not internal RPC. By merging ExecutionService directly into Control:

- Eliminates unnecessary process overhead (no subprocess for VFS operations)
- Removes stdio serialization latency
- Simplifies architecture
- Maintains the same API through `ToolRouter`

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `read_file` | Read file content from the virtual file system |
| `apply_patch` | Apply a unified diff patch to a file |
| `list_files_at_time` | List files at a specific point in time |

## Responsibilities

- Manage VirtualFileSystem in-memory state
- Handle unified diff patch application via PatchManager
- Support temporal queries for historical file state
- Persist session state to FalkorDB via Rehydrator

## Dependencies

- `@engram/temporal` - Rehydrator, TimeTravelService
- `@engram/vfs` - VirtualFileSystem, PatchManager
- `@engram/storage` - FalkorDB graph client
- `@modelcontextprotocol/sdk` - MCP server framework

## Transport

Stdio (MCP standard)

## Development

```bash
# From monorepo root
npm run dev --filter=@engram/execution

# Or from this directory
npm run dev
```

## Integration

This service is designed to be called by AI agents through the MCP protocol. It integrates with the Memory Service for persisting file system state and the Temporal package for time-travel capabilities.
