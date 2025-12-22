# Control Service

Session orchestration, AI decision-making, and virtual file system management for agent interactions.

## Overview

The Control Service is the central orchestration layer that manages agent sessions and coordinates intelligent responses. It consumes parsed events from Kafka, maintains session state using XState finite state machines, and executes a complete reasoning loop that includes context assembly, AI-powered decision-making, tool execution, and response streaming.

## Key Features

### Session Management
- **Lifecycle tracking**: Automatically creates and manages session nodes in FalkorDB
- **In-memory actors**: One DecisionEngine per active session with 1-hour TTL
- **Automatic cleanup**: Periodic garbage collection of stale session engines
- **Session initialization**: Ensures bitemporal Session nodes exist before processing

### AI Decision Engine (XState)
- **State machine orchestration**: 7-state agent loop (idle → analyzing → deliberating → acting → reviewing → responding → idle)
- **Context assembly**: Combines system prompt, recent history, and relevant memories
- **Tool integration**: Dynamic tool discovery and execution via ToolRouter
- **Error recovery**: Graceful degradation with timeout handling and recovery states
- **Model integration**: Uses Google Gemini-3-flash-preview for thought generation

### Virtual File System (VFS)
- **In-memory file operations**: Read, write, mkdir, patch files
- **Unified diff support**: Apply patches using standard diff format
- **Search/replace**: Simple text replacement operations
- **Time-travel capabilities**: Reconstruct VFS state at any historical point
- **Snapshot export**: Generate complete or zipped filesystem snapshots

### Tool Execution
- **Unified routing**: ToolRouter combines built-in execution tools with external MCP tools
- **Built-in tools**: `read_file`, `apply_patch`, `list_files_at_time`, `get_filesystem_snapshot`, `get_zipped_snapshot`
- **MCP integration**: MultiMcpAdapter for connecting to external MCP servers (e.g., Wassette)
- **Tool replay**: Audit and verify tool executions by replaying them against historical VFS state

### Context Assembly
- **System prompt**: Base instructions for the agent
- **Recent history**: Last 20 thoughts from session using NEXT chain or timestamp ordering
- **Semantic search**: Top 3 relevant memories from other sessions via Python search service
- **Token pruning**: Intelligently truncates context to fit 8000 token limit (priority-based)

### Health Monitoring
- **Redis heartbeats**: 10-second interval heartbeats published to `consumer_heartbeat` channel
- **Consumer status**: Publishes `consumer_ready` on startup, `consumer_disconnected` on shutdown
- **Graceful cleanup**: SIGTERM/SIGINT handlers for proper resource cleanup

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Control Service                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐         ┌─────────────────┐          │
│  │ SessionManager  │────────>│ DecisionEngine  │          │
│  │ (Lifecycle)     │         │ (XState Actor)  │          │
│  └────────┬────────┘         └────────┬────────┘          │
│           │                           │                    │
│           │                           │                    │
│  ┌────────▼─────────┐       ┌────────▼────────┐          │
│  │ SessionInitializ.│       │ ContextAssembler│          │
│  │ (FalkorDB)       │       │ (History+Search)│          │
│  └──────────────────┘       └─────────────────┘          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              ToolRouter                             │  │
│  │  ┌──────────────────────┐  ┌──────────────────┐   │  │
│  │  │ ExecutionService     │  │ MultiMcpAdapter  │   │  │
│  │  │ - VFS operations     │  │ - External tools │   │  │
│  │  │ - Time-travel        │  │ - Tool discovery │   │  │
│  │  │ - Replay engine      │  │                  │   │  │
│  │  └──────────────────────┘  └──────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         ▲                                    │
         │ parsed_events (Kafka)              │ Redis heartbeats
         │                                    ▼
    Ingestion Service                   Redis Pub/Sub
```

## State Machine Flow

```
START → analyzing → deliberating → [requiresTool?]
                                       ├─ Yes → acting → reviewing ──┐
                                       └─ No ─────────────────────────┼→ responding → idle
                                                                      │
                                       [error?] → recovering ────────┘
```

States:
- **idle**: Waiting for user input
- **analyzing**: Fetching context (history + search results)
- **deliberating**: Generating thought and deciding if tools are needed
- **acting**: Executing tool calls via ToolRouter
- **reviewing**: Processing tool outputs, returns to deliberating
- **responding**: Streaming final response to user
- **recovering**: Error handling with graceful degradation

## Tool Execution

### Built-in Execution Tools

| Tool | Description | Inputs |
|:-----|:------------|:-------|
| `read_file` | Read a file from VFS | `path` |
| `apply_patch` | Apply unified diff to file | `path`, `diff` |
| `list_files_at_time` | List VFS files at timestamp | `session_id`, `timestamp`, `path?` |
| `get_filesystem_snapshot` | Get complete VFS snapshot | `session_id`, `timestamp` |
| `get_zipped_snapshot` | Get zipped VFS snapshot | `session_id`, `timestamp` |

### MCP Tool Integration

The MultiMcpAdapter supports connecting to external MCP servers:

```typescript
const wassetteAdapter = new McpToolAdapter(
  `${process.env.HOME}/.local/bin/wassette`,
  ["serve", "--stdio"]
);
multiAdapter.addAdapter(wassetteAdapter);
```

Tools from MCP servers are dynamically discovered and merged with built-in tools.

## Dependencies

### Internal Packages
- `@engram/graph` - Graph models and repositories for FalkorDB
- `@engram/logger` - Structured logging with Pino
- `@engram/storage` - Kafka, Redis, FalkorDB clients
- `@engram/temporal` - Time-travel, rehydration, and replay engines
- `@engram/vfs` - Virtual file system and patch management

### External Libraries
- `xstate` (v5.25.0) - Finite state machine orchestration
- `@ai-sdk/google` - Google AI model integration (Gemini)
- `ai` (v5.0.116) - AI SDK for tool definitions and text generation
- `@modelcontextprotocol/sdk` (v1.25.1) - MCP client for external tools
- `zod` (v4.2.1) - Schema validation for tool inputs

## Configuration

### Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `SEARCH_URL` | Python search service URL | `http://localhost:5002` |

### Tunable Parameters

- **Session TTL**: 1 hour of inactivity (60 * 60 * 1000 ms)
- **Cleanup interval**: 5 minutes (5 * 60 * 1000 ms)
- **Heartbeat interval**: 10 seconds
- **Context token limit**: 8000 tokens
- **Recent history limit**: 20 thoughts
- **Search result limit**: 3 relevant memories
- **State timeouts**: 10s (analyzing), 30s (deliberating, acting)

## Development

```bash
# From monorepo root
bun run dev --filter=@engram/control

# Or from this directory
bun run dev

# Run tests
npm test

# Type checking
bun run typecheck

# Linting
bun run lint
```

## Kafka Integration

### Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `parsed_events` | Consumer | Receives parsed events from ingestion service |

### Consumer Configuration

- **Group ID**: `control-group`
- **Start offset**: `fromBeginning: false` (latest)
- **Event filtering**: Only processes events with `type: "content"` and `role: "user"`

### Event Processing Flow

1. Consume `parsed_events` from Kafka
2. Extract `session_id` from `event.metadata.session_id` or `event.original_event_id`
3. Call `SessionManager.handleInput(sessionId, content)`
4. SessionManager ensures session exists, spawns/reuses DecisionEngine
5. DecisionEngine processes through XState machine
6. Results published to Redis (future: response events back to Kafka)

## Redis Integration

### Channels

- `consumer_ready`: Published on startup
- `consumer_heartbeat`: Published every 10 seconds
- `consumer_disconnected`: Published on shutdown

### Message Format

```typescript
{
  status: "consumer_ready" | "consumer_heartbeat" | "consumer_disconnected",
  group_id: "control-group",
  service_name: "control-service",
  timestamp: Date.now()
}
```

## Testing

The service includes comprehensive unit tests for all major components:

- `SessionManager`: Session lifecycle, TTL cleanup, engine reuse
- `DecisionEngine`: State machine transitions, tool execution, error recovery
- `ToolRouter`: Tool routing logic, execution/MCP dispatch
- `ContextAssembler`: Context assembly, token pruning, search integration
- `ExecutionService`: VFS operations, time-travel, replay
- `SessionInitializer`: Session creation, idempotency

```bash
npm test -- --filter=@engram/control
```

## Future Enhancements

- Streaming responses to Kafka/Redis for real-time client updates
- Support for multi-turn tool conversations with refined prompts
- Enhanced error recovery with automatic retry and model fallback
- Metrics and observability integration (Prometheus/Grafana)
- Session persistence and restoration across service restarts
