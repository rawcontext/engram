# Control Service

Orchestration and state management for agent sessions.

## Overview

The Control Service is the central decision-making engine that processes user inputs and orchestrates multi-tool execution across the Engram system. It uses XState finite state machines to manage session state and coordinates with MCP tool adapters.

## Responsibilities

- Consume parsed events from Kafka (`parsed_events` topic)
- Manage session state using XState state machines
- Coordinate with MCP tool adapters (Wassette + Execution Service)
- Assemble context for agent decision-making
- Publish heartbeats and status to Redis

## Dependencies

- `@engram/graph` - FalkorDB client for graph queries
- `@engram/search` - Context retrieval
- `@engram/storage` - Kafka, Redis, FalkorDB
- `xstate` - State machine management
- `@modelcontextprotocol/sdk` - MCP tool integration
- `@ai-sdk/xai` - AI model integration

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |

## Development

```bash
# From monorepo root
npm run dev --filter=@engram/control

# Or from this directory
npm run dev
```

## Kafka Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `parsed_events` | Consumer | Receives parsed events from ingestion |

Consumer group: `control-group`
