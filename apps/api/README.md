# @engram/api

Cloud REST API for Engram's bitemporal memory system. Provides HTTP endpoints for memory operations, graph queries, API key management, and OpenTofu/Terraform remote state.

## Purpose

Hono-based web service that exposes Engram's memory capabilities via REST API. Serves as the cloud backend for the Engram MCP server and enables programmatic access to memory storage, hybrid vector search, and bitemporal graph queries.

## Key Features

- **Memory Operations**: Store and retrieve memories with hybrid vector search and multi-tier reranking
- **OAuth Authentication**: Bearer token authentication with scope-based authorization
- **Rate Limiting**: Redis-backed sliding window per-token limiting
- **Usage Tracking**: PostgreSQL-based analytics per OAuth token
- **Graph Queries**: Read-only Cypher queries against FalkorDB
- **Bitemporal Support**: Valid time and transaction time on all nodes
- **Deduplication**: Content-hash based duplicate detection
- **OpenTofu Backend**: Remote state storage with locking for infrastructure-as-code

## API Endpoints

### Memory Operations

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/v1/health` | GET | Public | Health check |
| `/v1/memory/remember` | POST | `memory:write` | Store memory with deduplication |
| `/v1/memory/recall` | POST | `memory:read` | Hybrid search with reranking |
| `/v1/memory/query` | POST | `query:read` | Read-only Cypher queries |
| `/v1/memory/context` | POST | `memory:read` | Comprehensive context assembly |
| `/v1/usage` | GET | Any | Usage statistics |

### OpenTofu/Terraform State Backend

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/tofu` | GET | Basic | Get current state |
| `/v1/tofu` | POST | Basic | Update state |
| `/v1/tofu/lock` | LOCK/POST | Basic | Acquire state lock |
| `/v1/tofu/lock` | UNLOCK/DELETE | Basic | Release state lock |

Uses Basic Auth where password is OAuth token with `state:write` scope.

## Authentication

Memory endpoints use Bearer token authentication with OAuth tokens. OpenTofu/Terraform state endpoints use Basic Auth (password = OAuth token).

**OAuth Scopes**:
- `memory:read` - Read memories (recall, context)
- `memory:write` - Store memories (remember)
- `query:read` - Execute Cypher queries
- `state:write` - OpenTofu state operations

**Example**:
```bash
curl -H "Authorization: Bearer engram_oauth_xxxxx" \
  http://localhost:6174/v1/memory/recall \
  -d '{"query": "preferences", "limit": 5}'
```

## Rate Limiting

Redis-backed sliding window per OAuth token. Default: 60 requests/minute.

**Response headers**:
- `X-RateLimit-Limit` - Requests per minute
- `X-RateLimit-Remaining` - Remaining requests
- `X-RateLimit-Reset` - Reset timestamp

**429 Response**:
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 42 seconds."
  }
}
```

## Configuration

**Environment Variables**:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6174` | HTTP server port |
| `FALKORDB_URL` | `redis://localhost:6179` | FalkorDB connection |
| `POSTGRES_URL` | `postgresql://postgres:postgres@localhost:6183/engram` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6179` | Redis (rate limiting) |
| `SEARCH_URL` | `http://localhost:6176` | Search service endpoint |
| `LOG_LEVEL` | `info` | Logging level |
| `RATE_LIMIT_RPM` | `60` | Default rate limit |

## How to Run

**Local Development**:
```bash
# Start infrastructure
bun run infra:up

# Start API (auto-runs migrations)
cd apps/api
bun run dev
```

**Production**:
```bash
# Build
bun run build

# Type check & lint
bun run typecheck && bun run lint

# Start
bun start
```

**Testing**:
```bash
bun test                              # All tests
bun test -- src/services/memory.test.ts  # Specific file
```

**Docker**:
```bash
docker build -t engram-api -f apps/api/Dockerfile .
docker run -p 6174:6174 \
  -e POSTGRES_URL=postgresql://... \
  -e SEARCH_URL=http://search:6176 \
  engram-api
```

## Architecture

- **Framework**: Hono web framework
- **Storage**: FalkorDB (graph), PostgreSQL (OAuth tokens/usage/state), Redis (rate limiting)
- **Search**: Delegates to Python search service (port 6176) for hybrid retrieval + reranking
- **Logging**: Pino structured logging with PII redaction

**Dependencies**: `@engram/graph`, `@engram/logger`, `@engram/storage`, `hono`, `zod`
