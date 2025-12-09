# Tech Stack & Architecture

Deep dive into Engram's technology choices, data flow, and system architecture.

---

## Technology Overview

### Runtime & Language

| Technology | Version | Purpose |
|------------|---------|---------|
| **TypeScript** | 5.x | Primary language |
| **Node.js** | 24+ | Runtime for all services |
| **Turborepo** | 2.x | Monorepo build orchestration |
| **npm** | 11+ | Package management |
| **Biome** | Latest | Linting + formatting |

### Databases

| Database | Port | Purpose | Why We Chose It |
|----------|------|---------|-----------------|
| **FalkorDB** | 6379 | Graph storage | Redis-compatible, Cypher queries, fast traversals |
| **Qdrant** | 6333 | Vector search | Named vectors, sparse support, excellent API |
| **Redpanda** | 19092 | Event streaming | Kafka-compatible, simpler ops, faster startup |

### Frontend

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | App Router, RSC, API routes |
| **React 19** | UI components |
| **React Flow** | Knowledge graph visualization |
| **Three.js / R3F** | 3D background effects |
| **SWR** | Data fetching with caching |
| **WebSocket (ws)** | Real-time streaming |

### Backend

| Technology | Purpose |
|------------|---------|
| **MCP SDK** | Model Context Protocol for tool exposure |
| **Zod** | Runtime schema validation |
| **Pino** | Structured logging |
| **ONNX Runtime** | ML model inference (embeddings, reranking) |

---

## Data Flow Architecture

### Event Processing Pipeline

```
                                    ┌─────────────────────────┐
                                    │     CLI AGENTS          │
                                    │  Claude Code, Codex,    │
                                    │  Grok, Cline, etc.      │
                                    └───────────┬─────────────┘
                                                │
                                    POST /api/ingest
                                                │
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            INTERFACE SERVICE                                  │
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │ /api/ingest     │───▶│ Validation      │───▶│ Kafka: raw_events       │  │
│  │ (POST)          │    │ (Zod schema)    │    │                         │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          INGESTION SERVICE                                    │
│                                                                              │
│  ┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────┐  │
│  │ Provider      │──▶│ Thinking      │──▶│ Diff          │──▶│ Redactor  │  │
│  │ Parser        │   │ Extractor     │   │ Extractor     │   │ (PII)     │  │
│  └───────────────┘   └───────────────┘   └───────────────┘   └─────┬─────┘  │
│                                                                      │       │
│                              ┌───────────────────────────────────────┘       │
│                              ▼                                               │
│                    ┌─────────────────────────┐                               │
│                    │ Kafka: parsed_events    │                               │
│                    └─────────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│     MEMORY SERVICE        │  │    CONTROL SERVICE        │  │     (Future: Analytics)   │
│                           │  │                           │  │                           │
│ • Turn aggregation        │  │ • Session management      │  │                           │
│ • FalkorDB persistence    │  │ • Context assembly        │  │                           │
│ • Redis pub/sub           │  │ • MCP orchestration       │  │                           │
│                           │  │                           │  │                           │
│ Output:                   │  │                           │  │                           │
│ • memory.node_created     │  │                           │  │                           │
│ • Redis: session:*        │  │                           │  │                           │
└─────────────┬─────────────┘  └───────────────────────────┘  └───────────────────────────┘
              │
              ▼
┌───────────────────────────┐
│     SEARCH SERVICE        │
│                           │
│ • Vector indexing         │
│ • Qdrant persistence      │
│ • Hybrid retrieval        │
└───────────────────────────┘
```

### Real-Time Streaming Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MEMORY SERVICE                                      │
│                                                                             │
│  Event received ──▶ Persist to FalkorDB ──▶ Publish to Redis               │
│                                                                             │
│  Redis Channels:                                                            │
│  • session:{sessionId}:updates  (per-session events)                       │
│  • sessions:updates             (global session list)                      │
│  • consumers:status             (service heartbeats)                       │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                              Redis Pub/Sub
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INTERFACE SERVICE                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    WebSocket Server (ws)                             │   │
│  │                                                                      │   │
│  │  /api/ws/sessions ────▶ Subscribe to sessions:updates               │   │
│  │  /api/ws/session/:id ─▶ Subscribe to session:{id}:updates           │   │
│  │  /api/ws/consumers ───▶ Subscribe to consumers:status               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                               WebSocket
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER                                           │
│                                                                             │
│  React Hooks:                                                               │
│  • useSessionsStream()   ──▶ Session list updates                          │
│  • useSessionStream()    ──▶ Individual session data                       │
│  • useConsumerStatus()   ──▶ Consumer health monitoring                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Graph Schema (FalkorDB)

### Node Types

```cypher
// Session - Top-level container for an agent session
(:Session {
  id: STRING,              // UUID
  started_at: INTEGER,     // Epoch ms
  last_event_at: INTEGER,  // Epoch ms
  working_dir: STRING,     // Project path
  git_remote: STRING,      // Git remote URL
  agent_type: STRING,      // claude-code, codex, etc.
  user_id: STRING
})

// Turn - A single request/response cycle
(:Turn {
  id: STRING,
  sequence_index: INTEGER,
  user_content: STRING,
  assistant_preview: STRING,
  vt_start: INTEGER,       // Valid time start
  vt_end: INTEGER,         // Valid time end
  tt_start: INTEGER,       // Transaction time start
  tt_end: INTEGER,         // Transaction time end
  files_touched: [STRING]
})

// Reasoning - Extracted thinking blocks
(:Reasoning {
  id: STRING,
  content_hash: STRING,
  preview: STRING,
  reasoning_type: STRING,
  sequence_index: INTEGER
})

// ToolCall - Tool invocation record
(:ToolCall {
  id: STRING,
  call_id: STRING,
  tool_name: STRING,       // Read, Edit, Glob, Bash, etc.
  tool_type: STRING,       // file_read, file_write, search, etc.
  arguments_json: STRING,
  status: STRING           // pending, success, error
})

// FileTouch - File modification record
(:FileTouch {
  id: STRING,
  file_path: STRING,
  action: STRING,          // read, write, create, delete
  lines_added: INTEGER,
  lines_removed: INTEGER
})
```

### Relationships

```cypher
(:Session)-[:HAS_TURN]->(:Turn)
(:Turn)-[:NEXT]->(:Turn)                    // Chronological ordering
(:Turn)-[:HAS_REASONING]->(:Reasoning)
(:Turn)-[:HAS_TOOL_CALL]->(:ToolCall)
(:Reasoning)-[:TRIGGERS]->(:ToolCall)       // Lineage: reasoning led to tool call
(:ToolCall)-[:TOUCHES]->(:FileTouch)
```

### Bitemporal Properties

Every node supports bitemporal queries:

| Property | Description |
|----------|-------------|
| `vt_start` | When the event actually occurred |
| `vt_end` | When the event stopped being valid (MAX_INT if current) |
| `tt_start` | When we recorded this version |
| `tt_end` | When this version was superseded (MAX_INT if current) |

Example query: "What was the file state at 2pm yesterday?"

```cypher
MATCH (t:Turn)-[:HAS_TOOL_CALL]->(tc:ToolCall)-[:TOUCHES]->(f:FileTouch)
WHERE t.vt_start <= $targetTime AND t.vt_end > $targetTime
  AND tc.tool_type = 'file_write'
RETURN f.file_path, tc.arguments_json
ORDER BY t.vt_start DESC
```

---

## Vector Schema (Qdrant)

### Collection: `engram_memory`

```json
{
  "collection_name": "engram_memory",
  "vectors": {
    "text_dense": {
      "size": 384,
      "distance": "Cosine"
    },
    "code_dense": {
      "size": 768,
      "distance": "Cosine"
    },
    "colbert": {
      "size": 128,
      "distance": "Cosine",
      "multivector_config": {
        "comparator": "max_sim"
      }
    }
  },
  "sparse_vectors": {
    "sparse": {}
  }
}
```

### Embedding Models

| Field | Model | Dimensions | Purpose |
|-------|-------|------------|---------|
| `text_dense` | e5-small-v2 | 384 | General text similarity |
| `code_dense` | nomic-embed-text-v1 | 768 | Code-aware embeddings |
| `colbert` | jina-colbert-v2 | 128/token | Late interaction (MaxSim) |
| `sparse` | BM25/SPLADE | Variable | Keyword matching |

### Indexed Payload Fields

```json
{
  "session_id": "keyword",
  "node_type": "keyword",
  "content": "text",
  "created_at": "integer",
  "tool_name": "keyword",
  "file_path": "keyword"
}
```

---

## Search Pipeline

### Query Classification

```typescript
class QueryClassifier {
  classify(query: string): QueryType {
    // Detect code-like patterns
    if (hasCodePatterns(query)) return 'code';

    // Detect simple factual queries
    if (isSimpleQuery(query)) return 'simple';

    // Default to complex
    return 'complex';
  }
}
```

### Retrieval Strategies

| Strategy | Vector Fields | Fusion |
|----------|---------------|--------|
| Dense-only | text_dense | None |
| Sparse-only | sparse | None |
| Hybrid | text_dense + sparse | RRF (k=60) |
| Code | code_dense + sparse | RRF (k=60) |
| ColBERT | colbert | MaxSim |

### Reciprocal Rank Fusion (RRF)

```typescript
function rrf(rankings: Result[][], k: number = 60): Result[] {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const doc = ranking[rank];
      const score = 1 / (k + rank + 1);
      scores.set(doc.id, (scores.get(doc.id) || 0) + score);
    }
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
```

### Reranking Pipeline

```
Query ──▶ Retrieval (top 100) ──▶ Rerank (top 30) ──▶ Final (top 10)
              │                        │
              │                        ▼
              │                 ┌─────────────────┐
              │                 │ Tier Selection  │
              │                 └────────┬────────┘
              │                          │
              ▼                          ▼
     ┌────────────────┐    ┌──────────────────────────┐
     │ Vector Search  │    │ Cross-Encoder Reranking  │
     │ (Qdrant)       │    │                          │
     └────────────────┘    │  fast: MiniLM (~50ms)    │
                           │  accurate: BGE (~150ms)  │
                           │  code: Jina (~150ms)     │
                           │  llm: Grok (~2000ms)     │
                           └──────────────────────────┘
```

### Reranker Configuration

```typescript
// packages/search-core/src/config.ts
export const rerankerConfig = {
  tiers: {
    fast: {
      model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
      maxLatency: 50,
      batchSize: 32
    },
    accurate: {
      model: 'BAAI/bge-reranker-base',
      maxLatency: 150,
      batchSize: 16
    },
    code: {
      model: 'jinaai/jina-reranker-v2-base-multilingual',
      maxLatency: 150,
      batchSize: 16
    },
    llm: {
      model: 'grok-4-1-fast-reasoning',
      maxLatency: 2000,
      maxCandidates: 10,
      rateLimit: { requests: 100, period: 'hour' }
    }
  },
  defaults: {
    enabled: true,
    tier: 'fast',
    depth: 30,
    timeout: 500
  }
};
```

---

## Kafka Topics & Consumer Groups

### Topic Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TOPICS                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  raw_events                    parsed_events              memory.node_created│
│  ───────────                   ──────────────             ──────────────────│
│  • Provider: any               • Type: content/thought/   • Node types:     │
│  • Format: varies                tool_call/diff/usage       Turn, Reasoning,│
│  • Unprocessed                 • Normalized schema          ToolCall        │
│                                • PII redacted             • Ready for index │
│                                                                             │
│  ingestion.dead_letter         memory.dead_letter                           │
│  ─────────────────────         ──────────────────                           │
│  • Failed parsing              • Failed persistence                         │
│  • Schema violations           • Graph errors                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Consumer Group Assignments

| Group | Service | Input Topic | Output Topic |
|-------|---------|-------------|--------------|
| `ingestion-group` | Ingestion | `raw_events` | `parsed_events` |
| `memory-group` | Memory | `parsed_events` | `memory.node_created` |
| `search-group` | Search | `memory.node_created` | — |
| `control-group` | Control | `parsed_events` | — |

### Consumer Health Monitoring

Services publish heartbeats to Redis:

```typescript
// Every 10 seconds
await redis.publishConsumerStatus('consumer_heartbeat', groupId, serviceId);

// On startup
await redis.publishConsumerStatus('consumer_ready', groupId, serviceId);

// On shutdown
await redis.publishConsumerStatus('consumer_disconnected', groupId, serviceId);
```

The Neural Observatory subscribes to `consumers:status` and displays health:

- **Green**: All consumers healthy (heartbeat within 30s)
- **Amber**: Some consumers down
- **Red**: No consumers responding

---

## Provider Parsers

### Supported Formats

| Provider | Event Format | Key Fields |
|----------|--------------|------------|
| `anthropic` | SSE `data: {...}` | `type`, `delta.text`, `content_block` |
| `openai` | SSE `data: {...}` | `choices[0].delta`, `finish_reason` |
| `claude_code` | stream-json | `type`, `message`, `tool_use` |
| `codex` | Custom JSON | `type`, `content`, `tool_calls` |
| `xai` | SSE (OpenAI-like) | `choices[0].delta` |
| `gemini` | JSON | `candidates[0].content` |
| `cline` | Custom | `type`, `text`, `tool` |
| `opencode` | Custom | `event`, `data` |

### Parser Registry Pattern

```typescript
// packages/ingestion-core/src/registry.ts
class ParserRegistry {
  private parsers = new Map<string, Parser>();
  private aliases = new Map<string, string>();

  constructor() {
    // Register parsers
    this.register('anthropic', new AnthropicParser());
    this.register('openai', new OpenAIParser());
    this.register('claude_code', new ClaudeCodeParser());
    // ...

    // Register aliases
    this.alias('claude', 'anthropic');
    this.alias('gpt', 'openai');
    this.alias('grok', 'xai');
  }

  parse(provider: string, payload: unknown): StreamDelta | null {
    const key = this.aliases.get(provider) || provider;
    const parser = this.parsers.get(key);
    return parser?.parse(payload) ?? null;
  }
}
```

---

## Extractors

### BaseTagExtractor Pattern

All extractors inherit from a common base:

```typescript
abstract class BaseTagExtractor {
  abstract openTag: string;
  abstract closeTag: string;
  abstract fieldName: string;

  private buffer = '';
  private inTag = false;

  process(content: string): { content: string; [field: string]: string | undefined } {
    this.buffer += content;

    // State machine for tag extraction
    while (true) {
      if (!this.inTag) {
        const openIdx = this.buffer.indexOf(this.openTag);
        if (openIdx === -1) break;
        this.inTag = true;
        this.buffer = this.buffer.slice(openIdx + this.openTag.length);
      } else {
        const closeIdx = this.buffer.indexOf(this.closeTag);
        if (closeIdx === -1) break;
        const extracted = this.buffer.slice(0, closeIdx);
        this.inTag = false;
        this.buffer = this.buffer.slice(closeIdx + this.closeTag.length);
        return { content: '', [this.fieldName]: extracted };
      }
    }

    return { content: this.inTag ? '' : this.buffer };
  }
}
```

### ThinkingExtractor

```typescript
class ThinkingExtractor extends BaseTagExtractor {
  openTag = '<thinking>';
  closeTag = '</thinking>';
  fieldName = 'thought';
}
```

### DiffExtractor

```typescript
class DiffExtractor extends BaseTagExtractor {
  openTag = '<<<<<<< SEARCH';
  closeTag = '>>>>>>> REPLACE';
  fieldName = 'diff';
}
```

---

## PII Redaction

### Patterns

```typescript
const PII_PATTERNS = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // US SSN
  /\b\d{3}-\d{2}-\d{4}\b/g,

  // Credit card numbers
  /\b(?:\d{4}[- ]?){3}\d{4}\b/g,

  // API keys
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI
  /sk-ant-[a-zA-Z0-9-]{20,}/g,      // Anthropic

  // Phone numbers (international)
  /\+?[\d\s\-().]{10,}/g
];
```

### Replacement Strategy

```typescript
class Redactor {
  redact(content: string): string {
    let result = content;
    for (const pattern of PII_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }
}
```

---

## WebSocket Protocol

### Message Types

**Sessions Endpoint (`/api/ws/sessions`)**

```typescript
// Server → Client
{ type: 'sessions', data: Session[] }
{ type: 'session_created', data: Session }
{ type: 'session_updated', data: Session }

// Client → Server
{ type: 'refresh' }
{ type: 'subscribe' }
```

**Session Endpoint (`/api/ws/session/:id`)**

```typescript
// Server → Client
{ type: 'lineage', data: { nodes: Node[], links: Link[] } }
{ type: 'replay', data: { timeline: TimelineEvent[] } }
{ type: 'update', data: SessionUpdate }

// Client → Server
{ type: 'refresh' }
```

**Consumer Status Endpoint (`/api/ws/consumers`)**

```typescript
// Server → Client
{
  type: 'status',
  data: {
    groups: [{ groupId, stateName, memberCount, isReady }],
    allReady: boolean,
    readyCount: number,
    totalCount: number,
    timestamp: number
  }
}

// Client → Server
{ type: 'refresh' }
```

---

## MCP (Model Context Protocol)

### Memory Service Tools

```typescript
// read_graph - Execute Cypher queries
server.tool('read_graph', {
  cypher: z.string(),
  params: z.string().optional()
});

// get_session_history - Get turn sequence
server.tool('get_session_history', {
  session_id: z.string(),
  limit: z.number().optional()
});
```

### Execution Service Tools

```typescript
// read_file - Read from VFS
server.tool('read_file', {
  path: z.string()
});

// apply_patch - Apply unified diff
server.tool('apply_patch', {
  path: z.string(),
  patch: z.string()
});

// list_files_at_time - Time travel
server.tool('list_files_at_time', {
  session_id: z.string(),
  timestamp: z.number(),
  path: z.string().optional()
});
```

---

## Development Setup

### Environment Variables

```bash
# Required
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
REDPANDA_BROKERS=localhost:19092

# Optional
PORT=5000                    # Interface service
INGESTION_PORT=5001          # Ingestion service
SEARCH_PORT=5002             # Search service
LOG_LEVEL=info               # Pino log level
NODE_ENV=development
```

### Docker Infrastructure

```yaml
# docker-compose.dev.yml
services:
  redpanda:
    image: redpandadata/redpanda:latest
    ports:
      - "19092:19092"   # Kafka API
      - "8080:8080"     # Console
    command:
      - redpanda start
      - --kafka-addr 0.0.0.0:19092
      - --advertise-kafka-addr localhost:19092

  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6379:6379"     # Redis protocol

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"     # HTTP API
      - "6334:6334"     # gRPC API
```

---

## Testing

### Traffic Generator

```bash
# Simulate a realistic agent session
npx tsx scripts/traffic-gen.ts
```

The traffic generator creates:
1. New session with project context
2. Turn 1: User question → thinking → tool calls → response
3. Turn 2: Follow-up with file edits
4. Turn 3: Quick question (minimal tools)
5. Usage event (signals turn completion)

### Manual Testing

```bash
# Send a raw event
curl -X POST http://localhost:5000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-123",
    "ingest_timestamp": "2024-01-01T00:00:00Z",
    "provider": "claude_code",
    "payload": {
      "type": "content",
      "message": { "role": "assistant", "content": "Hello!" }
    }
  }'

# Query the graph
curl -X POST http://localhost:5000/api/graphql \
  -H "Content-Type: application/json" \
  -d '{ "query": "{ sessions { id started_at } }" }'

# Search
curl -X POST http://localhost:5002/search \
  -H "Content-Type: application/json" \
  -d '{ "query": "file editing", "limit": 10, "rerank": true }'
```

---

## Performance Considerations

### Embedding Latency

| Model | Batch Size | Latency (p95) |
|-------|------------|---------------|
| e5-small | 32 | ~20ms |
| nomic-embed | 16 | ~50ms |
| jina-colbert | 8 | ~100ms |

### Reranking Latency

| Tier | Candidates | Latency (p95) |
|------|------------|---------------|
| fast | 30 | ~50ms |
| accurate | 30 | ~150ms |
| code | 30 | ~150ms |
| llm | 10 | ~2000ms |

### Graph Query Optimization

```cypher
// Use indexes for session lookups
CREATE INDEX ON :Session(id)
CREATE INDEX ON :Turn(session_id, sequence_index)

// Limit traversal depth
MATCH (s:Session {id: $id})-[:HAS_TURN]->(t:Turn)
WHERE t.sequence_index >= $start AND t.sequence_index < $end
RETURN t
```

---

## Monitoring

### Health Checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Interface | `GET /api/health` | `200 OK` |
| Ingestion | `GET /health` | `200 OK` |
| Search | `GET /health` | `200 OK` |

### Metrics to Watch

- Kafka consumer lag per group
- Redis pub/sub message rate
- Qdrant index size and query latency
- FalkorDB node/edge counts
- WebSocket connection count

### Logging

All services use structured JSON logging (Pino):

```json
{
  "level": "info",
  "time": 1704067200000,
  "service": "memory-service",
  "component": "turn-aggregator",
  "sessionId": "abc-123",
  "turnIndex": 5,
  "msg": "Turn finalized"
}
```
