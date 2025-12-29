# @rawcontext/engram-mcp

Long-term memory for AI agents.

## Overview

Engram gives AI agents persistent memory across sessions. Store decisions, preferences, insights, and context that your AI assistant can recall in future conversations.

## Installation

<details>
<summary>Claude Code</summary>

```bash
claude mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>Gemini CLI</summary>

```bash
gemini mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>Codex CLI</summary>

```bash
codex mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>OpenCode</summary>

```bash
opencode mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>Antigravity</summary>

```bash
antigravity mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>Cursor</summary>

```bash
cursor mcp add engram npx @rawcontext/engram-mcp
```

</details>

<details>
<summary>VS Code</summary>

```bash
code --add-mcp '{"name":"engram","command":"npx","args":["-y","@rawcontext/engram-mcp"]}'
```

</details>

<details>
<summary>JetBrains (WebStorm, IntelliJ, etc.)</summary>

Go to **Settings → Tools → AI Assistant → Model Context Protocol (MCP)** and add:

```json
{
  "servers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@rawcontext/engram-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Visual Studio</summary>

Go to **Tools → Options → GitHub Copilot → MCP Servers** and add a new server:
- Name: `engram`
- Command: `npx`
- Args: `-y @rawcontext/engram-mcp`

</details>

<details>
<summary>Manual Configuration</summary>

Add to your MCP config file:

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

</details>

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

## License

AGPL-3.0
