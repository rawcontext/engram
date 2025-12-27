# @engram/mcp

Model Context Protocol (MCP) server providing intelligent, graph-backed memory for AI agents.

## Purpose

Engram MCP enables AI agents to store and retrieve long-term memories across sessions using a bitemporal knowledge graph. It supports cloud-managed and self-hosted deployments with hybrid semantic/keyword search.

## Quick Start

Add to your `.mcp.json` (Claude Code, VS Code, Cursor):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram/mcp"]
    }
  }
}
```

On first run, authenticate via browser (OAuth device flow).

## Modes

**Cloud mode** (default): Managed API with OAuth authentication. Only `remember` and `recall` tools available.

**Local mode**: Self-hosted with full features (resources, prompts, graph queries). Set `ENGRAM_API_URL=http://localhost:6174` and run `bun run infra:up` from monorepo root.

## MCP Tools

### Core Tools (All Modes)

**`remember`** - Store long-term memories with categorization (`decision`, `context`, `insight`, `preference`, `fact`)

**`recall`** - Hybrid semantic/keyword search with optional disambiguation and filtering (by type, project, date)

### Sampling Tools (Requires Client LLM)

**`summarize`** - Condense text using client LLM
**`extract_facts`** - Parse unstructured text into atomic facts
**`enrich_memory`** - Auto-generate summary, keywords, and category

### Local Mode Tools

**`query`** - Execute read-only Cypher queries against knowledge graph
**`context`** - Assemble comprehensive context (memories + file history + decisions) for tasks

## MCP Resources (Local Mode)

- `memory://{id}` - Individual memory by ID
- `session://{id}/transcript` - Full conversation transcript
- `session://{id}/summary` - AI-generated session summary
- `file-history://{path}` - Change history for a file

## MCP Prompts (Local Mode)

- `/e prime` - Load context for new task (searches memories, decisions, file history)
- `/e recap` - Summarize a past session
- `/e why` - Investigate past decisions on a topic

## Development

```bash
bun install                    # Install dependencies (monorepo root)
bun run infra:up              # Start local infrastructure (FalkorDB, Qdrant, NATS, Search)
cd apps/mcp && bun run dev    # Run MCP server (stdio)
bun run build                 # Build for production
bun run typecheck && bun run lint  # Type check and lint
```

## Configuration

- `ENGRAM_API_URL` - API URL (default: `https://api.statient.com`, set to `http://localhost:6174` for local mode)
- `LOG_LEVEL` - Logging level (default: `info`)
- `MCP_TRANSPORT` - Transport mode (default: `stdio`, or `http`)

## Architecture

- **Bitemporal Graph**: FalkorDB with `vt_start/vt_end` (valid time) and `tt_start/tt_end` (transaction time)
- **Hybrid Search**: Dense embeddings (semantic) + BM25 (keyword) via Qdrant and Python search service
- **Event Streaming**: NATS JetStream integration for real-time processing
- **Client Capabilities**: Auto-detects sampling, elicitation, roots, resources, and prompts support

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@engram/graph` - Bitemporal graph models
- `@engram/logger` - Structured logging (Pino)
- `zod` - Schema validation

## License

AGPL-3.0
