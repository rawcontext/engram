# Memory Service

Graph persistence and real-time session management for Engram. Consumes parsed events from NATS, aggregates them into hierarchical graph structures, and provides MCP tools for querying session history.

## Purpose

The Memory Service bridges event streams and persistent graph storage, creating a queryable knowledge graph of agent sessions with real-time updates.

**Core Responsibilities**:
- Consume parsed events from NATS (`parsed_events` topic)
- Aggregate streaming events into Turn-based conversation structures
- Persist Session/Turn/Reasoning/ToolCall nodes to FalkorDB
- Publish real-time graph updates via NATS pub/sub for Observatory UI
- Trigger vector indexing for Search Service
- Prune old sessions based on retention policy
- Expose MCP tools for Cypher queries and session history retrieval

## Key Features

- **Turn Aggregation**: Strategy pattern-based handlers process events into hierarchical structures
- **Bitemporal Graph**: All nodes include `vt_start/vt_end` (valid time) + `tt_start/tt_end` (transaction time)
- **Real-time Updates**: NATS pub/sub for WebSocket streaming to Observatory
- **Search Integration**: Publishes `memory.turn_finalized` events for vector indexing
- **Automatic Cleanup**: Periodic pruning of old sessions and stale turn state
- **MCP Server**: Read-only Cypher queries and session history tools (stdio transport)

## Graph Schema

```
Session (id, user_id, started_at, last_event_at, working_dir, git_remote, agent_type)
  ├─[HAS_TURN]→ Turn (id, user_content, assistant_preview, sequence_index, files_touched, tool_calls_count, tokens)
  │   ├─[HAS_REASONING]→ Reasoning (id, content, sequence_index)
  │   │   └─[TRIGGERS]→ ToolCall (id, call_id, tool_name, file_path, file_action)
  │   └─[HAS_DIFF]→ DiffHunk (id, file_path, hunk_content, line_start, line_end)
  └─[NEXT]→ Turn (links turns in sequence)
```

All nodes include: `vt_start`, `vt_end`, `tt_start`, `tt_end`

## Event Handlers

Turn aggregation delegates to specialized handlers via `EventHandlerRegistry`:

- **ContentEventHandler**: Accumulates assistant text responses
- **ThoughtEventHandler**: Creates Reasoning nodes from extended thinking
- **ToolCallEventHandler**: Creates ToolCall nodes and tracks file operations
- **DiffEventHandler**: Creates DiffHunk nodes for code changes
- **UsageEventHandler**: Finalizes turns with token usage metrics
- **ControlEventHandler**: Handles session control events

## Running

```bash
# Development (from monorepo root)
bun run dev --filter=@engram/memory

# Build
bun run build

# Type checking and linting
bun run typecheck && bun run lint
```

## Configuration

Environment variables (see `.env` symlink):

| Variable | Description | Default |
|----------|-------------|---------|
| `NATS_URL` | NATS connection URL | `nats://localhost:4222` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `RETENTION_DAYS` | Session retention period | `30` |
| `PRUNE_INTERVAL_HOURS` | Pruning job interval | `24` |

## NATS Topics

| Topic | Direction | Description |
|-------|-----------|-------------|
| `parsed_events` | Consumer | Normalized events from ingestion service |
| `memory.turn_finalized` | Producer | Triggers search indexing |
| `memory.dead_letter` | Producer | Failed events for retry/analysis |

**Consumer Group**: `memory-group`

## NATS Pub/Sub Channels

- `session:<session_id>` - Real-time graph node creation events
- `sessions:global` - Session lifecycle events (created, updated)
- `consumer:status` - Consumer health/heartbeat monitoring

## MCP Tools

The service runs as an MCP server on stdio, exposing:

### `read_graph`

Execute read-only Cypher queries against the knowledge graph.

**Parameters**:
- `cypher` (string): Cypher query to execute
- `params` (string, optional): JSON string of query parameters

**Example**:
```json
{
  "cypher": "MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn) RETURN t LIMIT 10",
  "params": "{\"sessionId\": \"abc123\"}"
}
```

### `get_session_history`

Retrieve linear thought history for a session.

**Parameters**:
- `session_id` (string): Session ID to query
- `limit` (number, optional): Max thoughts to return (default: 50)

## Automated Jobs

- **Pruning Job**: Runs every 24 hours to delete sessions older than `RETENTION_DAYS`
- **Turn Cleanup Job**: Runs every 5 minutes to finalize stale turns (inactive 30+ minutes)

## Testing

```bash
bun test --filter=@engram/memory
```

Test files:
- `src/index.test.ts` - Service initialization and MCP tools
- `src/turn-aggregator.test.ts` - Turn aggregation logic
- `src/handlers/handlers.test.ts` - Event handler strategies

## Dependencies

- `@engram/graph` - GraphPruner for retention enforcement
- `@engram/storage` - FalkorDB, NATS, NATS pub/sub clients
- `@engram/logger` - Structured logging (stderr for MCP safety)
- `@engram/events` - Zod schemas for event validation
- `@modelcontextprotocol/sdk` - MCP server framework
