# Execution Service

Virtual file system management and time-travel debugging via MCP.

## Overview

The Execution Service is an MCP server that provides tools for executing code modifications, managing project state, and retrieving historical file snapshots. It maintains an in-memory virtual file system and supports temporal queries.

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
