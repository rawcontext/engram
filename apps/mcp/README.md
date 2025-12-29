# @rawcontext/engram-mcp

Long-term memory for AI agents.

## Overview

Engram gives AI agents persistent memory across sessions. Store decisions, preferences, insights, and context that your AI assistant can recall in future conversations.

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

**Cloud** (default): Managed service with OAuth authentication.

**Self-hosted**: Full features including resources, prompts, and graph queries. See [Self-Hosting](#self-hosting).

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

### Self-Hosted Tools

| Tool | Description |
|------|-------------|
| `query` | Run custom queries against your memory graph |
| `context` | Assemble comprehensive context (memories + file history + decisions) for tasks |

## Resources (Self-Hosted)

| URI | Description |
|-----|-------------|
| `memory://{id}` | Individual memory by ID |
| `session://{id}/transcript` | Full conversation transcript |
| `session://{id}/summary` | AI-generated session summary |
| `file-history://{path}` | Change history for a file |

## Prompts (Self-Hosted)

| Prompt | Description |
|--------|-------------|
| `/e prime` | Load context for a new task (searches memories, decisions, file history) |
| `/e recap` | Summarize a past session |
| `/e why` | Investigate past decisions on a topic |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAM_API_URL` | Cloud API | Set to `http://localhost:6174` for self-hosted mode |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |

## Self-Hosting

See the [monorepo](https://github.com/rawcontext/engram) for self-hosting instructions.

## License

AGPL-3.0
