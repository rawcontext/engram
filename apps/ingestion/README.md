# Ingestion Service

Event parsing and normalization pipeline for LLM provider streams.

## Purpose

Transforms raw streaming events from 8+ LLM providers (Anthropic, OpenAI, Gemini, XAI, Claude Code, Cline, Codex, OpenCode) into a canonical `ParsedStreamEvent` format. Operates as both a NATS consumer for continuous stream processing and an HTTP service for direct ingestion.

## Key Features

**Multi-Stage Pipeline:**
1. Provider parsing via registry (converts provider-specific formats to unified `StreamDelta`)
2. Thinking extraction (separates `<thinking>` tags from visible content)
3. Diff extraction (detects unified diff hunks in code blocks)
4. PII redaction (removes emails, phone numbers, etc.)
5. Metadata enrichment (session context + provider metrics)
6. Schema validation (validates against `ParsedStreamEvent` before publishing)

**Stateful Extraction:**
- Per-session thinking/diff extractors with 30-minute TTL
- Automatic cleanup every 5 minutes
- Mutex-protected memory management

**Authentication:**
- OAuth token support (`engram_oauth_<32 hex chars>`)
- Dev tokens for local development (`engram_dev_<name>`)
- Scope-based authorization (`memory:write`, `ingest:write`)
- PostgreSQL-backed token validation

**Event Types:** `content`, `thought`, `tool_call`, `usage` (+ provider-specific types)

**Metadata Captured:** `session_id`, `working_dir`, `git_remote`, `agent_type`, `cost_usd`, `duration_ms`, `model`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`

## Architecture

**Data Flow:**
```
Raw Event → Parser Registry → Thinking Extractor → Diff Extractor → Redactor → Schema Validation → NATS
```

**NATS Consumer:**
- Topic: `raw_events` (consumer group: `ingestion-group`)
- Publishes `consumer_ready` status on startup
- Heartbeat every 10 seconds

**HTTP Server:**
- Port: 6175 (configurable)
- Max body size: 50MB
- Endpoints: `/health`, `/ingest`

**Dead Letter Queue:** Failed events sent to `ingestion.dead_letter` with error details

## Running the Service

### Development

```bash
# From monorepo root
bun run infra:up                           # Start NATS, FalkorDB, PostgreSQL
bun run dev --filter=@engram/ingestion     # Start service

# Or from apps/ingestion
bun run dev
```

### Production

```bash
bun run build      # No-op (returns success)
bun run dev        # Start service
```

### Environment Variables

| Variable | Default |
|----------|---------|
| `PORT` | `6175` |
| `NATS_URL` | `nats://localhost:4222` |
| `AUTH_ENABLED` | `true` |
| `AUTH_DATABASE_URL` | `postgresql://postgres:postgres@localhost:6183/engram` |

## API

### POST /ingest

**Authentication:** Required (Bearer token with `memory:write` or `ingest:write` scope)

**Request:**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "ingest_timestamp": "2025-01-15T10:30:00.000Z",
  "provider": "anthropic",
  "payload": {
    "type": "content_block_delta",
    "index": 0,
    "delta": { "type": "text_delta", "text": "Hello!" }
  },
  "headers": {
    "x-session-id": "sess-123",
    "x-working-dir": "/Users/user/project",
    "x-git-remote": "git@github.com:user/repo.git",
    "x-agent-type": "claude-code"
  }
}
```

**Response:**
- `200 {"status": "processed"}` - Success
- `400 {"error": "..."}` - Validation failure or unknown provider
- `401` - Missing or invalid authentication
- `403` - Insufficient scopes
- `413` - Request exceeds 50MB

### GET /health

Returns `200 OK` (no authentication required)

## Testing

```bash
bun run test                        # All tests
bun run test -- src/index.test.ts   # Specific file
bun run test -- --watch             # Watch mode
```

## NATS Topics

| Topic | Direction | Key |
|-------|-----------|-----|
| `raw_events` | Consumer | `event_id` |
| `parsed_events` | Producer | `session_id` |
| `ingestion.dead_letter` | Producer | `event_id` |

## Troubleshooting

**Consumer not starting:**
```bash
docker exec -it engram-nats-1 nats stream ls
```

**Check DLQ messages:**
```bash
docker exec -it engram-nats-1 nats consumer info EVENTS dead_letter
```

**Supported providers:**
`anthropic`, `openai`, `gemini`, `xai`, `claude_code`, `cline`, `codex`, `opencode`
Aliases: `claude` → `anthropic`, `gpt`/`gpt-4` → `openai`, `grok` → `xai`, `claude-code` → `claude_code`

## Development

```bash
bun run lint       # Biome linting
bun run typecheck  # TypeScript validation
bun run format     # Format code
```
