# Memory Service

Knowledge graph persistence and session history management.

## Overview

The Memory Service persists parsed events to the FalkorDB graph database, aggregates them into hierarchical Turn/Reasoning structures, and provides graph query tools via MCP.

## Responsibilities

- Consume parsed events from Kafka (`parsed_events` topic)
- Create/update Session nodes in FalkorDB
- Aggregate events into Turn nodes (hierarchical model)
- Publish graph updates to Redis for real-time WebSocket streaming
- Trigger Search Service indexing via `memory.node_created` topic
- Run pruning jobs to enforce retention policies (default: 30 days)
- Provide MCP tools for graph queries

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `read_graph` | Execute Cypher queries against FalkorDB |
| `get_session_history` | Retrieve session history |

## Dependencies

- `@engram/graph` - GraphPruner for history cleanup
- `@engram/storage` - FalkorDB, Kafka, Redis
- `@engram/logger` - Pino-based logging (stderr for MCP safety)
- `@modelcontextprotocol/sdk` - MCP server framework

## Kafka Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `parsed_events` | Consumer | Normalized events from ingestion |
| `memory.node_created` | Producer | Triggers search indexing |

Consumer group: `memory-group`

## Redis Channels

- Session updates (per-session)
- Global session events

## Transport

Stdio (MCP standard)

## Development

```bash
# From monorepo root
npm run dev --filter=@engram/memory

# Or from this directory
npm run dev
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `RETENTION_DAYS` | Data retention period | `30` |

## Pruning

The service runs automated pruning jobs every 24 hours to enforce retention policies. Nodes older than `RETENTION_DAYS` are removed from the graph.
