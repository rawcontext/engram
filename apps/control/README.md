# Control

Session orchestration, XState decision engine, VFS, and MCP tool integration.

## Purpose

Control is the central orchestration layer that manages agent sessions and coordinates intelligent responses. It consumes parsed events from NATS, maintains session state using XState finite state machines, and executes a complete reasoning loop including context assembly, AI-powered decision-making, tool execution, and response streaming.

## Key Features

- **Session Management**: Lifecycle tracking with FalkorDB, in-memory DecisionEngine actors per session (1-hour TTL), automatic cleanup
- **XState Decision Engine**: 7-state agent loop (idle → analyzing → deliberating → acting → reviewing → responding → idle) with timeout handling and error recovery
- **Virtual File System (VFS)**: In-memory file operations (read, write, patch), unified diff support, time-travel capabilities, snapshot export
- **Tool Router**: Unified routing combining built-in execution tools (`read_file`, `apply_patch`, `list_files_at_time`, `get_filesystem_snapshot`, `get_zipped_snapshot`) with external MCP tools
- **Context Assembly**: Combines system prompt, recent history (20 thoughts via NEXT chain), and semantic search (top 3 memories from Python search service), with intelligent token pruning (8000 token limit)
- **MCP Integration**: MultiMcpAdapter for connecting to external MCP servers (e.g., Wassette) with dynamic tool discovery

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Control Service                     │
├─────────────────────────────────────────────────────┤
│  SessionManager → DecisionEngine (XState Actor)     │
│       ↓                    ↓                        │
│  SessionInitializer   ContextAssembler              │
│  (FalkorDB)           (History + Search)            │
│                                                     │
│  ToolRouter                                         │
│    ├─ ExecutionService (VFS, time-travel, replay)  │
│    └─ MultiMcpAdapter (external tools)             │
└─────────────────────────────────────────────────────┘
         ↑                               ↓
    NATS (parsed_events)        NATS (heartbeats)
```

## State Machine Flow

```
START → analyzing → deliberating → [requiresTool?]
                         ├─ Yes → acting → reviewing ─┐
                         └─ No ──────────────────────┬─→ responding → idle
                                                     │
                         [error?] → recovering ──────┘
```

## How to Run

```bash
# From monorepo root
bun run dev --filter=@engram/control

# From this directory
bun run dev

# Run tests
bun test

# Type checking
bun run typecheck

# Linting
bun run lint
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NATS_URL` | NATS server URL | `nats://localhost:4222` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `SEARCH_URL` | Python search service URL | `http://localhost:6176` |

## NATS Integration

- **Consumer**: `control-group` consuming `parsed_events` (processes `type: "content"` and `role: "user"` events)
- **Pub/Sub**: Publishes `consumer_ready`, `consumer_heartbeat` (10s interval), `consumer_disconnected`

## Dependencies

**Internal**: `@engram/graph`, `@engram/logger`, `@engram/storage`, `@engram/temporal`, `@engram/vfs`

**External**: `xstate` (v5.25.0), `@ai-sdk/google` (Gemini), `ai` (v5.0.116), `@modelcontextprotocol/sdk` (v1.25.1), `zod` (v4.2.1)

## Configuration

- Session TTL: 1 hour
- Cleanup interval: 5 minutes
- Context token limit: 8000 tokens
- Recent history: 20 thoughts
- Search results: Top 3 memories
- State timeouts: 10s (analyzing), 30s (deliberating, acting)
