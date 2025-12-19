# Execution Service

Internal MCP server for virtual file system management and time-travel debugging.

## Overview

The Execution Service is an **internal** MCP server used by the [Control Service](../control/README.md) to orchestrate file operations. It provides tools for reading files, applying patches, and retrieving historical file snapshots from the virtual file system.

> **Note:** This is not the MCP server that AI agents connect to directly. For AI agent integration, see [apps/mcp](../mcp/README.md).

## How It Fits

```
AI Agent (Claude Code)
    │
    ▼
Control Service ──MCP──▶ Execution Service
    │                         │
    │                         ├── read_file
    │                         ├── apply_patch
    │                         └── list_files_at_time
    │
    └──MCP──▶ Engram MCP Server (apps/mcp)
                   │
                   ├── remember
                   ├── recall
                   └── query
```

The Control Service uses Execution for VFS operations while the agent uses the main MCP server for memory operations.

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
