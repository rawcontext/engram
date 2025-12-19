# MCP Server

Model Context Protocol gateway exposing Engram capabilities to AI models.

## Overview

The MCP Server is the primary integration point for Claude and other AI models. It provides memory management, semantic search, and capability-aware tool registration through the Model Context Protocol.

## MCP Tools

| Tool | Description |
|:-----|:------------|
| `remember` | Persist information to memory |
| `recall` | Retrieve relevant memories |
| `query` | Execute semantic search queries |
| `context` | Get contextual information |

## MCP Resources

- Session memory
- File history
- Session details

## MCP Prompts

| Prompt | Description |
|:-------|:------------|
| `e-prime` | E-Prime reasoning frame |
| `e-recap` | Recap reasoning frame |
| `e-why` | Why reasoning frame |

## Capabilities

- Sampling service
- Elicitation service
- Roots detection

## Dependencies

- `@engram/graph` - FalkorDB client
- `@engram/search` - Semantic search
- `@engram/storage` - Data access
- `@modelcontextprotocol/sdk` - MCP framework
- `hono` - HTTP framework (for HTTP transport)

## Transport Options

| Transport | Command | Use Case |
|:----------|:--------|:---------|
| Stdio | `npm run dev` | Claude integration (default) |
| HTTP | `npm run dev:http` | Web clients |

## Development

```bash
# Stdio transport (for Claude)
npm run dev

# HTTP transport
npm run dev:http
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `QDRANT_URL` | Qdrant connection URL | `http://localhost:6333` |

## Integration with Claude Code

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["path/to/apps/mcp/dist/index.js"]
    }
  }
}
```
