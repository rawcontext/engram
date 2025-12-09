# Engram

**A bitemporal, graph-backed memory system for AI coding agents.**

Engram captures, persists, and visualizes the complete reasoning trace of AI coding assistants like Claude Code, Codex CLI, and others. Every thought, tool call, file edit, and decision is preserved in a knowledge graph with full temporal history—enabling replay, search, and deep analysis of how AI agents solve problems.

---

## The Vision

When you use an AI coding assistant, valuable context disappears the moment your session ends. Engram changes that.

**What if you could:**
- Watch an AI's reasoning unfold in real-time as it works
- Search across all your past AI sessions semantically
- Time-travel to any point in a session and see the exact file state
- Understand *why* an AI made a particular decision by tracing its thought process
- Build institutional knowledge from how AI agents solve problems in your codebase

Engram makes this possible by treating AI agent sessions as first-class data—streaming events through a processing pipeline, persisting them to a graph database, and exposing them through a beautiful real-time interface called the **Neural Observatory**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLI AGENTS                                      │
│         Claude Code  •  Codex CLI  •  Grok  •  Cline  •  OpenCode           │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP POST /api/ingest
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INGESTION SERVICE                                    │
│  • Provider-specific parsing (8 formats)                                    │
│  • Thinking block extraction (<thinking>...</thinking>)                     │
│  • Diff extraction (search/replace blocks)                                  │
│  • PII redaction (emails, API keys, SSN, credit cards)                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ Kafka: parsed_events
                                   ▼
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│  MEMORY SERVICE │    │   CONTROL SERVICE   │    │  SEARCH SERVICE │
│                 │    │                     │    │                 │
│ • FalkorDB graph│    │ • Session mgmt      │    │ • Qdrant vectors│
│ • Turn aggregation│  │ • Context assembly  │    │ • Hybrid search │
│ • Redis pub/sub │    │ • MCP orchestration │    │ • Reranking     │
│ • Bitemporal    │    │ • Decision engine   │    │ • 4 model tiers │
└────────┬────────┘    └─────────────────────┘    └────────┬────────┘
         │                                                  │
         │ Redis pub/sub                                    │
         ▼                                                  │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NEURAL OBSERVATORY                                    │
│                     (Next.js + WebSocket Streaming)                          │
│                                                                              │
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ Session     │  │ Knowledge Graph     │  │ Thought Stream             │  │
│  │ Browser     │  │ (Force-directed)    │  │ (Timeline + Replay)        │  │
│  └─────────────┘  └─────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Real-Time Event Streaming

Events flow through the system in real-time via **Kafka** (Redpanda) and **Redis pub/sub**. The Neural Observatory connects via WebSocket and displays updates as they happen—no polling, no refresh needed.

```
Agent types → Ingestion → Kafka → Memory → Redis → WebSocket → Browser
```

### Hybrid Search with Reranking

Search isn't just keyword matching. Engram uses a sophisticated multi-stage retrieval pipeline:

1. **Dense vectors** (e5-small) for semantic similarity
2. **Sparse vectors** (BM25/SPLADE) for keyword matching
3. **RRF fusion** combines both strategies
4. **Cross-encoder reranking** with 4 model tiers:

| Tier | Model | Latency | Use Case |
|------|-------|---------|----------|
| `fast` | MiniLM-L-6-v2 | ~50ms | Quick queries |
| `accurate` | BGE-reranker-base | ~150ms | Complex queries |
| `code` | Jina-reranker-v2 | ~150ms | Code-specific |
| `llm` | Grok-4 (listwise) | ~2s | Premium tier |

### Bitemporal Graph Storage

Every node in Engram's knowledge graph has two time dimensions:

- **Valid Time (VT)**: When the event actually occurred
- **Transaction Time (TT)**: When we recorded it

This enables powerful temporal queries: "What did the AI think at 2pm?" or "Show me the file state before that edit."

### Multi-Provider Support

Engram ingests events from multiple AI agent formats:

| Provider | CLI Tool | Format |
|----------|----------|--------|
| `claude_code` | Claude Code | stream-json |
| `codex` | Codex CLI | custom |
| `anthropic` | Anthropic API | SSE |
| `openai` | OpenAI API | SSE |
| `xai` | Grok | SSE |
| `gemini` | Google Gemini | JSON |
| `cline` | Cline Extension | custom |
| `opencode` | OpenCode | custom |

---

## Quick Start

### Prerequisites

- **Node.js** v24+
- **npm** v11+
- **Docker** & Docker Compose

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/engram.git
cd engram
npm install

# Start infrastructure (Redpanda, FalkorDB, Qdrant)
npm run infra:up

# Start all services in dev mode
npm run dev
```

### Verify It's Working

1. **Neural Observatory**: http://localhost:5000
2. **Redpanda Console**: http://localhost:8080
3. **Qdrant Dashboard**: http://localhost:6333/dashboard

### Simulate Traffic

```bash
# Run the traffic generator to create test sessions
npx tsx scripts/traffic-gen.ts
```

---

## Project Structure

```
engram/
├── apps/
│   ├── ingestion/          # Event parsing & normalization
│   ├── memory/             # Graph persistence & pub/sub
│   ├── search/             # Vector search & reranking
│   ├── control/            # Session orchestration
│   ├── execution/          # VFS & time travel
│   └── interface/          # Neural Observatory (Next.js)
├── packages/
│   ├── events/             # Event schemas (Zod)
│   ├── ingestion-core/     # Provider parsers & extractors
│   ├── memory-core/        # Graph models & pruning
│   ├── search-core/        # Embedders & rerankers
│   ├── execution-core/     # Replay & rehydration
│   ├── storage/            # DB clients (Kafka, Redis, FalkorDB, Qdrant)
│   ├── vfs/                # Virtual file system
│   └── logger/             # Pino-based structured logging
├── scripts/
│   └── traffic-gen.ts      # Traffic simulation for testing
└── docker-compose.dev.yml  # Local infrastructure
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Tech Stack](./docs/TECH_STACK.md) | Detailed architecture, data flow, and technology choices |
| [Neural Observatory](./apps/interface/README.md) | Frontend documentation |
| [Ingestion Pipeline](./apps/ingestion/README.md) | Event processing details |
| [Memory Service](./apps/memory/README.md) | Graph schema and persistence |
| [Search Service](./apps/search/README.md) | Hybrid search and reranking |

---

## Services

### Ingestion Service (Port 5001)

Receives raw events from CLI agents, parses them using provider-specific handlers, extracts thinking blocks and diffs, redacts PII, and publishes normalized events to Kafka.

**Kafka Group:** `ingestion-group`
**Topics:** `raw_events` → `parsed_events`

[Read more →](./apps/ingestion/README.md)

### Memory Service (MCP stdio)

Persists parsed events to FalkorDB graph, aggregates streaming events into Turn nodes, publishes real-time updates to Redis, and exposes graph queries via MCP tools.

**Kafka Group:** `memory-group`
**Topics:** `parsed_events` → `memory.node_created`

[Read more →](./apps/memory/README.md)

### Search Service (Port 5002)

Indexes graph nodes into Qdrant vectors, provides hybrid dense+sparse search with RRF fusion, and applies cross-encoder reranking with configurable model tiers.

**Kafka Group:** `search-group`
**Topics:** `memory.node_created`

[Read more →](./apps/search/README.md)

### Control Service

Manages active sessions, assembles context from history and search results, and orchestrates MCP tool calls to execution services.

**Kafka Group:** `control-group`
**Topics:** `parsed_events`

### Execution Service (MCP stdio)

Provides virtual file system operations, time travel to any point in session history, and deterministic replay of tool executions.

### Neural Observatory (Port 5000)

Real-time web interface for visualizing agent sessions. Features session browser, interactive knowledge graph, thought stream timeline, and semantic search.

[Read more →](./apps/interface/README.md)

---

## Kafka Consumer Groups

Engram uses Kafka consumer groups to parallelize processing and ensure exactly-once delivery:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   raw_events    │────▶│  parsed_events  │────▶│ memory.node_    │
│                 │     │                 │     │    created      │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
  ingestion-group         memory-group            search-group
                          control-group
```

Each service publishes heartbeats to Redis every 10 seconds. The Neural Observatory displays consumer health in real-time—green means all consumers are processing, amber means some are down.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services in development mode |
| `npm run build` | Build all apps and packages |
| `npm run test` | Run test suites |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Biome linting |
| `npm run format` | Biome formatting |
| `npm run infra:up` | Start Docker infrastructure |
| `npm run infra:down` | Stop Docker infrastructure |

---

## Infrastructure

Engram runs on three databases, all containerized for local development:

| Service | Port | Purpose |
|---------|------|---------|
| **Redpanda** | 19092 | Kafka-compatible event streaming |
| **FalkorDB** | 6379 | Graph database (Redis-compatible) + Redis pub/sub |
| **Qdrant** | 6333 | Vector database for semantic search |

```bash
# Start infrastructure
npm run infra:up

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop infrastructure
npm run infra:down
```

---

## Contributing

This is a Turborepo monorepo using npm workspaces.

**Code Style:**
- Formatter/Linter: [Biome](https://biomejs.dev/)
- Indentation: Tabs
- Quotes: Double quotes
- Line width: 100 characters

**Workflow:**
1. Create a feature branch
2. Make changes
3. Run `npm run typecheck && npm run lint`
4. Submit PR

---

## License

MIT
