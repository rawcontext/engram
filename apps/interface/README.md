# Neural Observatory

**Real-time visualization of AI agent reasoning, memory, and behavior.**

The Neural Observatory is Engram's frontend interface—a Next.js application that provides live streaming views into AI coding agent sessions. Watch thoughts unfold, explore knowledge graphs, and search across session history as agents like Claude Code, Codex, and others work through problems.

> Part of the [Engram](../../README.md) system. See [Tech Stack](../../docs/TECH_STACK.md) for architecture details.

---

## What You'll See

### Session Browser
Browse active and historical sessions. Live sessions pulse green; recent sessions show amber indicators. Click any session to dive into its reasoning trace.

### Knowledge Graph
Interactive force-directed visualization of the session's reasoning structure:
- **Session** (silver) → **Turn** (amber) → **Reasoning** (cyan) → **ToolCall** (violet)
- Click nodes for details, hover to highlight parent chains
- Pan, zoom, and minimap navigation

### Thought Stream
Timeline view of the agent's work:
- User queries with syntax highlighting
- Collapsible `<thinking>` blocks showing internal reasoning
- Tool calls with status, file paths, and arguments
- Assistant responses with token counts

### Semantic Search
Find anything across all sessions:
- Paste a session ID to navigate directly
- Type 3+ characters for semantic search
- Results ranked by hybrid vector + keyword matching
- Optional cross-encoder reranking with 4 model tiers

### System Status
Footer displays real-time consumer group health:
- Green pulse: All services healthy
- Amber: Some services down
- Red: Services offline

---

## Architecture

```
Browser ◄──WebSocket──► Interface Server ◄──Redis Pub/Sub──► Memory Service
                              │
                              ├── /api/ws/sessions     (session list updates)
                              ├── /api/ws/session/:id  (per-session streaming)
                              └── /api/ws/consumers    (health monitoring)
```

### Why Custom WebSocket Server?

Next.js API routes don't support WebSocket upgrades. We wrap Next.js in a custom HTTP server (`server.ts`) that:
1. Handles WebSocket upgrades on `/api/ws/*` paths
2. Passes all other requests to Next.js
3. Maintains persistent Redis subscriptions

### Real-Time Data Flow

1. **Memory Service** persists events to FalkorDB and publishes to Redis
2. **Redis channels** organized by session: `session:{id}:updates`, `sessions:updates`, `consumers:status`
3. **WebSocket server** subscribes to Redis and broadcasts to connected clients
4. **React hooks** manage WebSocket lifecycle and update UI state

```typescript
// Example: Subscribe to session updates
const { lineage, replay, isConnected } = useSessionStream({ sessionId });

// lineage: { nodes: Node[], links: Link[] }  - for graph visualization
// replay: { timeline: Event[] }               - for thought stream
```

---

## Local Development

### Prerequisites

- Node.js 24+
- Running infrastructure (`npm run infra:up` from monorepo root)

### Setup

```bash
# From monorepo root
npm install
npm run infra:up

# Start just the interface
cd apps/interface
npm run dev
```

Open http://localhost:5000

### Environment Variables

Create `.env`:

```bash
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
REDPANDA_BROKERS=localhost:19092
PORT=5000
```

### Generate Test Data

```bash
# From monorepo root
npx tsx scripts/traffic-gen.ts
```

---

## Project Structure

```
apps/interface/
├── server.ts                 # Custom HTTP + WebSocket server
├── app/
│   ├── page.tsx              # Homepage (session browser)
│   ├── session/[id]/
│   │   └── page.tsx          # Session detail page
│   └── api/
│       ├── ingest/route.ts   # Event ingestion endpoint
│       ├── search/route.ts   # Semantic search
│       ├── sessions/route.ts # Session list
│       └── graphql/route.ts  # GraphQL queries
├── components/
│   ├── LineageGraph/         # Force-directed graph (React Flow)
│   ├── SessionReplay/        # Timeline component
│   ├── SessionBrowser.tsx    # Session cards
│   ├── SearchInput.tsx       # Search bar
│   ├── SearchSettings.tsx    # Reranker configuration
│   └── shared/
│       ├── SystemFooter.tsx  # Consumer status
│       └── design-tokens.ts  # Design system
├── hooks/
│   ├── useSessionStream.ts   # Per-session WebSocket
│   ├── useSessionsStream.ts  # Session list WebSocket
│   ├── useConsumerStatus.ts  # Consumer health WebSocket
│   └── useSearch.ts          # Search with debouncing
└── lib/
    ├── websocket-server.ts   # WebSocket handlers
    └── graph-queries.ts      # FalkorDB Cypher queries
```

---

## WebSocket Endpoints

### `/api/ws/sessions`

Global session list updates.

**Server → Client:**
```typescript
{ type: 'sessions', data: Session[] }
{ type: 'session_created', data: Session }
{ type: 'session_updated', data: Session }
```

### `/api/ws/session/:id`

Per-session streaming.

**Server → Client:**
```typescript
{ type: 'lineage', data: { nodes, links } }   // Initial graph
{ type: 'replay', data: { timeline } }        // Initial timeline
{ type: 'update', data: SessionUpdate }       // Real-time updates
```

### `/api/ws/consumers`

Consumer group health (event-driven via Redis, not polling).

**Server → Client:**
```typescript
{
  type: 'status',
  data: {
    groups: [{ groupId, stateName, memberCount, isReady }],
    allReady: boolean,
    readyCount: number,
    totalCount: number
  }
}
```

---

## Search Configuration

### Reranker Tiers

| Tier | Model | Latency | Best For |
|------|-------|---------|----------|
| `fast` | MiniLM-L-6-v2 | ~50ms | Quick lookups |
| `accurate` | BGE-reranker-base | ~150ms | Complex queries |
| `code` | Jina-reranker-v2 | ~150ms | Code search |
| `llm` | Grok-4 listwise | ~2s | Premium results |

### Search Settings UI

Click the settings icon next to the search bar to configure:
- Enable/disable reranking
- Select reranker tier
- Adjust rerank depth (candidates to consider)

---

## Graph Schema

The knowledge graph rendered in the UI follows this structure:

```
Session -[HAS_TURN]-> Turn -[NEXT]-> Turn
                        |
                        +--[HAS_REASONING]-> Reasoning
                        |
                        +--[HAS_TOOL_CALL]-> ToolCall

Reasoning -[TRIGGERS]-> ToolCall  (lineage edge)
```

### Node Properties

| Node | Key Fields |
|------|------------|
| **Session** | `id`, `started_at`, `last_event_at`, `agent_type` |
| **Turn** | `sequence_index`, `user_content`, `assistant_preview` |
| **Reasoning** | `preview`, `reasoning_type` |
| **ToolCall** | `tool_name`, `tool_type`, `status`, `file_path` |

---

## Troubleshooting

### WebSocket won't connect

1. Ensure you're running `npm run dev` (not `next dev` directly)
2. Check port 5000 is available
3. Verify Redis is running: `docker ps | grep falkor`

### No sessions appearing

1. Check FalkorDB: `docker ps | grep falkor`
2. Query the graph:
   ```bash
   docker exec -it <container> redis-cli
   > GRAPH.QUERY engram "MATCH (s:Session) RETURN count(s)"
   ```
3. Run traffic generator: `npx tsx scripts/traffic-gen.ts`

### Search returns no results

1. Verify Qdrant: `curl http://localhost:6333/collections`
2. Check if documents are indexed (search service must be running)
3. Try a broader query

### Consumer status shows OFFLINE

1. Start the services: `npm run dev` from monorepo root
2. Check Redpanda: http://localhost:8080
3. Verify Redis pub/sub (services publish heartbeats every 10s)

---

## Related Documentation

- [Engram Overview](../../README.md) - System introduction
- [Tech Stack](../../docs/TECH_STACK.md) - Architecture deep dive
- [Search Service](../search/README.md) - Hybrid search details
- [Memory Service](../memory/README.md) - Graph persistence
