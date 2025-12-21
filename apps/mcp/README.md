# @engram/mcp

Model Context Protocol (MCP) server providing intelligent, graph-backed memory for AI agents. Supports both cloud-managed and self-hosted deployments with bitemporal knowledge graph storage.

## What It Does

Engram MCP enables AI agents to:
- Store and retrieve long-term memories across sessions
- Search knowledge using natural language queries with semantic search
- Execute read-only graph queries against a knowledge graph
- Access file history, session transcripts, and past decisions
- Get contextually relevant information for new tasks
- Leverage client capabilities (LLM sampling, user prompts, workspace detection)

The server operates in two modes:
- **Cloud mode**: Connect to managed Engram Cloud API
- **Local mode**: Direct connections to FalkorDB graph database and Qdrant vector store

## Quick Start

```bash
npx -y @engram/mcp
```

## Configuration

### Cloud Mode

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

**Note**: In cloud mode, only `engram_remember` and `engram_recall` tools are available. Resources, prompts, and graph queries require local mode.

### Local Mode

Run with local infrastructure (FalkorDB, Qdrant, search service):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "@engram/mcp"],
      "env": {
        "ENGRAM_MODE": "local",
        "FALKORDB_URL": "redis://localhost:6379",
        "QDRANT_URL": "http://localhost:6333",
        "SEARCH_URL": "http://localhost:5002"
      }
    }
  }
}
```

Start local infrastructure from the monorepo root:

```bash
npm run infra:up
```

This starts:
- FalkorDB (graph database) on port 6379
- Qdrant (vector store) on port 6333
- Redpanda (event streaming) on port 9092
- Search service (Python/FastAPI) on port 5002

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENGRAM_API_KEY` | API key for cloud mode | - |
| `ENGRAM_API_URL` | Cloud API URL | - |
| `ENGRAM_MODE` | Force mode: `cloud` or `local` | Auto-detected |
| `FALKORDB_URL` | FalkorDB connection (local mode) | `redis://localhost:6379` |
| `QDRANT_URL` | Qdrant connection (local mode) | `http://localhost:6333` |
| `SEARCH_URL` | Search service URL (local mode) | `http://localhost:5002` |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port (ingest API) | `3010` |
| `LOG_LEVEL` | Logging level | `info` |

**Mode Detection**: If `ENGRAM_API_KEY` is set, cloud mode is used. Otherwise, local mode is used. Set `ENGRAM_MODE` explicitly to override.

## MCP Tools

### Core Tools (All Modes)

#### `engram_remember`

Store information in long-term memory with optional categorization.

**Input**:
```json
{
  "content": "User prefers dark mode for all applications",
  "type": "preference",
  "tags": ["ui", "settings"]
}
```

**Output**:
```json
{
  "id": "01JFXXX...",
  "stored": true,
  "duplicate": false
}
```

**Memory Types**: `decision`, `context`, `insight`, `preference`, `fact`

#### `engram_recall`

Search memories using natural language with hybrid semantic/keyword search.

**Input**:
```json
{
  "query": "user preferences for UI",
  "limit": 5,
  "filters": {
    "type": "preference",
    "project": "my-project",
    "since": "2024-01-01T00:00:00Z"
  },
  "disambiguate": false
}
```

**Output**:
```json
{
  "memories": [
    {
      "id": "01JFXXX...",
      "content": "User prefers dark mode...",
      "score": 0.92,
      "type": "preference",
      "created_at": "2024-06-15T10:30:00Z"
    }
  ],
  "query": "user preferences for UI",
  "count": 1
}
```

**Disambiguation**: When enabled and client supports elicitation, prompts user to select from similar results.

### Sampling-Based Tools (Requires Client Support)

These tools leverage the client's LLM via MCP sampling capability (e.g., VS Code Copilot, Cursor, JetBrains).

#### `engram_summarize`

Summarize text using the client's LLM.

**Input**:
```json
{
  "text": "Long text to summarize...",
  "maxWords": 100
}
```

#### `engram_extract_facts`

Extract key facts from text as a structured list.

**Input**:
```json
{
  "text": "Document containing multiple facts..."
}
```

#### `engram_enrich_memory`

Enrich memory with auto-generated summary, keywords, and category.

**Input**:
```json
{
  "content": "Memory content to enrich..."
}
```

### Local Mode Tools

#### `engram_query`

Execute read-only Cypher queries against the knowledge graph. Supports `MATCH`, `OPTIONAL MATCH`, `WITH`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WHERE`, `UNWIND`, and `CALL`. Write operations (`CREATE`, `MERGE`, `DELETE`, `SET`, etc.) are blocked.

**Input**:
```json
{
  "cypher": "MATCH (m:Memory {type: 'decision'}) RETURN m.content, m.created_at LIMIT 10",
  "params": {}
}
```

**Output**:
```json
{
  "results": [
    { "m.content": "...", "m.created_at": "..." }
  ],
  "count": 10
}
```

#### `engram_context`

Get comprehensive context for a task by searching memories, file history, and decisions.

**Input**:
```json
{
  "task": "implement authentication",
  "files": ["/src/auth/login.ts", "/src/auth/session.ts"],
  "depth": "medium"
}
```

**Depth Options**:
- `shallow`: 3 memories, 2 files
- `medium`: 5 memories, 5 files (default)
- `deep`: 10 memories, 10 files

**Output**:
```json
{
  "context": [
    {
      "type": "decision",
      "content": "Decided to use JWT for authentication",
      "relevance": 0.95,
      "source": "memory:01JFXXX..."
    }
  ],
  "task": "implement authentication",
  "summary": "Found 3 relevant items including authentication decisions..."
}
```

## MCP Resources (Local Mode Only)

Resources provide direct access to graph data via MCP resource URIs.

| Resource URI | Description |
|--------------|-------------|
| `memory://{id}` | Access individual memory by ID |
| `session://{id}/transcript` | Full conversation transcript for a session |
| `session://{id}/summary` | AI-generated summary of a session |
| `file-history://{path}` | Change history for a file path |

**Example**: Reading a memory resource in a client that supports resources.

## MCP Prompts (Local Mode Only)

Prompts are pre-built conversation starters that load relevant context.

### `/e prime`

Load context for starting a new task. Searches memories, decisions, and file history.

**Arguments**:
- `task` (required): Description of the task
- `files` (optional): Comma-separated file paths
- `depth` (optional): `shallow` | `medium` | `deep`

**Example**:
```
/e prime task="add user authentication" files="src/auth.ts,src/db.ts" depth="medium"
```

### `/e recap`

Summarize a past session by ID.

**Arguments**:
- `sessionId` (required): Session ID to recap

### `/e why`

Understand past decisions related to a topic.

**Arguments**:
- `topic` (required): What to investigate
- `limit` (optional): Number of decisions to retrieve

## Client Capabilities

Engram MCP auto-detects client capabilities based on the MCP client name and negotiated features:

| Capability | Description | Supported Clients |
|------------|-------------|-------------------|
| **Sampling** | Server can request LLM completions from client | VS Code Copilot, Cursor, JetBrains |
| **Elicitation** | Server can prompt user for input | VS Code Copilot, Cursor, JetBrains |
| **Roots** | Server can detect workspace/project boundaries | Most clients (Claude Code, Cursor, VS Code, etc.) |
| **Resources** | Client can access graph data via resource URIs | Claude Code, Cline, Cursor, VS Code |
| **Prompts** | Client supports prompt templates | Most clients except Windsurf, JetBrains |

**Known Clients**: VS Code Copilot, Cursor, Claude Code, Codex, Gemini, Windsurf, Zed, JetBrains, Cline

## Transport Modes

### Stdio (Default)

Standard MCP transport for direct client integration (Claude Code, VS Code, Cursor, etc.).

```bash
npm run dev
```

### HTTP Ingest API

The HTTP server provides passive event ingestion endpoints for external hooks. This is separate from the MCP protocol (which uses stdio).

```bash
npm run dev:http
```

**Endpoints**:
- `GET /health` - Health check
- `POST /ingest/event` - Generic event ingestion
- `POST /ingest/tool` - Tool call events
- `POST /ingest/prompt` - User prompt events
- `POST /ingest/session` - Session lifecycle events

**Default Port**: 3010 (configurable via `MCP_HTTP_PORT`)

## How to Build and Run

### Development (Monorepo)

From the monorepo root:

```bash
# Install dependencies
npm install

# Start infrastructure
npm run infra:up

# Run MCP server (stdio)
cd apps/mcp
npm run dev

# Run HTTP ingest server
npm run dev:http
```

### Production Build

```bash
# Build with tsup
npm run build

# Run compiled version (stdio)
npm start

# Run compiled HTTP server
npm run start:http
```

### Type Checking and Linting

```bash
# Type check with tsgo
npm run typecheck

# Lint with Biome
npm run lint

# Format with Biome
npm run format
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

### Runtime Dependencies

- `@engram/graph` - Bitemporal graph models and schemas
- `@engram/logger` - Pino-based structured logging
- `@engram/storage` - FalkorDB client (local mode)
- `@modelcontextprotocol/sdk` - Model Context Protocol SDK
- `@hono/node-server` - HTTP server for ingest API
- `hono` - Web framework for HTTP endpoints
- `ulid` - Unique ID generation
- `zod` - Schema validation

### Development Dependencies

- `@engram/tsconfig` - Shared TypeScript configuration
- `tsup` - Build tool for bundling
- TypeScript 7 (`tsgo`) - Type checking and compilation

## Architecture Notes

- **Bitemporal Graph**: All nodes have `vt_start/vt_end` (valid time) and `tt_start/tt_end` (transaction time) for time-travel queries
- **Hybrid Search**: Combines dense vector embeddings (semantic) with BM25 keyword search for optimal retrieval
- **Memory Storage**: Memories are stored as graph nodes with relationships to sessions, files, and projects
- **Event Streaming**: Integration with Kafka (Redpanda) for real-time event processing in the broader Engram system

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) in the project root.
