# @engram/api

Engram Cloud API - REST backend for memory operations.

## Overview

This is the cloud backend that powers the Engram MCP server in cloud mode. It provides REST endpoints for memory storage, retrieval, and graph queries.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/memory/remember` | Store a memory |
| POST | `/v1/memory/recall` | Search memories |
| POST | `/v1/memory/query` | Execute read-only Cypher |
| POST | `/v1/memory/context` | Get comprehensive context |
| GET | `/v1/health` | Health check |
| GET | `/v1/usage` | Usage stats for API key |

## Authentication

All endpoints except `/v1/health` require an API key:

```bash
curl -X POST https://api.engram.sh/v1/memory/remember \
  -H "Authorization: Bearer engram_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"content": "Important fact to remember"}'
```

### API Key Format

```
engram_live_<32_random_chars>  # Production
engram_test_<32_random_chars>  # Development/Testing
```

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

Requests are rate-limited per API key. Headers indicate current status:

- `X-RateLimit-Limit`: Maximum requests per minute
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `FALKORDB_URL` | FalkorDB connection | `redis://localhost:6379` |
| `QDRANT_URL` | Qdrant connection | `http://localhost:6333` |
| `REDIS_URL` | Redis for rate limiting | `redis://localhost:6379` |
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
  -e QDRANT_URL=http://qdrant:6333 \
  engram-api
```

### Kubernetes (GKE)

See `packages/infra/src/api.ts` for Pulumi configuration.

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) in the project root.
