# Engram Architecture

Bitemporal, graph-backed intelligent agent memory system. Captures reasoning traces from AI coding agents into a knowledge graph with full temporal history.

## System Overview

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                      Engram System                          │
                                    └─────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Claude Code │     │    Codex     │     │    Cline     │     │   OpenCode   │     │    Other     │
│    Agent     │     │     CLI      │     │    Agent     │     │    Agent     │     │   Agents     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │                    │
       └────────────────────┴────────────────────┴────────────────────┴────────────────────┘
                                                 │
                                                 ▼
                              ┌──────────────────────────────────────┐
                              │         Ingestion Service            │
                              │              (6175)                  │
                              │  • Provider Parsing (8+ formats)     │
                              │  • Thinking Extraction               │
                              │  • Diff Extraction                   │
                              │  • PII Redaction                     │
                              └──────────────────┬───────────────────┘
                                                 │
                                                 ▼
                              ┌──────────────────────────────────────┐
                              │          NATS JetStream              │
                              │              (6181)                  │
                              │  • EVENTS stream (raw, parsed)       │
                              │  • MEMORY stream (finalized)         │
                              │  • DLQ stream (failures)             │
                              └──────────────────┬───────────────────┘
                                                 │
                       ┌─────────────────────────┼─────────────────────────┐
                       │                         │                         │
                       ▼                         ▼                         ▼
        ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
        │    Memory Service    │  │    Search Service    │  │   Control Service    │
        │                      │  │       (6176)         │  │                      │
        │ • Turn Aggregation   │  │ • Hybrid Retrieval   │  │ • XState Engine      │
        │ • Graph Persistence  │  │ • Multi-tier Rerank  │  │ • VFS Management     │
        │ • Event Publishing   │  │ • Vector Indexing    │  │ • MCP Tool Router    │
        └──────────┬───────────┘  └──────────┬───────────┘  └──────────────────────┘
                   │                         │
                   ▼                         ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │      FalkorDB        │  │        Qdrant        │
        │       (6179)         │  │        (6180)        │
        │  • Graph Storage     │  │  • Vector Storage    │
        │  • Bitemporal Nodes  │  │  • Dense + Sparse    │
        │  • Cypher Queries    │  │  • Collections       │
        └──────────────────────┘  └──────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐     ┌──────────────────────┐
        │     API Service      │     │      Observatory     │
        │       (6174)         │     │        (6178)        │
        │  • REST Endpoints    │     │  • Real-time UI      │
        │  • OAuth Auth        │     │  • WebSocket         │
        │  • Rate Limiting     │     │  • Graph Viz         │
        └──────────────────────┘     └──────────────────────┘
```

## Data Flow

### Event Pipeline

```
1. Agent streams event (SSE/HTTP)
   ↓
2. Ingestion receives raw event
   ↓
3. Parser Registry selects provider parser
   ↓
4. ThinkingExtractor pulls <thinking> blocks
   ↓
5. DiffExtractor detects unified diffs
   ↓
6. Redactor removes PII/secrets
   ↓
7. ParsedStreamEvent published to NATS
   ↓
8. Memory Service consumes event
   ↓
9. TurnAggregator buffers into Turn
   ↓
10. Graph nodes created in FalkorDB
    ↓
11. turn_finalized event triggers indexing
    ↓
12. Search Service embeds and indexes to Qdrant
```

### NATS Topics

| Topic | Stream | Producer | Consumer | Purpose |
|-------|--------|----------|----------|---------|
| `events.raw` | EVENTS | Ingestion | - | Raw provider events |
| `events.parsed` | EVENTS | Ingestion | Memory | Normalized events |
| `memory.turns.finalized` | MEMORY | Memory | Search | Index triggers |
| `memory.nodes.created` | MEMORY | Memory | Observatory | Real-time updates |
| `dlq.ingestion` | DLQ | Ingestion | - | Parse failures |
| `dlq.memory` | DLQ | Memory | - | Persist failures |

### Pub/Sub Channels (Core NATS)

| Channel | Publisher | Subscribers | Purpose |
|---------|-----------|-------------|---------|
| `observatory.session.{id}.updates` | Memory | Observatory | Session events |
| `observatory.sessions.updates` | Memory | Observatory | Global session list |
| `observatory.consumers.status` | All | Observatory | Health monitoring |

## Bitemporal Graph Schema

All nodes track two time dimensions:

- **Valid Time** (`vt_start`, `vt_end`): When the fact was true in reality
- **Transaction Time** (`tt_start`, `tt_end`): When the fact was recorded in the system

### Node Hierarchy

```
Session
├── id, user_id, started_at, working_dir, git_remote, agent_type, summary
│
└─[HAS_TURN]→ Turn
    ├── user_content, assistant_preview, sequence_index, files_touched, tool_calls_count
    ├── input_tokens, output_tokens, cache_read_tokens, reasoning_tokens
    │
    ├─[NEXT]→ Turn (ordering chain)
    │
    ├─[CONTAINS]→ Reasoning
    │   ├── preview, reasoning_type, sequence_index
    │   └─[TRIGGERS]→ ToolCall (causal link)
    │
    └─[INVOKES]→ ToolCall
        ├── call_id, tool_name, tool_type, arguments_json, status
        │
        ├─[YIELDS]→ Observation
        │   └── content, is_error, execution_time_ms
        │
        └─[TOUCHES]→ FileTouch
            └── file_path, action (read|edit|create|delete), diff_preview
```

### Additional Node Types

| Node | Purpose |
|------|---------|
| `Memory` | User-stored memories (decision, context, insight, preference, fact) |
| `DiffHunk` | Unified diff patches with line ranges |
| `CodeArtifact` | Extracted code snippets |
| `Snapshot` | VFS state for time-travel reconstruction |

### Edge Types

| Edge | From | To | Purpose |
|------|------|-----|---------|
| `HAS_TURN` | Session | Turn | Containment |
| `NEXT` | Turn | Turn | Sequence ordering |
| `CONTAINS` | Turn | Reasoning | Thinking blocks |
| `INVOKES` | Turn | ToolCall | Tool executions |
| `TRIGGERS` | Reasoning | ToolCall | Causal chain |
| `TOUCHES` | ToolCall | FileTouch | File operations |
| `YIELDS` | ToolCall | Observation | Execution results |
| `REPLACES` | Node | Node | Version history |
| `SAME_AS` | Node | Node | Deduplication |

### Time-Travel Queries

```cypher
-- What was true at time T? (valid time)
MATCH (t:Turn)
WHERE t.vt_start <= $timestamp AND t.vt_end > $timestamp
  AND t.tt_end = 253402300799000  -- Current knowledge
RETURN t

-- What did we know at time T? (transaction time)
MATCH (t:Turn)
WHERE t.tt_start <= $timestamp AND t.tt_end > $timestamp
RETURN t
```

## Search Pipeline

### Embedders

| Model | Dimensions | Use Case |
|-------|------------|----------|
| BAAI/bge-base-en-v1.5 | 768 | Default dense |
| BAAI/bge-small-en-v1.5 | 384 | Lightweight |
| SPLADE | Sparse | Keyword matching |

### Reranker Tiers

| Tier | Model | Latency | Use Case |
|------|-------|---------|----------|
| `fast` | FlashRank | ~10ms | High-volume filtering |
| `accurate` | BGE Cross-Encoder | ~50ms | Semantic precision |
| `colbert` | ColBERT | ~30ms | Late interaction |
| `code` | Jina Code | ~50ms | Code-specific |
| `llm` | Gemini Flash | ~500ms | High-stakes queries |

### Retrieval Strategies

| Strategy | Description |
|----------|-------------|
| `dense` | Vector similarity only |
| `sparse` | BM25 keyword matching |
| `hybrid` | RRF fusion of dense + sparse |
| `multi_query` | LLM query expansion (DMQR-RAG) |
| `session_aware` | Two-stage hierarchical retrieval |

### Qdrant Collections

| Collection | Contents | Vectors |
|------------|----------|---------|
| `engram_memory` | Stored memories | dense, sparse |
| `engram_turns` | Conversation turns | dense, sparse |

## Turn Aggregation

The Memory Service uses a strategy pattern to process events:

```
ParsedStreamEvent arrives
        ↓
EventHandlerRegistry.getHandler(event.type)
        ↓
┌───────────────────────────────────────────────────┐
│ ContentHandler  → Accumulates user/assistant text │
│ ThoughtHandler  → Creates Reasoning nodes         │
│ ToolCallHandler → Creates ToolCall + edges        │
│ DiffHandler     → Creates DiffHunk nodes          │
│ UsageHandler    → Finalizes turn, triggers index  │
│ ControlHandler  → Session control events          │
└───────────────────────────────────────────────────┘
        ↓
TurnAggregator.finalize()
        ↓
Publish: memory.turns.finalized
```

### Turn Lifecycle

1. **Created**: First user message in sequence
2. **Accumulating**: Content, thoughts, tool calls buffered
3. **Finalized**: Usage event received, graph committed
4. **Indexed**: Search service embeds and stores vectors

## Authentication & Authorization

### OAuth Scopes

| Scope | Endpoints |
|-------|-----------|
| `memory:read` | recall, context |
| `memory:write` | remember |
| `query:read` | Cypher queries |
| `ingest:write` | Event ingestion |
| `keys:manage` | API key management |
| `state:write` | OpenTofu state backend |

### Token Flow

```
1. Client authenticates (OAuth device flow or direct)
2. Token stored in PostgreSQL (api_keys table)
3. Request includes: Authorization: Bearer engram_oauth_xxx
4. API validates token, extracts scopes
5. Rate limiter checks Redis counter
6. Request proceeds or 401/403/429
```

## MCP Integration

### Tools

| Tool | Purpose |
|------|---------|
| `remember` | Store memory with type and tags |
| `recall` | Semantic search with reranking |
| `query` | Read-only Cypher queries |
| `context` | Comprehensive context assembly |
| `summarize` | LLM text condensation |
| `extract_facts` | Parse into atomic facts |
| `enrich_memory` | Auto-generate metadata |

### Resources (Local Mode)

| URI Pattern | Returns |
|-------------|---------|
| `memory://{id}` | Stored memory content |
| `session://{id}/transcript` | Conversation history |
| `file-history://{path}` | File modification timeline |

### Prompts (Local Mode)

| Prompt | Purpose |
|--------|---------|
| `/e prime` | Initialize session with context |
| `/e recap` | Summarize past session |
| `/e why` | Find reasoning for decisions |

## Time-Travel Architecture

### VFS Reconstruction

```
1. Query graph for latest Snapshot before targetTime
2. Load VFS state from blob storage (gzip compressed)
3. Query DiffHunk nodes between snapshot and target
4. Apply patches chronologically via PatchManager
5. Return reconstructed VirtualFileSystem
```

### Components

| Component | Purpose |
|-----------|---------|
| `Rehydrator` | Reconstructs VFS at any timestamp |
| `TimeTravelService` | High-level time-travel API |
| `ReplayEngine` | Re-executes historical tool calls |
| `PatchManager` | Applies unified diffs to VFS |

## Control Service

XState-based decision engine for autonomous agent sessions:

```
┌─────────┐   ┌───────────┐   ┌──────────────┐   ┌─────────┐
│  idle   │ → │ analyzing │ → │ deliberating │ → │ acting  │
└─────────┘   └───────────┘   └──────────────┘   └────┬────┘
     ↑                                                 │
     │         ┌────────────┐   ┌───────────┐         │
     └─────────│ responding │ ← │ reviewing │ ←───────┘
               └────────────┘   └───────────┘
```

### Tool Router

- **Built-in**: read_file, apply_patch, list_files_at_time, get_snapshot
- **External**: MCP tools via MultiMcpAdapter

### Context Assembly

1. Load system prompt
2. Retrieve recent history (20 thoughts via NEXT chain)
3. Semantic search (top 3 memories)
4. Token pruning (8000 token limit)

## Package Dependencies

```
                    ┌─────────────┐
                    │   common    │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │  logger │      │  events │      │ storage │
    └────┬────┘      └────┬────┘      └────┬────┘
         │                │                │
         │                ▼                │
         │          ┌─────────┐            │
         └─────────►│  graph  │◄───────────┘
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ parser │ │temporal│ │  vfs   │
         └────────┘ └────────┘ └────────┘
```

## Infrastructure

### Port Assignments

| Port | Service | Category |
|------|---------|----------|
| 6174 | API | Service |
| 6175 | Ingestion | Service |
| 6176 | Search | Service |
| 6177 | Tuner | Service |
| 6178 | Observatory | Service |
| 6179 | FalkorDB | Database |
| 6180 | Qdrant | Database |
| 6181 | NATS | Database |
| 6182 | NATS Monitor | Dev Tool |
| 6183 | PostgreSQL | Database |
| 6184 | Optuna Dashboard | Dev Tool |

### Production Deployment

- **Hetzner Cloud**: cpx31 (4 vCPU, 8GB RAM)
- **Reverse Proxy**: Caddy with automatic TLS
- **DNS**: Vercel (api.*, observatory.*)
- **State Backend**: Engram API `/v1/tofu` endpoint

## Design Patterns

### Dependency Injection

All services accept optional `Deps` interfaces for testing:

```typescript
interface MemoryServiceDeps {
  graphClient?: GraphClient;
  messageClient?: MessageClient;
  logger?: Logger;
}

function createMemoryService(deps: MemoryServiceDeps = {}) {
  const graphClient = deps.graphClient ?? createFalkorClient();
  // ...
}
```

### Strategy Pattern

- Event handlers in TurnAggregator
- Reranker selection in Search Service
- Provider parsers in Registry

### Circuit Breaker

- Services operate degraded if dependencies unavailable
- Dead letter queues capture failed events
- Automatic retry with exponential backoff

### Bitemporal Versioning

- Every mutation creates new node version
- Old versions linked with REPLACES edge
- Deduplication via content hash and SAME_AS edge
- Full history queryable by valid/transaction time
