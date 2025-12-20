# @engram/mcp

Engram MCP server - intelligent memory for AI agents.

## Quick Start

```bash
npx -y @engram/mcp
```

## Configuration

### Cloud Mode (Recommended)

Connect to Engram Cloud for managed memory storage:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram/mcp"],
      "env": {
        "ENGRAM_API_KEY": "engram_live_xxxx",
        "ENGRAM_API_URL": "https://api.example.com"
      }
    }
  }
}
```

### Local Mode (Development)

Run with local infrastructure (FalkorDB, Qdrant):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram/mcp"],
      "env": {
        "ENGRAM_MODE": "local",
        "FALKORDB_URL": "redis://localhost:6379",
        "QDRANT_URL": "http://localhost:6333"
      }
    }
  }
}
```

Start local infrastructure:

```bash
npm run infra:up
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENGRAM_API_KEY` | API key for cloud mode | - |
| `ENGRAM_API_URL` | Cloud API URL | - |
| `ENGRAM_MODE` | Force mode: `cloud` or `local` | Auto-detected |
| `FALKORDB_URL` | FalkorDB connection (local mode) | `redis://localhost:6379` |
| `QDRANT_URL` | Qdrant connection (local mode) | `http://localhost:6333` |
| `LOG_LEVEL` | Logging level | `info` |

## MCP Tools

### `engram_remember`

Store information in long-term memory.

```json
{
  "content": "User prefers dark mode for all applications",
  "type": "preference",
  "tags": ["ui", "settings"]
}
```

### `engram_recall`

Search memories using natural language.

```json
{
  "query": "user preferences for UI",
  "limit": 5
}
```

### `engram_query` (Local Mode Only)

Execute read-only Cypher queries on the graph.

```json
{
  "cypher": "MATCH (m:Memory) RETURN m.content LIMIT 10"
}
```

### `engram_context` (Local Mode Only)

Get comprehensive context for a task.

```json
{
  "task": "implement authentication",
  "depth": "medium"
}
```

## MCP Resources (Local Mode Only)

| Resource | Description |
|----------|-------------|
| `memory://{id}` | Access individual memories |
| `session://{id}/transcript` | Full session history |
| `session://{id}/summary` | Session summary |
| `file-history://{path}` | File change history |

## MCP Prompts (Local Mode Only)

| Prompt | Description |
|--------|-------------|
| `/e prime` | Load context for a new task |
| `/e recap` | Summarize a past session |
| `/e why` | Understand past decisions |

## Capabilities

The server auto-detects client capabilities and enables:

- **Sampling service** - Request LLM completions from the client
- **Elicitation service** - Request user input mid-operation
- **Roots detection** - Project-scoped queries

## Transport Options

| Transport | Command | Use Case |
|-----------|---------|----------|
| Stdio | `npm run dev` | Claude integration (default) |
| HTTP | `npm run dev:http` | Web clients |

## Development

```bash
# Install dependencies
npm install

# Run in development mode (stdio)
npm run dev

# Run HTTP transport
npm run dev:http

# Build for production
npm run build

# Type check
npm run typecheck
```

## Publishing

The package is automatically published to npm when a tag matching `mcp@*` is pushed:

```bash
git tag mcp@0.1.0
git push --tags
```

Or publish manually:

```bash
npm run build
npm publish --access public
```

## Dependencies

- `@engram/graph` - Graph models and schemas
- `@engram/search` - Semantic search (local mode)
- `@engram/storage` - FalkorDB client (local mode)
- `@modelcontextprotocol/sdk` - MCP framework
- `hono` - HTTP framework

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) in the project root.
