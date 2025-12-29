# @rawcontext/engram-mcp

Long-term memory for AI agents.

## Overview

Engram gives AI agents persistent memory across sessions. Store decisions, preferences, insights, and context that your AI assistant can recall in future conversations.

## Installation

<details>
<summary>Claude Code</summary>

```bash
claude mcp add engram -- npx -y @rawcontext/engram-mcp
```

</details>

<details>
<summary>Gemini CLI</summary>

```bash
gemini mcp add engram -- npx -y @rawcontext/engram-mcp
```

</details>

<details>
<summary>Codex CLI</summary>

```bash
codex mcp add engram -- npx -y @rawcontext/engram-mcp
```

</details>

<details>
<summary>OpenCode</summary>

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@rawcontext/engram-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Antigravity</summary>

Click **Agent Session → ⋯ → MCP Servers → Manage MCP Servers → View raw config** and add:

```json
{
  "engram": {
    "command": "npx",
    "args": ["-y", "@rawcontext/engram-mcp"]
  }
}
```

</details>

<details>
<summary>Cursor</summary>

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor" height="32">](https://cursor.com/install-mcp?name=engram&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkByYXdjb250ZXh0L2VuZ3JhbS1tY3AiXX0=)

Or add to `~/.cursor/mcp.json`:

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

<details>
<summary>VS Code</summary>

[<img src="https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32">](https://vscode.dev/redirect/mcp/install?name=engram&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40rawcontext%2Fengram-mcp%22%5D%2C%22env%22%3A%7B%7D%7D)

Or add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rawcontext/engram-mcp"]
    }
  }
}
```

</details>

<details>
<summary>JetBrains (WebStorm, IntelliJ, PyCharm, etc.)</summary>

Go to **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, click **Add**, and configure:

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

<details>
<summary>Visual Studio</summary>

[<img src="https://img.shields.io/badge/Visual_Studio-Install_Server-C16FDE?style=flat-square&logo=visualstudio&logoColor=white" alt="Install in Visual Studio" height="32">](https://vs-open.link/mcp-install?%7B%22name%22%3A%22engram%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40rawcontext%2Fengram-mcp%22%5D%7D)

Or open **GitHub Copilot Chat**, select **Agent** mode, click the tools icon, then **+** to add:
- Server ID: `engram`
- Type: `stdio`
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
