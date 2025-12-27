# Engram Plugin

Claude Code plugin for accessing Engram's bitemporal graph-backed intelligent agent memory system.

## Purpose

Provides custom commands that wrap Engram MCP tools for natural interaction with long-term memory during development sessions. Enables agents to recall past decisions, prime sessions with context, and persist institutional knowledge.

## Features

- **Session Priming**: Initialize work sessions with relevant memories and file history
- **Semantic Search**: Find past decisions, preferences, insights, and facts
- **Decision History**: Trace architectural choices and their rationale
- **Smart Storage**: Persist valuable information with auto-categorization

## Installation

1. Install plugin in Claude Code:
```bash
claude plugins install /Users/ccheney/Projects/the-system/packages/engram-plugin
```

2. Configure MCP server in Claude Code settings:
```json
{
  "mcpServers": {
    "engram": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/the-system/apps/mcp/src/index.ts"],
      "env": {
        "ENGRAM_MODE": "local",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

3. Start Engram infrastructure:
```bash
cd /path/to/the-system
bun run infra:up
```

## Commands

### `/engram:prime [task]`

Initialize session with relevant context from memory.

```bash
/engram:prime implementing search reranking
/engram:prime refactoring graph writer
/engram:prime
```

**Returns**: Past decisions, preferences, insights, and file modification history.

### `/engram:recall <query> [--type=TYPE]`

Search memories using semantic similarity.

```bash
/engram:recall authentication decisions
/engram:recall code style --type=preference
/engram:recall NATS debugging --type=insight
```

**Types**: `decision`, `preference`, `insight`, `fact`

### `/engram:remember <content>`

Store information to long-term memory.

```bash
/engram:remember We chose bitemporal modeling for time-travel queries
/engram:remember Always run typecheck before committing --type=preference
/engram:remember Flaky tests caused by timezone assumptions
```

**Auto-categorizes** based on content patterns if type not specified.

### `/engram:why <topic>`

Find reasoning behind past decisions.

```bash
/engram:why did we choose FalkorDB?
/engram:why bitemporal modeling?
/engram:why NATS over Kafka?
```

## Under the Hood

**MCP Tools Used**:
- `engram_context` - Comprehensive context assembly
- `engram_recall` - Semantic memory search with reranking
- `engram_remember` - Persist memories with deduplication
- `engram_enrich_memory` - Auto-generate metadata

**Storage**: FalkorDB (graph), Qdrant (vectors), NATS (events)

**Bitemporal**: All nodes track valid time (`vt_start/vt_end`) and transaction time (`tt_start/tt_end`) for temporal queries.

## Development

See main project [CLAUDE.md](../../CLAUDE.md) for full architecture and MCP tool reference.

## License

MIT
