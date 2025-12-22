# Observatory

**Real-time visualization interface for AI agent sessions.**

Observatory is Engram's Next.js 16 frontend that provides live streaming views into AI coding agent sessions. Monitor reasoning traces, explore knowledge graphs, and search across session history as agents like Claude Code work through problems.

> Part of the [Engram](../../README.md) monorepo.

---

## Features

### Session Browser
- **Live sessions**: Real-time active sessions with green pulse indicators
- **Recent sessions**: Historical sessions with timestamp and event count
- **Activity visualization**: Dynamic bars showing event distribution
- **Real-time updates**: WebSocket-powered, no polling

### Session Detail View
Two-panel interface with synchronized state:
- **Lineage Graph** (left): Interactive force-directed graph built with React Flow
  - Node types: Session, Turn, Reasoning, ToolCall
  - Hover synchronization between graph and timeline
  - Click nodes for detailed JSON inspection
  - Pan, zoom, and minimap controls
- **Thought Stream** (right): Scrollable timeline of session events
  - User queries with syntax highlighting
  - Collapsible `<thinking>` blocks
  - Tool calls with status badges and arguments
  - Assistant responses

### Semantic Search
- **UUID detection**: Paste session ID to navigate directly
- **Hybrid search**: Vector + keyword matching via Python search service
- **Reranking**: Four-tier system (fast, accurate, code, llm)
- **Settings panel**: Configure reranker, depth, and latency budgets
- **Debounced queries**: Optimized for fast typing

### System Health
Footer displays real-time consumer group status:
- **Event-driven**: Redis pub/sub, no polling
- **Service monitoring**: ingestion, memory, search, control
- **Visual indicators**: Green (healthy), amber (degraded), red (offline)
- **Heartbeat tracking**: 30-second timeout detection

---

## Architecture

### Custom WebSocket Server

Next.js API routes don't support WebSocket upgrades. `server.ts` wraps Next.js with a custom HTTP server:
1. Intercepts `/api/ws/*` paths for WebSocket upgrades
2. Passes all other requests to Next.js request handler
3. Maintains persistent Redis subscriptions
4. Preserves HMR (Hot Module Replacement) in development

### Data Flow

```
Memory Service → Redis Pub/Sub → WebSocket Server → React Client
     ↓
  FalkorDB (graph storage)
     ↓
  Qdrant (vector search via search-py service)
```

**Redis Channels:**
- `sessions:updates` - Global session list changes
- `session:{id}:updates` - Per-session event stream
- `consumers:status` - Service heartbeats and status

**WebSocket Endpoints:**
- `/api/ws/sessions` - Session list streaming
- `/api/ws/session/:sessionId` - Individual session streaming
- `/api/ws/consumers` - Consumer group health

### REST API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sessions` | GET | List all sessions with pagination |
| `/api/lineage/:sessionId` | GET | Fetch session graph (fallback) |
| `/api/replay/:sessionId` | GET | Fetch session timeline (fallback) |
| `/api/search` | POST | Semantic search across sessions |
| `/api/graphql` | POST | GraphQL queries (GraphQL Yoga) |

### Search Integration

Observatory communicates with the Python search service:
- **Base URL**: `http://localhost:5002` (configurable via `SEARCH_URL`)
- **Client**: `lib/search-client.ts` - HTTP wrapper with TypeScript types
- **Strategy**: Hybrid (dense + sparse) with optional reranking
- **Tiers**: `fast`, `accurate`, `code`, `llm` (latency/quality tradeoff)

---

## Development

### Prerequisites

- **Node.js**: 24+
- **Infrastructure**: Running via `npm run infra:up` from monorepo root
  - FalkorDB (Redis-based graph): port 6379
  - Qdrant (vector store): port 6333
  - Redpanda (Kafka): port 19092
  - Redis (pub/sub): port 6379

### Setup

```bash
# From monorepo root
npm install
npm run infra:up

# Start observatory
cd apps/observatory
npm run dev
```

**Access**: http://localhost:5000

### Environment Variables

Observatory uses `.env` symlinked to monorepo root. Key variables:

```bash
REDIS_URL=redis://localhost:6379      # FalkorDB + Redis pub/sub
SEARCH_URL=http://localhost:5002      # Python search service
PORT=5000                              # Observatory port
```

### Scripts

```bash
npm run dev          # Start dev server with custom WebSocket handler
npm run build        # Production build
npm run start        # Production server
npm run typecheck    # TypeScript validation (tsgo)
npm run lint         # Biome linting
npm run format       # Biome formatting
npm test:watch       # Vitest watch mode
npm test:e2e         # Playwright E2E tests
npm test:e2e:ui      # Playwright UI mode
```

### Generating Test Data

```bash
# From monorepo root
npx tsx scripts/traffic-gen.ts
```

---

## Project Structure

```
apps/observatory/
├── server.ts                       # Custom HTTP + WebSocket server
├── app/
│   ├── page.tsx                    # Homepage (session browser + search)
│   ├── session/[sessionId]/
│   │   ├── page.tsx                # Session wrapper (async params)
│   │   └── view.tsx                # Session detail client component
│   ├── components/
│   │   ├── EngramLogo.tsx          # Animated logo
│   │   ├── NeuralBackground.tsx    # Three.js neural network
│   │   ├── SessionBrowser.tsx      # Session card grid
│   │   ├── SearchInput.tsx         # Search bar with mode detection
│   │   ├── SearchSettings.tsx      # Reranker configuration
│   │   ├── SearchResults.tsx       # Search result cards
│   │   ├── LineageGraph/
│   │   │   ├── index.tsx           # React Flow graph wrapper
│   │   │   ├── NeuralNode.tsx      # Custom node renderer
│   │   │   ├── config/nodeTypeConfig.tsx  # Node styling
│   │   │   └── layouts/gridLayout.ts      # Layout algorithm
│   │   ├── SessionReplay/
│   │   │   ├── index.tsx           # Timeline container
│   │   │   ├── Timeline.tsx        # Scrollable event list
│   │   │   ├── StatsHeader.tsx     # Session stats
│   │   │   └── MessageCards/       # Event card components
│   │   └── shared/
│   │       ├── SystemFooter.tsx    # Consumer status footer
│   │       ├── StatusIndicator.tsx # Status badges
│   │       ├── Particles.tsx       # Background particles
│   │       └── design-tokens.ts    # Color system
│   └── api/
│       ├── sessions/route.ts       # Session list endpoint
│       ├── lineage/[sessionId]/route.ts  # Graph data (REST fallback)
│       ├── replay/[sessionId]/route.ts   # Timeline data (REST fallback)
│       ├── search/route.ts         # Search proxy to search-py
│       ├── graphql/
│       │   ├── route.ts            # GraphQL Yoga handler
│       │   └── schema.ts           # Type defs + resolvers
│       └── consumers/route.ts      # Consumer status (REST)
├── lib/
│   ├── websocket-server.ts         # WebSocket connection handlers
│   ├── graph-queries.ts            # FalkorDB Cypher queries
│   ├── search-client.ts            # HTTP client for search-py
│   ├── api-response.ts             # Standardized API responses
│   ├── validate.ts                 # Zod request validation
│   ├── auth.ts                     # Clerk authentication (future)
│   ├── rbac.ts                     # Role-based access control (future)
│   └── types.ts                    # Shared TypeScript types
└── hooks/
    ├── useSessionStream.ts         # WebSocket hook for session detail
    ├── useSessionsStream.ts        # WebSocket hook for session list
    ├── useConsumerStatus.ts        # WebSocket hook for health status
    ├── useSearch.ts                # Search with debouncing
    └── useWebSocket.ts             # Low-level WebSocket connection
```

---

## Technology Stack

### Core
- **Framework**: Next.js 16.1 (App Router, React Server Components)
- **React**: 19.2.3
- **TypeScript**: 7 (tsgo - Go-based compiler)
- **Node.js**: 24+ (native ESM, ESNext features)

### UI & Visualization
- **Graph**: React Flow (`@xyflow/react`) - lineage visualization
- **3D Background**: Three.js + React Three Fiber
- **Icons**: Lucide React
- **Styling**: Inline styles with design tokens (no CSS-in-JS)

### Data & State
- **Data Fetching**: SWR (stale-while-revalidate)
- **Real-time**: WebSocket (native `ws` library)
- **Graph DB**: FalkorDB (via `@engram/storage`)
- **Vector Search**: Qdrant (via Python search service)
- **Streaming Events**: Redpanda/Kafka

### API & GraphQL
- **GraphQL**: GraphQL Yoga (lightweight, standards-compliant)
- **Validation**: Zod 4.2 (schema validation)
- **HTTP Client**: Native `fetch`

### Development & Testing
- **Testing**: Vitest + Playwright
- **Linting**: Biome (replaces ESLint + Prettier)
- **Package Manager**: npm (workspaces)
- **Build Tool**: Next.js + tsgo

### External Packages
- **Monorepo Packages**:
  - `@engram/events` - Event schemas
  - `@engram/logger` - Pino structured logging
  - `@engram/graph` - Graph models and repositories
  - `@engram/storage` - FalkorDB, Kafka, Redis clients

---

## WebSocket Protocol

### Session List Stream (`/api/ws/sessions`)

**Initial Message:**
```json
{
  "type": "sessions",
  "data": [
    {
      "id": "session-uuid",
      "title": "Session title",
      "userId": "user-id",
      "startedAt": 1703001600000,
      "lastEventAt": 1703005200000,
      "eventCount": 42,
      "preview": "Last event preview",
      "isActive": true
    }
  ]
}
```

**Update Messages:**
```json
{ "type": "session_created", "data": { /* Session */ } }
{ "type": "session_updated", "data": { /* Session */ } }
```

### Session Detail Stream (`/api/ws/session/:sessionId`)

**Initial Messages:**
```json
{
  "type": "lineage",
  "data": {
    "nodes": [
      { "id": "node-id", "label": "Session", "type": "Session", /* ... */ }
    ],
    "links": [
      { "source": "node-1", "target": "node-2", "type": "HAS_TURN" }
    ]
  }
}

{
  "type": "replay",
  "data": {
    "timeline": [
      {
        "id": "event-id",
        "type": "user_query",
        "timestamp": 1703001600000,
        "content": "User message",
        /* ... */
      }
    ]
  }
}
```

**Update Message:**
```json
{
  "type": "update",
  "data": {
    "type": "new_event",
    "sessionId": "session-uuid",
    "event": { /* Event data */ }
  }
}
```

### Consumer Status Stream (`/api/ws/consumers`)

**Status Message:**
```json
{
  "type": "status",
  "data": {
    "groups": [
      {
        "groupId": "ingestion-group",
        "stateName": "STABLE",
        "memberCount": 1,
        "isReady": true
      }
    ],
    "allReady": true,
    "readyCount": 4,
    "totalCount": 4,
    "timestamp": 1703001600000
  }
}
```

**Client Messages:**
```json
{ "type": "refresh" }  // Request current status
```

---

## Search Configuration

### Reranker Tiers

Observatory supports four reranker tiers (configured via `SearchSettings.tsx`):

| Tier | Model | Latency | Use Case |
|------|-------|---------|----------|
| **fast** | MiniLM-L-6-v2 | ~50ms | Quick lookups, autocomplete |
| **accurate** | BGE-reranker-base | ~150ms | General queries (default) |
| **code** | Jina-reranker-v2 | ~150ms | Code-specific search |
| **llm** | Gemini 3.0 Flash | ~2s | Premium results, complex queries |

### Search Settings

Users can configure:
- **Rerank**: Enable/disable reranking (default: enabled)
- **Tier**: Reranker model tier (default: `accurate`)
- **Depth**: Number of candidates to rerank (default: 30)
- **Latency Budget**: Maximum reranking time in ms (optional)

Settings persist to `localStorage` as `engram-search-settings`.

---

## GraphQL Schema

Observatory exposes a GraphQL endpoint at `/api/graphql` (GraphQL Yoga):

```graphql
type Query {
  session(id: ID!): Session
  sessions(limit: Int): [Session!]!
  search(query: String!, limit: Int, type: String): [SearchResult!]!
  graph(cypher: String!): JSON  # Disabled for security
}

type Session {
  id: ID!
  title: String
  userId: String
  startedAt: Float
  thoughts(limit: Int): [Thought!]!
}

type Thought {
  id: ID!
  role: String
  content: String
  isThinking: Boolean
  validFrom: Float
  validTo: Float
  transactionStart: Float
  transactionEnd: Float
  causedBy: [ToolCall!]
}

type ToolCall {
  id: ID!
  name: String!
  arguments: String
  result: String
  validFrom: Float
  validTo: Float
}

type SearchResult {
  id: ID!
  content: String!
  score: Float!
  nodeId: String
  sessionId: String
  type: String
  timestamp: Float
}
```

**Security Note**: Arbitrary Cypher execution is disabled. Use specific resolvers instead.

---

## Troubleshooting

### WebSocket Connection Issues

**Problem**: WebSocket fails to connect

**Solutions**:
1. Verify you're running `npm run dev` (not `next dev` directly)
2. Check port 5000 is available: `lsof -i :5000`
3. Ensure Redis is running: `docker ps | grep redis`
4. Check browser console for upgrade errors

### No Sessions Appearing

**Problem**: Session browser is empty

**Solutions**:
1. Verify FalkorDB is running: `docker ps | grep falkor`
2. Query the graph:
   ```bash
   docker exec -it falkordb redis-cli
   > GRAPH.QUERY engram "MATCH (s:Session) RETURN count(s)"
   ```
3. Check memory service is running and publishing to Redis
4. Generate test data: `npx tsx scripts/traffic-gen.ts`

### Search Returns No Results

**Problem**: Search query returns empty results

**Solutions**:
1. Verify Qdrant is running: `curl http://localhost:6333/collections`
2. Check search service: `curl http://localhost:5002/v1/health`
3. Ensure documents are indexed (search service must be running)
4. Try a broader query or disable reranking
5. Check search service logs for errors

### Consumer Status Shows OFFLINE

**Problem**: Footer shows services offline

**Solutions**:
1. Start all services: `npm run dev` from monorepo root
2. Check Redpanda: http://localhost:8080 (Redpanda Console)
3. Verify consumer groups:
   ```bash
   docker exec -it redpanda rpk group list
   ```
4. Check Redis pub/sub:
   ```bash
   docker exec -it redis redis-cli
   > PSUBSCRIBE consumers:*
   ```
5. Services publish heartbeats every 10s; allow 30s for timeout

### Three.js Performance Issues

**Problem**: Neural background animation is choppy

**Solutions**:
1. Background uses dynamic import with `ssr: false`
2. Reduce particle count in `Particles` component
3. Disable background in `NeuralBackground.tsx`
4. Check GPU acceleration in browser settings

---

## Security Notes

- **Arbitrary Cypher**: GraphQL `graph` resolver is disabled to prevent injection attacks
- **Authentication**: Clerk integration prepared but not enforced (`lib/auth.ts`)
- **RBAC**: Role-based access control defined but not active (`lib/rbac.ts`)
- **Input Validation**: All API routes use Zod schema validation
- **CORS**: Not configured (assumes same-origin or controlled proxy)

---

## Related Documentation

- [Engram Overview](../../README.md) - Monorepo structure and system architecture
- [Search Service](../search/README.md) - Python/FastAPI search implementation
- [Memory Service](../memory/README.md) - Graph persistence and real-time pub/sub
- [Agent Mandates](../../AGENTS.md) - Development guidelines and code standards
