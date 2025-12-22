# Memory Service

Knowledge graph persistence and real-time session management for the Engram system.

## Overview

The Memory Service consumes parsed events from Kafka, aggregates them into hierarchical graph structures (Sessions → Turns → Reasoning/ToolCalls), persists them to FalkorDB, and provides real-time updates via Redis pub/sub. It also exposes MCP tools for graph querying and session history retrieval.

## Key Features

- **Event Aggregation**: Streams events into Turn-based conversation structures using the Strategy pattern
- **Graph Persistence**: Creates and manages Session, Turn, Reasoning, ToolCall, and DiffHunk nodes in FalkorDB
- **Real-time Updates**: Publishes graph node creation events to Redis for WebSocket streaming
- **Search Integration**: Triggers vector indexing via Kafka topic `memory.node_created`
- **Automatic Cleanup**: Periodic pruning of old sessions and stale turn aggregation state
- **MCP Server**: Provides tools for graph queries and session history retrieval

## Architecture

### Event Processing Pipeline

1. **Kafka Consumer**: Subscribes to `parsed_events` topic with consumer group `memory-group`
2. **Turn Aggregator**: Aggregates streaming events into conversation turns using specialized handlers:
   - `ContentEventHandler`: Accumulates assistant text responses
   - `ThoughtEventHandler`: Creates Reasoning nodes from extended thinking
   - `ToolCallEventHandler`: Creates ToolCall nodes and tracks file operations
   - `DiffEventHandler`: Creates DiffHunk nodes for code changes
   - `UsageEventHandler`: Finalizes turns with token usage metrics
   - `ControlEventHandler`: Handles session control events
3. **Graph Writer**: Persists nodes and relationships to FalkorDB with bitemporal fields
4. **Redis Publisher**: Broadcasts node creation events for real-time UI updates
5. **Search Trigger**: Sends `memory.node_created` events to trigger vector indexing

### Graph Schema

```
Session (id, user_id, started_at, last_event_at, working_dir, git_remote, agent_type)
  ├─[HAS_TURN]→ Turn (id, user_content, assistant_preview, sequence_index, files_touched, tool_calls_count, input_tokens, output_tokens)
  │   ├─[HAS_REASONING]→ Reasoning (id, content, sequence_index)
  │   │   └─[TRIGGERS]→ ToolCall (id, call_id, tool_name, tool_type, arguments_json, file_path, file_action)
  │   └─[HAS_DIFF]→ DiffHunk (id, file_path, hunk_content, line_start, line_end)
  └─[NEXT]→ Turn (links turns in sequence)
```

All nodes include bitemporal fields: `vt_start`, `vt_end`, `tt_start`, `tt_end`

## Running the Service

### Development Mode

```bash
# From monorepo root
bun run dev --filter=@engram/memory

# From apps/memory directory
bun run dev
```

### Build

```bash
bun run build
```

### Type Checking and Linting

```bash
bun run typecheck
bun run lint
bun run format
```

## Configuration

Environment variables (loaded from `.env` in monorepo root):

| Variable | Description | Default |
|:---------|:------------|:--------|
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `RETENTION_DAYS` | Session retention period (days) | `30` |
| `PRUNE_INTERVAL_HOURS` | Interval between pruning jobs (hours) | `24` |

## Kafka Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `parsed_events` | Consumer | Normalized events from ingestion service |
| `memory.node_created` | Producer | Triggers search service to index new nodes |
| `memory.dead_letter` | Producer | Failed events for later analysis/retry |

**Consumer Group**: `memory-group`

## Redis Pub/Sub

### Channels

- **Session Updates**: `session:<session_id>` - Real-time graph node creation events
- **Global Sessions**: `sessions:global` - Session lifecycle events (created, updated)
- **Consumer Status**: `consumer:status` - Health and heartbeat monitoring

### Published Events

```typescript
// Session-specific updates
{
  type: "graph_node_created",
  data: {
    id: string,
    nodeType: "turn" | "reasoning" | "toolcall" | "diffhunk",
    label: string,
    properties: Record<string, unknown>,
    timestamp: string
  }
}

// Global session events
{
  type: "session_created",
  data: {
    id: string,
    userId: string,
    startedAt: number,
    lastEventAt: number,
    eventCount: number,
    isActive: boolean
  }
}
```

## MCP Tools

The service runs as an MCP server on stdio transport, exposing two tools:

### `read_graph`

Execute read-only Cypher queries against the knowledge graph.

**Parameters**:
- `cypher` (string): The Cypher query to execute
- `params` (string, optional): JSON string of query parameters

**Example**:
```typescript
{
  "cypher": "MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn) RETURN t LIMIT 10",
  "params": "{\"sessionId\": \"abc123\"}"
}
```

### `get_session_history`

Retrieve the linear thought history for a session.

**Parameters**:
- `session_id` (string): The session ID to query
- `limit` (number, optional): Maximum number of thoughts to return (default: 50)

**Returns**: Array of Thought nodes ordered by `vt_start` timestamp

## Automated Jobs

### Pruning Job

Runs every 24 hours (configurable via `PRUNE_INTERVAL_HOURS`) to delete sessions older than `RETENTION_DAYS`.

### Turn Cleanup Job

Runs every 5 minutes to finalize stale turns that have been inactive for 30+ minutes. This prevents memory leaks from abandoned sessions.

## Dependencies

- `@engram/graph` - GraphPruner for retention policy enforcement
- `@engram/storage` - FalkorDB, Kafka, Redis clients
- `@engram/logger` - Pino-based structured logging (stderr for MCP safety)
- `@engram/events` - Zod schemas for ParsedStreamEvent validation
- `@modelcontextprotocol/sdk` - MCP server framework (stdio transport)
- `zod` - Runtime type validation

## Testing

```bash
npm test
```

Test files:
- `src/index.test.ts` - Service initialization and MCP tools
- `src/turn-aggregator.test.ts` - Turn aggregation logic
- `src/handlers/handlers.test.ts` - Event handler strategies

## Error Handling

- **Persistence Errors**: Failed events are sent to `memory.dead_letter` topic with error context
- **Handler Errors**: Logged but do not block other handlers from processing the same event
- **Finalization Errors**: Turn finalization failures are retried on next cleanup cycle
- **Graceful Shutdown**: SIGTERM/SIGINT handlers ensure clean Kafka consumer disconnect

## Monitoring

The service publishes consumer status events to Redis:
- `consumer_ready` - On successful subscription to `parsed_events`
- `consumer_heartbeat` - Every 10 seconds
- `consumer_disconnected` - On graceful shutdown

## Development Notes

- Use `createMemoryServiceDeps()` factory for dependency injection in tests
- All graph mutations include bitemporal fields (`vt_start`, `tt_start`)
- Turn aggregation uses in-memory state (`activeTurns` Map) - stateless design allows horizontal scaling
- Handlers follow Strategy pattern - register custom handlers via `EventHandlerRegistry`
- MCP server logs to stderr (file descriptor 2) to avoid interfering with stdio transport
