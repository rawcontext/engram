# Observatory

Real-time visualization interface for AI agent sessions. Monitor reasoning traces, explore knowledge graphs, and search session history.

Part of the [Engram](../../README.md) monorepo.

## Features

**Session Browser**
- Live sessions with real-time updates (WebSocket-powered)
- Historical sessions with timestamps and event counts
- Activity visualization bars showing event distribution

**Session Detail View**
- **Lineage Graph**: Interactive force-directed graph (React Flow) with Session, Turn, Reasoning, and ToolCall nodes
- **Thought Stream**: Scrollable timeline with user queries, `<thinking>` blocks, tool calls, and assistant responses
- Synchronized hover states between graph and timeline

**Semantic Search**
- UUID detection for direct navigation
- Hybrid search (vector + keyword) via Python search service
- Four-tier reranking system: `fast`, `accurate`, `code`, `llm`
- Configurable depth and latency budgets

**System Health**
- Real-time consumer group status footer
- Service monitoring: ingestion, memory, search, control
- Event-driven via Redis pub/sub (no polling)

## Quick Start

```bash
# From monorepo root
bun install
bun run infra:up

# Start observatory
cd apps/observatory
bun run dev
```

**Access**: http://localhost:6178

## Architecture

**Custom WebSocket Server** (`server.ts`)
- Next.js doesn't support WebSocket upgrades natively
- Custom HTTP server intercepts `/api/ws/*` paths for WebSocket connections
- Preserves HMR in development

**Data Flow**
```
Memory Service → Redis Pub/Sub → WebSocket Server → React Client
     ↓
  FalkorDB (graph) → Observatory GraphQL/REST
     ↓
  Qdrant (vectors) → Search Service → Observatory Search
```

**WebSocket Endpoints**
- `/api/ws/sessions` - Global session list updates
- `/api/ws/session/:sessionId` - Individual session events
- `/api/ws/consumers` - Consumer health status

**REST Endpoints**
- `GET /api/sessions` - List sessions (pagination)
- `GET /api/lineage/:sessionId` - Session graph (fallback)
- `GET /api/replay/:sessionId` - Session timeline (fallback)
- `POST /api/search` - Semantic search proxy
- `POST /api/graphql` - GraphQL queries (GraphQL Yoga)

## Technology Stack

- **Framework**: Next.js 16 (App Router, RSC), React 19
- **TypeScript**: 7 (tsgo - Go-based compiler)
- **Visualization**: React Flow (graph), Three.js (3D background)
- **Real-time**: WebSocket (`ws` library)
- **Data**: FalkorDB (graph), Qdrant (vectors via search service), NATS (streaming)
- **Testing**: bun:test, Playwright
- **Linting**: Biome

## Scripts

```bash
bun run dev          # Dev server with WebSocket handler
bun run build        # Production build
bun run typecheck    # TypeScript validation
bun run lint         # Biome linting
bun run test:e2e     # Playwright E2E tests
```

## Environment Variables

Observatory uses `.env` symlinked to `configs/env/observatory.env`:

```bash
REDIS_URL=redis://localhost:6379      # FalkorDB + Redis pub/sub
SEARCH_URL=http://localhost:6176      # Python search service
PORT=6178                              # Observatory port
```

## Troubleshooting

**WebSocket fails**: Run `bun run dev` (not `next dev`), ensure Redis is running

**No sessions**: Check FalkorDB running, generate test data with `bunx tsx scripts/traffic-gen.ts`

**Search fails**: Verify Qdrant and search service running at `http://localhost:6176`

**Services offline**: Run `bun run dev` from monorepo root, allow 30s for heartbeats

## Related Documentation

- [Engram Overview](../../README.md) - Monorepo structure
- [Search Service](../search/README.md) - Python/FastAPI search
- [Memory Service](../memory/README.md) - Graph persistence
