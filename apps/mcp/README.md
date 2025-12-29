# @rawcontext/engram-mcp

Model Context Protocol (MCP) server providing intelligent, graph-backed memory for AI agents.

## Overview

Engram MCP enables AI agents to store and retrieve long-term memories across sessions using a bitemporal knowledge graph. It supports cloud-managed and self-hosted deployments with hybrid semantic/keyword search.

## Installation

```bash
npx -y @rawcontext/engram-mcp
```

## Configuration

Add to your MCP client configuration:

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@rawcontext/engram-mcp"]
    }
  }
}
```

### Claude Code / VS Code / Cursor

`.mcp.json` in your project or home directory:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@rawcontext/engram-mcp"]
    }
  }
}
```

On first run, authenticate via browser (OAuth device flow).

## Modes

**Cloud mode** (default): Managed API with OAuth authentication. Core tools available (`remember`, `recall`).

**Local mode**: Self-hosted with full features including resources, prompts, and graph queries. Set `ENGRAM_API_URL=http://localhost:6174` and run infrastructure from the [monorepo](https://github.com/rawcontext/engram).

## Tools

### Core Tools (All Modes)

| Tool | Description |
|------|-------------|
| `remember` | Store long-term memories with categorization (`decision`, `context`, `insight`, `preference`, `fact`) |
| `recall` | Hybrid semantic/keyword search with optional disambiguation and filtering by type, project, or date |

### Sampling Tools (Requires Client LLM Support)

| Tool | Description |
|------|-------------|
| `summarize` | Condense text using client LLM |
| `extract_facts` | Parse unstructured text into atomic facts |
| `enrich_memory` | Auto-generate summary, keywords, and category for memories |

### Local Mode Tools

| Tool | Description |
|------|-------------|
| `query` | Execute read-only Cypher queries against the knowledge graph |
| `context` | Assemble comprehensive context (memories + file history + decisions) for tasks |

## Resources (Local Mode)

| URI | Description |
|-----|-------------|
| `memory://{id}` | Individual memory by ID |
| `session://{id}/transcript` | Full conversation transcript |
| `session://{id}/summary` | AI-generated session summary |
| `file-history://{path}` | Change history for a file |

## Prompts (Local Mode)

| Prompt | Description |
|--------|-------------|
| `/e prime` | Load context for a new task (searches memories, decisions, file history) |
| `/e recap` | Summarize a past session |
| `/e why` | Investigate past decisions on a topic |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAM_API_URL` | `https://api.engram.rawcontext.com` | API URL. Set to `http://localhost:6174` for local mode |
| `ENGRAM_OBSERVATORY_URL` | Auto-detected | Observatory URL for OAuth device flow |
| `MCP_TRANSPORT` | `stdio` | Transport mode (`stdio` or `http`) |
| `MCP_HTTP_PORT` | `3010` | HTTP server port (when using HTTP transport) |
| `LOG_LEVEL` | `info` | Logging level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |

## Local Development

```bash
# Clone the monorepo
git clone https://github.com/rawcontext/engram.git
cd engram

# Install dependencies
bun install

# Start infrastructure (FalkorDB, Qdrant, NATS, PostgreSQL)
bun run infra:up

# Run MCP server in development mode
cd apps/mcp && bun run dev

# Build for production
bun run build

# Type check and lint
bun run typecheck && bun run lint
```

## Architecture

- **Bitemporal Graph**: FalkorDB with valid time (`vt_start`/`vt_end`) and transaction time (`tt_start`/`tt_end`)
- **Hybrid Search**: Dense embeddings (semantic) + BM25 (keyword) via Qdrant
- **Event Streaming**: NATS JetStream for real-time processing
- **Client Capabilities**: Auto-detects sampling, elicitation, roots, resources, and prompts support

## License

AGPL-3.0
