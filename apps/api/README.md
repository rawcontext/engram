# @engram/api

Engram Cloud API - REST backend for memory operations.

## Overview

This is the cloud backend that powers the Engram MCP server in cloud mode. It provides REST endpoints for memory storage, retrieval, and graph queries.

## Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Health check |

### Memory Operations
*(Requires `memory:read` or `memory:write` scopes)*

| Method | Endpoint | Description | Required Scope |
|--------|----------|-------------|----------------|
| POST | `/v1/memory/remember` | Store a memory | `memory:write` |
| POST | `/v1/memory/recall` | Search memories | `memory:read` |
| POST | `/v1/memory/query` | Execute read-only Cypher | `query:read` |
| POST | `/v1/memory/context` | Get comprehensive context | `memory:read` |

### API Key Management
*(Requires `keys:manage` scope)*

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/keys` | List API keys for authenticated user |
| POST | `/v1/keys/revoke` | Revoke an API key |

### Usage & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/usage` | Usage stats for authenticated API key |

## Authentication

All endpoints except `/v1/health` require an API key:

```bash
curl -X POST https://api.example.com/v1/memory/remember \
  -H "Authorization: Bearer engram_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"content": "Important fact to remember"}'
```

### API Key Format

```
engram_live_<32_random_chars>  # Production
engram_test_<32_random_chars>  # Development/Testing
```

### API Key Scopes

API keys support fine-grained access control via scopes:

- `memory:read` - Read memories via recall/context endpoints
- `memory:write` - Create new memories via remember endpoint
- `query:read` - Execute read-only Cypher queries
- `keys:manage` - List and revoke API keys

By default, new API keys are created with `memory:read`, `memory:write`, and `query:read` scopes.

## Response Format

### Success

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "usage": { "operation": "remember" }
  }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [...]
  }
}
```

## Rate Limiting

Requests are rate-limited per API key using a Redis-backed sliding window algorithm. This ensures consistent rate limiting across distributed API instances.

Response headers indicate current status:

- `X-RateLimit-Limit`: Maximum requests per minute
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

When rate limited, the API returns HTTP 429 with a `Retry-After` header indicating seconds until the limit resets.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `FALKORDB_URL` | FalkorDB connection | `redis://localhost:6379` |
| `POSTGRES_URL` | PostgreSQL connection | `postgresql://postgres:postgres@localhost:5432/engram` |
| `REDIS_URL` | Redis for rate limiting | `redis://localhost:6379` |
| `SEARCH_URL` | Search service URL | `http://localhost:5002` |
| `LOG_LEVEL` | Logging level | `info` |
| `RATE_LIMIT_RPM` | Default rate limit | `60` |

## Development

```bash
# Start local infrastructure
npm run infra:up

# Run in development mode
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## Deployment

### Docker

```bash
docker build -t engram-api .
docker run -p 8080:8080 \
  -e FALKORDB_URL=redis://falkordb:6379 \
  -e SEARCH_URL=http://search:5002 \
  engram-api
```

### Kubernetes (GKE)

See `packages/infra/src/api.ts` for Pulumi configuration.

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) in the project root.
