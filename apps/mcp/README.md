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

On first run, authenticate via browser.

## Tools

| Tool | Description |
|------|-------------|
| `remember` | Store memories with categorization (`decision`, `insight`, `preference`, `fact`) |
| `recall` | Search memories with semantic and keyword matching |
| `context` | Assemble comprehensive context for a task |
| `query` | Run custom queries against your memory graph |
| `summarize` | Condense text into key points |
| `extract_facts` | Parse text into atomic facts |
| `enrich_memory` | Auto-generate summary, keywords, and category |

## Resources

| URI | Description |
|-----|-------------|
| `memory://{id}` | Individual memory by ID |
| `session://{id}/transcript` | Full conversation transcript |
| `session://{id}/summary` | Session summary |
| `file-history://{path}` | Change history for a file |

## Prompts

| Prompt | Description |
|--------|-------------|
| `/engram:session-prime` | Load context for a new task |
| `/engram:session-recap` | Summarize a past session |
| `/engram:decision-history` | Investigate past decisions on a topic |

## Self-Hosting

See the [monorepo](https://github.com/rawcontext/engram) for self-hosting instructions.

## License

AGPL-3.0
