# Control Service

Orchestration and state management for agent sessions.

## Overview

The Control Service is the central decision-making engine that processes user inputs and orchestrates multi-tool execution across the Engram system. It uses XState finite state machines to manage session state, provides VFS operations and time-travel capabilities, and coordinates tool execution through a unified `ToolRouter`.

## Responsibilities

- Consume parsed events from Kafka (`parsed_events` topic)
- Manage session state using XState state machines
- Provide VFS operations (read, write, patch files)
- Enable time-travel to any point in session history
- Coordinate with external MCP tools
- Assemble context for agent decision-making
- Publish heartbeats and status to Redis

## Architecture

```
Control Service
├── ToolRouter                     # Unified tool dispatch
│   ├── read_file                  # VFS read
│   ├── apply_patch                # VFS patch
│   ├── list_files_at_time         # Time-travel query
│   └── [external MCP tools]       # Future extensibility
│
├── SessionManager                 # Session lifecycle
│   └── DecisionEngine (XState)    # AI decision making
│
└── ContextAssembler               # Context building
```

## Dependencies

- `@engram/graph` - FalkorDB client for graph queries
- `@engram/search` - Context retrieval
- `@engram/storage` - Kafka, Redis, FalkorDB
- `@engram/temporal` - Time-travel and rehydration
- `@engram/vfs` - Virtual file system
- `xstate` - State machine management
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
