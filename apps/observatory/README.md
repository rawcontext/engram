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

**OAuth Endpoints (RFC 8628 Device Flow)**
- `POST /api/auth/device/code` - Generate device code for MCP authentication
- `POST /api/auth/device/token` - Poll for tokens or refresh existing tokens
- `POST /api/auth/introspect` - RFC 7662 token introspection
- `GET /.well-known/oauth-authorization-server` - RFC 8414 auth server metadata

## OAuth Token Format

Observatory issues OAuth tokens for MCP server authentication using a secure, identifiable format:

| Token Type | Format | Example |
|------------|--------|---------|
| Access Token | `egm_oauth_{random32}_{crc6}` | `egm_oauth_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_X7kM2p` |
| Refresh Token | `egm_refresh_{random32}_{crc6}` | `egm_refresh_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4_Y8nL3q` |

**Format breakdown**:
- `egm`: Engram company identifier (unique to prevent prefix collisions)
- `oauth`/`refresh`: Token type identifier
- `random32`: 32 hex characters (128 bits of entropy from `crypto.randomBytes`)
- `crc6`: 6 Base62 characters (CRC32 checksum encoded as Base62)

**Benefits**:
- **Secret scanning**: Unique prefix allows GitHub/GitLab secret scanning to identify leaked tokens
- **Offline validation**: CRC32 checksum enables validation without database lookup (reduces false positives to ~0%)
- **Type identification**: Token type embedded in prefix for quick categorization

**Implementation**: See `lib/device-auth.ts` for `generateAccessToken()`, `generateRefreshToken()`, and `validateTokenChecksum()`.

Design inspired by [GitHub's token format](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/).

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
