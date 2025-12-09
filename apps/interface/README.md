# Neural Observatory

**Real-time visualization and exploration of AI agent reasoning, memory, and behavior.**

Neural Observatory is the frontend interface for the [Engram](../../README.md) system - a bitemporal, graph-backed intelligent agent platform. It provides live streaming views into agent sessions, allowing developers to observe thoughts, tool calls, and knowledge graph evolution as they happen.

---

## What It Does

```
                                    +------------------+
                                    |  Neural Observatory  |
                                    +--------+---------+
                                             |
            +--------------------------------+--------------------------------+
            |                                |                                |
    +-------v-------+               +--------v--------+              +--------v--------+
    | Session List  |               |  Session Detail |              |  System Status  |
    | (Live/Recent) |               |  Graph + Timeline |              |  (Consumers)   |
    +---------------+               +-----------------+              +-----------------+
            |                                |                                |
    WebSocket: sessions              WebSocket: session/:id           WebSocket: consumers
            |                                |                                |
            +--------------------------------+--------------------------------+
                                             |
                                    +--------v---------+
                                    |   Redis Pub/Sub  |
                                    +------------------+
```

- **Homepage**: Browse active (live) and historical agent sessions in real-time
- **Session Detail**: Two-panel view with interactive knowledge graph and thought stream timeline
- **Semantic Search**: Hybrid vector + keyword search with cross-encoder reranking
- **System Monitoring**: Consumer group health status in the footer

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) with custom WebSocket server |
| **UI** | React 19, Three.js (backgrounds), React Flow (graphs) |
| **Styling** | CSS-in-JS with glassmorphism design system |
| **Data Fetching** | SWR + WebSocket streaming |
| **Graph Viz** | @xyflow/react with custom neural-styled nodes |
| **3D Effects** | @react-three/fiber, @react-three/drei |
| **Search** | Qdrant vector DB + cross-encoder reranking (ONNX Runtime) |
| **Real-time** | Redis Pub/Sub + native WebSocket server |

---

## Architecture

### Real-Time Streaming

Neural Observatory uses a **custom HTTP server** that wraps Next.js to provide native WebSocket support. This avoids polling and enables true real-time updates.

```
server.ts                           lib/websocket-server.ts
    |                                       |
    +-- HTTP Server (Next.js handler)       |
    |                                       |
    +-- WebSocket Server (ws)               |
            |                               |
            +-- /api/ws/sessions -----------+-- handleSessionsConnection()
            |                               |      (broadcasts session list updates)
            +-- /api/ws/session/:id --------+-- handleSessionConnection()
            |                               |      (streams lineage + timeline for one session)
            +-- /api/ws/consumers ----------+-- handleConsumerStatusConnection()
                                                   (consumer group health via Kafka Admin API)
```

### WebSocket Endpoints

| Endpoint | Purpose | Message Types |
|----------|---------|---------------|
| `/api/ws/sessions` | Global session list | `sessions`, `session_created`, `session_updated` |
| `/api/ws/session/:id` | Individual session data | `lineage`, `replay`, `update` |
| `/api/ws/consumers` | Consumer group status | `status` (with `groups`, `allReady`, `readyCount`) |

### Data Flow

1. **Agent services** (ingestion, memory, search) publish events to **Redis Pub/Sub**
2. **Redis channels** are organized by session ID (`session:{id}:updates`) or global (`sessions:updates`, `consumers:status`)
3. **WebSocket server** subscribes to Redis channels and broadcasts to connected clients
4. **React hooks** (`useSessionStream`, `useSessionsStream`, `useConsumerStatus`) manage WebSocket lifecycle and state

```typescript
// Example: Session detail streaming
const { lineage, replay, isConnected, status } = useSessionStream({ sessionId });

// lineage: { nodes: LineageNode[], links: LineageLink[] }
// replay: { timeline: TimelineEvent[] }
```

---

## Key Features

### 1. Session Browser

The homepage displays sessions in two categories:

- **Live Sessions** (green indicators): Activity within the last 5 minutes
- **Recent Sessions** (amber indicators): Historical sessions

Each card shows:
- Session ID (truncated)
- Event count with activity bar visualization
- Time since last activity or "LIVE" badge

### 2. Knowledge Graph (LineageGraph)

Interactive force-directed graph visualization built on React Flow:

- **Node Types**: Session (silver), Turn (amber), Reasoning (cyan), ToolCall (violet)
- **Layout**: Radial layout with session at center
- **Interactions**: Click for details, hover to highlight parent chain
- **Controls**: Zoom, pan, fit-to-view, minimap navigation

```typescript
<LineageGraph
  data={lineageData}
  onNodeClick={setSelectedNode}
  highlightedNodeId={highlightedNodeId}
  onNodeHover={handleGraphNodeHover}
/>
```

### 3. Thought Stream (SessionReplay)

Timeline view of agent reasoning:

- **Turn Headers**: Sequential turn markers with timestamps
- **Query Cards**: User input with syntax highlighting
- **Reasoning Traces**: Collapsible `<thinking>` blocks
- **Tool Calls**: Tool name, type, status, file operations
- **Response Cards**: Assistant output with token counts

Hovering on timeline events highlights corresponding graph nodes, and vice versa.

### 4. Semantic Search

Hybrid search combining dense vectors and sparse retrieval:

```typescript
// Search settings
{
  rerank: true,           // Enable cross-encoder reranking
  rerankTier: "accurate", // fast | accurate | code | llm
  rerankDepth: 30,        // Top-K candidates for reranking
}
```

**Search Modes**:
- **UUID mode**: Paste a session ID to navigate directly
- **Search mode**: Semantic search across all indexed content (3+ characters)

**Reranking Tiers**:
| Tier | Model | Use Case |
|------|-------|----------|
| `fast` | Small cross-encoder | Low latency |
| `accurate` | BGE-reranker-base | Best quality |
| `code` | Code-optimized model | Code search |
| `llm` | LLM-based scoring | Complex queries |

### 5. System Status Footer

Real-time consumer group health monitoring:

```typescript
const { data: consumerStatus, isConnected } = useConsumerStatus();
// data.groups: [{ groupId, stateName, memberCount, isReady }]
// data.allReady: boolean
// data.readyCount / data.totalCount
```

**Consumer Groups Monitored**:
- `ingestion-group` - Event ingestion from Redpanda
- `memory-group` - Graph and vector storage
- `search-group` - Search indexing
- `control-group` - Orchestration

Status indicators:
- Green pulse: All consumers ready
- Amber: Partial readiness
- Red: Consumers offline

---

## Local Development

### Prerequisites

- Node.js 24+
- npm 11+
- Docker (for infrastructure)

### Setup

```bash
# From monorepo root
npm install

# Start infrastructure (Redis, FalkorDB, Qdrant, Redpanda)
npm run infra:up

# Start the interface (from root or apps/interface)
npm run dev --workspace=interface-service
# or
cd apps/interface && npm run dev
```

The app runs on **http://localhost:5000** by default.

### Environment Variables

Create `apps/interface/.env`:

```bash
# Required
REDIS_URL=redis://localhost:6379

# Optional - defaults shown
QDRANT_URL=http://localhost:6333
REDPANDA_BROKERS=localhost:19092
PORT=5000
NODE_ENV=development
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run typecheck` | TypeScript type checking |
| `npm run generate-docs` | Generate OpenAPI spec |

---

## Project Structure

```
apps/interface/
|-- server.ts                    # Custom HTTP + WebSocket server
|-- app/
|   |-- page.tsx                 # Homepage (session browser + search)
|   |-- session/[sessionId]/
|   |   |-- page.tsx             # Session detail page
|   |   +-- view.tsx             # Session view component
|   |-- api/
|   |   |-- search/route.ts      # Semantic search endpoint
|   |   |-- lineage/[id]/route.ts
|   |   +-- replay/[id]/route.ts
|   |-- components/
|   |   |-- LineageGraph/        # Knowledge graph visualization
|   |   |-- SessionReplay/       # Timeline/thought stream
|   |   |-- SessionBrowser.tsx   # Session list component
|   |   |-- SearchInput.tsx
|   |   |-- SearchResults.tsx
|   |   |-- SearchSettings.tsx
|   |   +-- shared/
|   |       |-- SystemFooter.tsx # Consumer status footer
|   |       +-- design-tokens.ts
|   +-- hooks/
|       |-- useSessionStream.ts  # Session WebSocket hook
|       |-- useSessionsStream.ts # Sessions list WebSocket hook
|       |-- useConsumerStatus.ts # Consumer status WebSocket hook
|       |-- useWebSocket.ts      # Base WebSocket hook
|       +-- useSearch.ts         # Search hook with debouncing
|-- lib/
|   |-- websocket-server.ts      # WebSocket handlers
|   |-- graph-queries.ts         # FalkorDB Cypher queries
|   |-- api-response.ts          # API response helpers
|   +-- types.ts
+-- package.json
```

---

## Graph Schema

Neural Observatory visualizes the following graph structure:

```
Session -[HAS_TURN]-> Turn -[CONTAINS]-> Reasoning
                        |
                        +--[INVOKES]--> ToolCall
                        |
                        +--[NEXT]--> Turn (sequential)

Reasoning -[TRIGGERS]-> ToolCall (causal link)
```

**Node Properties**:

| Node Type | Key Properties |
|-----------|----------------|
| Session | `id`, `started_at`, `last_event_at`, `title` |
| Turn | `id`, `sequence_index`, `user_content`, `assistant_preview`, `vt_start` |
| Reasoning | `id`, `preview`, `content`, `sequence_index` |
| ToolCall | `id`, `tool_name`, `tool_type`, `status`, `file_path`, `file_action` |

---

## Troubleshooting

### WebSocket not connecting

1. Ensure the custom server is running (`npm run dev`), not `next dev` directly
2. Check that port 5000 is not in use
3. Verify Redis is running: `docker ps | grep redis`

### No sessions appearing

1. Verify FalkorDB is running: `docker ps | grep falkor`
2. Check for sessions in the graph:
   ```bash
   docker exec -it <falkor-container> redis-cli
   > GRAPH.QUERY engram "MATCH (s:Session) RETURN s LIMIT 5"
   ```

### Search returning no results

1. Verify Qdrant is running: `curl http://localhost:6333/collections`
2. Check that documents have been indexed (run ingestion service first)

### Consumer status showing OFFLINE

1. Ensure Redpanda is running: `docker ps | grep redpanda`
2. Start the relevant services (ingestion, memory, search, control)
3. Check Redpanda console at http://localhost:8080

---

## Related Packages

- [`@engram/storage`](../../packages/storage) - Redis pub/sub, FalkorDB, Qdrant clients
- [`@engram/search-core`](../../packages/search-core) - Hybrid search + reranking
- [`@engram/memory-core`](../../packages/memory-core) - Graph operations
- [`@engram/events`](../../packages/events) - Event schemas and Kafka integration

---

## License

Part of the Engram monorepo. See root LICENSE file.
