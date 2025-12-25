# @engram/api

Cloud-native REST API for Engram's bitemporal memory system. Provides HTTP endpoints for memory operations, graph queries, and API key management.

## Overview

A Hono-based web service that exposes Engram's memory capabilities via REST API. It serves as the cloud backend for the Engram MCP server and enables programmatic access to memory storage, hybrid vector search, and bitemporal graph queries.

### Key Features

- **Memory Operations**: Store and retrieve memories with hybrid vector search (FalkorDB + Qdrant)
- **API Key Authentication**: Bearer token authentication with scope-based authorization
- **Rate Limiting**: Redis-backed sliding window rate limiting (per API key)
- **Usage Tracking**: PostgreSQL-based usage analytics per API key
- **Graph Queries**: Execute read-only Cypher queries against FalkorDB
- **Bitemporal Support**: All memory nodes include valid time and transaction time fields
- **Deduplication**: Content-hash based duplicate detection for memories

### Architecture

- **Framework**: Hono (web framework) with @hono/node-server
- **Storage**: FalkorDB (graph), PostgreSQL (API keys/usage), Redis (rate limiting)
- **Search**: Delegates to Python search service (port 5002) for hybrid retrieval + reranking
- **Logging**: Structured logging via @engram/logger (Pino)
- **Validation**: Zod schemas for request/response validation

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Health check (no authentication required) |

### Memory Operations

All memory endpoints require authentication and appropriate scopes.

#### POST `/v1/memory/remember`

Store a new memory with automatic deduplication.

**Required scope**: `memory:write`

**Request body**:
```json
{
  "content": "string (1-50000 chars, required)",
  "type": "decision | context | insight | preference | fact (optional)",
  "tags": ["string"] (optional),
  "project": "string (optional)"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "01HQXYZ...",
    "stored": true,
    "duplicate": false
  },
  "meta": {
    "usage": { "operation": "remember" }
  }
}
```

#### POST `/v1/memory/recall`

Search memories using hybrid retrieval (vector + keyword search).

**Required scope**: `memory:read`

**Request body**:
```json
{
  "query": "string (1-1000 chars, required)",
  "limit": 5 (1-20, default: 5),
  "filters": {
    "type": "decision | context | insight | preference | fact (optional)",
    "project": "string (optional)",
    "after": "ISO 8601 datetime (optional)",
    "before": "ISO 8601 datetime (optional)"
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "memories": [
      {
        "id": "01HQXYZ...",
        "content": "Memory content",
        "type": "context",
        "tags": ["tag1"],
        "score": 0.92,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ]
  },
  "meta": {
    "usage": { "operation": "recall", "resultCount": 5 }
  }
}
```

#### POST `/v1/memory/query`

Execute read-only Cypher query against FalkorDB. Write operations are blocked.

**Required scope**: `query:read`

**Request body**:
```json
{
  "cypher": "MATCH (m:Memory) WHERE m.vt_end > $now RETURN m LIMIT 10",
  "params": { "now": 1705315800000 } (optional)
}
```

**Allowed keywords**: MATCH, OPTIONAL MATCH, WITH, RETURN, ORDER BY, LIMIT, SKIP, WHERE, UNWIND, CALL

**Blocked keywords**: CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, ALTER, CLEAR, IMPORT, EXPORT

**Response**:
```json
{
  "success": true,
  "data": {
    "results": [...]
  },
  "meta": {
    "usage": { "operation": "query", "resultCount": 10 }
  }
}
```

#### POST `/v1/memory/context`

Get comprehensive context for a task by combining relevant memories and decisions.

**Required scope**: `memory:read`

**Request body**:
```json
{
  "task": "string (1-2000 chars, required)",
  "files": ["string"] (optional),
  "depth": "shallow | medium | deep (default: medium)"
}
```

Depth controls result limits: shallow (3), medium (5), deep (10).

**Response**:
```json
{
  "success": true,
  "data": {
    "context": [
      {
        "type": "memory | decision | file",
        "content": "Context content",
        "relevance": 0.95,
        "source": "memory:01HQXYZ..."
      }
    ]
  },
  "meta": {
    "usage": { "operation": "context", "itemCount": 8 }
  }
}
```

### API Key Management

#### GET `/v1/keys`

List all API keys for the authenticated user.

**Required scope**: `keys:manage`

**Response**:
```json
{
  "success": true,
  "data": {
    "keys": [
      {
        "id": "01HQXYZ...",
        "keyPrefix": "engram_live_abc123...",
        "keyType": "live",
        "name": "Production API Key",
        "description": "Main production key",
        "scopes": ["memory:read", "memory:write"],
        "rateLimitRpm": 60,
        "isActive": true,
        "expiresAt": null,
        "createdAt": "2024-01-15T10:00:00Z",
        "updatedAt": "2024-01-15T10:00:00Z",
        "lastUsedAt": "2024-01-15T12:30:00Z"
      }
    ]
  },
  "meta": {
    "usage": { "operation": "list_keys", "count": 1 }
  }
}
```

#### POST `/v1/keys/revoke`

Revoke an API key (can only revoke your own keys).

**Required scope**: `keys:manage`

**Request body**:
```json
{
  "keyId": "01HQXYZ..."
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "keyId": "01HQXYZ...",
    "revoked": true
  },
  "meta": {
    "usage": { "operation": "revoke_key" }
  }
}
```

### Usage Analytics

#### GET `/v1/usage`

Get usage statistics for the authenticated API key.

**Required scope**: Any valid API key

**Response**: Returns aggregated usage data from the `api_usage` table.

## Authentication

All endpoints (except `/v1/health`) require API key authentication via Bearer token:

```bash
curl -H "Authorization: Bearer engram_live_abc123..." \
  https://api.example.com/v1/memory/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "user preferences", "limit": 5}'
```

### API Key Format

```
engram_live_<32_random_chars>  # Production keys
engram_test_<32_random_chars>  # Development/testing keys
```

### API Key Scopes

- `memory:read` - Read memories (recall, context endpoints)
- `memory:write` - Create memories (remember endpoint)
- `query:read` - Execute read-only Cypher queries
- `keys:manage` - List and revoke API keys

Default scopes for new keys: `memory:read`, `memory:write`, `query:read`

### Creating API Keys

Use the provided script to create new API keys:

```bash
# Development key
tsx apps/api/scripts/create-api-key.ts test "My Test Key" "Description"

# Production key
tsx apps/api/scripts/create-api-key.ts live "My Production Key" "Description"
```

The script outputs the full API key (only shown once) and usage examples.

## Rate Limiting

Rate limits are enforced per API key using a Redis-backed sliding window algorithm. This ensures consistent limiting across distributed API instances.

### Rate Limit Headers

Every response includes:
- `X-RateLimit-Limit`: Maximum requests per minute (from API key config)
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

### Rate Limit Exceeded (HTTP 429)

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 42 seconds.",
    "details": {
      "limit": 60,
      "reset": 1705315800000,
      "retryAfter": 42
    }
  }
}
```

Response includes `Retry-After` header with seconds to wait.

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { } (optional)
  }
}
```

### Common Error Codes

- `VALIDATION_ERROR` (400) - Invalid request body or parameters
- `UNAUTHORIZED` (401) - Missing or invalid API key
- `FORBIDDEN` (403) - API key lacks required scope
- `NOT_FOUND` (404) - Endpoint or resource not found
- `RATE_LIMIT_EXCEEDED` (429) - Rate limit exceeded
- `INTERNAL_ERROR` (500) - Server error

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `8080` |
| `FALKORDB_URL` | FalkorDB connection URL | `redis://localhost:6379` |
| `POSTGRES_URL` | PostgreSQL connection URL | `postgresql://postgres:postgres@localhost:5432/engram` |
| `REDIS_URL` | Redis connection URL (rate limiting) | `redis://localhost:6379` |
| `SEARCH_URL` | Python search service URL | `http://localhost:6176` |
| `LOG_LEVEL` | Logging level (trace, debug, info, warn, error, fatal) | `info` |
| `RATE_LIMIT_RPM` | Default rate limit (requests per minute) | `60` |

### Example `.env` File

See `.env.example` for a complete configuration template.

## Development

### Prerequisites

- Node.js 24+
- PostgreSQL 14+
- Redis 7+
- FalkorDB (via docker-compose)
- Python search service (apps/search)

### Local Development

```bash
# Install dependencies (from project root)
npm install

# Start infrastructure (Redis, FalkorDB, PostgreSQL, Qdrant)
bun run infra:up

# Run database migrations
cd apps/api
bun run dev  # Migrations run automatically on startup

# Create an API key
tsx scripts/create-api-key.ts test "Local Dev" "Development API key"

# Start the API server (watches for changes)
bun run dev

# In another terminal, test the API
curl -H "Authorization: Bearer engram_test_..." http://localhost:8080/v1/health
```

### Building

```bash
# Build for production
bun run build

# Type checking
bun run typecheck

# Linting
bun run lint

# Start production build
npm start
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/services/memory.test.ts
```

## Deployment

### Docker

Build and run the containerized API:

```bash
# Build image
docker build -t engram-api -f apps/api/Dockerfile .

# Run container
docker run -p 8080:8080 \
  -e FALKORDB_URL=redis://falkordb:6379 \
  -e POSTGRES_URL=postgresql://postgres:password@postgres:5432/engram \
  -e REDIS_URL=redis://redis:6379 \
  -e SEARCH_URL=http://search:5002 \
  engram-api
```

The Dockerfile uses a multi-stage build with Node.js 24 Alpine, runs as a non-root user, and exposes port 8080.

### Kubernetes (GKE)

Production deployment is managed via Pulumi IaC:

```bash
cd packages/infra
pulumi preview  # Preview changes
pulumi up       # Deploy
```

See `packages/infra/src/api.ts` for GKE deployment configuration.

## Dependencies

### Internal Packages

- `@engram/graph` - Bitemporal graph models and repositories
- `@engram/logger` - Pino-based structured logging
- `@engram/storage` - FalkorDB, PostgreSQL, Redis clients

### External Dependencies

- `hono` - Fast web framework
- `@hono/node-server` - Node.js adapter for Hono
- `zod` - Schema validation
- `ulid` - Sortable unique identifiers
- `redis` - Redis client for rate limiting

## Database Schema

### API Keys Table (`api_keys`)

Stores API key credentials and configuration.

**Columns**: `id`, `key_hash`, `key_prefix`, `key_type`, `user_id`, `name`, `description`, `scopes`, `rate_limit_rpm`, `is_active`, `expires_at`, `created_at`, `updated_at`, `last_used_at`, `metadata`

### Usage Tracking Table (`api_usage`)

Aggregated usage statistics per API key and time period.

**Columns**: `api_key_id`, `period_start`, `period_end`, `request_count`, `error_count`, `operations`, `created_at`, `updated_at`

See `src/db/schema.sql` for complete schema definitions.

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) in the project root.
