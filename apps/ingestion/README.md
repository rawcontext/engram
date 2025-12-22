# Ingestion Service

Event parsing and normalization pipeline for LLM provider streams.

## Overview

The Ingestion Service is a streaming data pipeline that consumes raw events from LLM providers (Anthropic, OpenAI, Gemini, XAI, etc.), extracts structured information, and normalizes them into a canonical format for downstream processing. It operates as both a Kafka consumer for continuous stream processing and an HTTP service for direct ingestion.

## What It Does

The service performs multi-stage event transformation:

1. **Provider Parsing** - Converts provider-specific event formats (OpenAI, Anthropic, Gemini, XAI, Claude Code, Cline, Codex, OpenCode) into a unified `StreamDelta` format using registered parsers
2. **Thinking Extraction** - Extracts `<thinking>` tags from content streams, separating internal reasoning from visible output (stateful per session)
3. **Diff Extraction** - Detects and extracts unified diff hunks from code block content (stateful per session)
4. **PII Redaction** - Removes personally identifiable information (emails, phone numbers, etc.) from content and thoughts
5. **Metadata Enrichment** - Preserves session context (working directory, git remote, agent type) and provider metrics (cost, timing, cache stats)
6. **Schema Validation** - Validates output against `ParsedStreamEvent` schema before publishing
7. **Error Handling** - Sends malformed or failed events to Dead Letter Queue for analysis

## Key Features

### Supported Providers

- **Anthropic** - Claude models with thinking, tool use, and message deltas
- **OpenAI** - GPT models with chat completions and tool calls
- **Gemini** - Google Generative AI models
- **XAI** - Grok models
- **Claude Code** - Anthropic's official CLI
- **Cline** - VS Code extension
- **Codex** - OpenAI Codex models
- **OpenCode** - Open-source code assistants

### Stateful Extraction

Thinking and diff extractors maintain per-session state with:
- **30-minute TTL** - Extractors expire after 30 minutes of inactivity
- **Automatic cleanup** - Stale extractors removed every 5 minutes
- **Memory safety** - Mutex prevents concurrent cleanup operations

### Event Types

Parsed events are classified as:
- `content` - Text content deltas
- `thought` - Internal reasoning (extracted from `<thinking>` tags)
- `tool_call` - Function/tool invocation arguments
- `usage` - Token consumption and cost metrics
- Provider-specific types preserved when present

### Metadata Captured

Events preserve rich context including:
- `session_id` - Session identifier from `x-session-id` header or event_id
- `working_dir` - Project working directory from `x-working-dir` header
- `git_remote` - Git remote URL from `x-git-remote` header
- `agent_type` - Agent identifier from `x-agent-type` header (claude-code, cline, etc.)
- `cost_usd` - Estimated cost in USD (when available)
- `duration_ms` - Processing duration (when available)
- `model` - Model identifier
- `stop_reason` - Completion stop reason
- `cache_read_tokens` - Prompt cache read tokens (Anthropic)
- `cache_write_tokens` - Prompt cache write tokens (Anthropic)
- `reasoning_tokens` - Extended thinking tokens (Claude Opus 4.5+)

## Architecture

### Data Flow

```
Raw Event → Parser Registry → Thinking Extractor → Diff Extractor → Redactor → Schema Validation → Kafka
```

### Kafka Consumer

- **Topic**: `raw_events`
- **Consumer Group**: `ingestion-group`
- **Start Mode**: From latest (not from beginning)
- **Health**: Publishes `consumer_ready` status on startup and heartbeat every 10 seconds via Redis

### HTTP Server

- **Port**: 5001 (configurable)
- **Request Limit**: 50MB (configurable)
- **Content-Type**: `application/json`

### Dead Letter Queue

Failed events (parsing errors, validation failures, unknown providers) are sent to `ingestion.dead_letter` topic with:
- Original payload
- Error message
- Timestamp
- Source (`kafka_consumer` or HTTP endpoint)

## API Endpoints

| Endpoint | Method | Description | Response |
|:---------|:-------|:------------|:---------|
| `/health` | GET | Health check | `200 OK` |
| `/ingest` | POST | Direct event ingestion | `200 {"status": "processed"}` or `400 {"error": "..."}` |

### POST /ingest

Accepts raw events matching the `RawStreamEvent` schema:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "ingest_timestamp": "2025-01-15T10:30:00.000Z",
  "provider": "anthropic",
  "payload": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "Hello, world!"
    }
  },
  "headers": {
    "x-session-id": "sess-123",
    "x-working-dir": "/Users/user/project",
    "x-git-remote": "git@github.com:user/repo.git",
    "x-agent-type": "claude-code"
  }
}
```

**Required Fields:**
- `event_id` - UUID format
- `ingest_timestamp` - ISO 8601 timestamp
- `provider` - Supported provider name (case-insensitive, see list above)
- `payload` - Provider-specific event payload

**Optional Fields:**
- `headers` - Object with session context headers

**Validation:**
- Returns `400` if schema validation fails
- Returns `400` if provider is unknown
- Returns `413` if request exceeds 50MB
- Sends invalid events to DLQ

## Dependencies

### Internal Packages

- `@engram/parser` - Provider parsers, extractors (ThinkingExtractor, DiffExtractor), Redactor
- `@engram/events` - Zod schemas (RawStreamEvent, ParsedStreamEvent)
- `@engram/storage` - Kafka and Redis clients
- `@engram/logger` - Pino structured logging

### External Dependencies

- `zod` - Schema validation

## Running the Service

### Development Mode

```bash
# From monorepo root
bun run dev --filter=@engram/ingestion

# Or from apps/ingestion directory
bun run dev
```

### Production Mode

```bash
# Build (no-op, returns success)
bun run build

# Start with environment variables
PORT=5001 bun run dev
```

### Infrastructure Requirements

Start required infrastructure before running:

```bash
# From monorepo root
bun run infra:up
```

This starts:
- Redpanda (Kafka) on `localhost:19092`
- FalkorDB (Redis protocol) on `localhost:6379`

## Configuration

### Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PORT` | HTTP server port | `5001` |
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |

### Extractor Configuration

Hardcoded in source:
- `EXTRACTOR_TTL_MS` - Session extractor TTL: 30 minutes (1800000ms)
- Cleanup interval: 5 minutes (300000ms)
- Heartbeat interval: 10 seconds (10000ms)

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- src/index.test.ts

# Watch mode
npm test -- --watch
```

Test coverage includes:
- Unit tests for `IngestionProcessor` class
- HTTP server endpoint tests
- Kafka consumer lifecycle tests
- Extractor state management tests
- Integration tests with all supported providers

## Kafka Topics

| Topic | Direction | Description | Key |
|:------|:----------|:------------|:----|
| `raw_events` | Consumer | Raw LLM provider events | `event_id` |
| `parsed_events` | Producer | Normalized ParsedStreamEvent objects | `session_id` |
| `ingestion.dead_letter` | Producer | Failed events with error details | `event_id` |

### Event Schemas

**Input**: `RawStreamEvent` (from `@engram/events`)
**Output**: `ParsedStreamEvent` (from `@engram/events`)

## Graceful Shutdown

The service handles `SIGTERM` and `SIGINT` signals:

1. Stop heartbeat interval
2. Stop extractor cleanup interval
3. Disconnect Kafka consumer
4. Publish `consumer_disconnected` status to Redis
5. Disconnect Redis client
6. Exit with code 0

## Troubleshooting

### Consumer Not Starting

Check Kafka connectivity:
```bash
docker exec -it redpanda rpk cluster info
```

### Events Not Being Parsed

Check if provider is supported:
```bash
# Supported providers:
# anthropic, openai, gemini, xai, claude_code, cline, codex, opencode
# Plus aliases: gpt, gpt-4, claude, claude-code, grok
```

### Dead Letter Queue Messages

View DLQ events:
```bash
docker exec -it redpanda rpk topic consume ingestion.dead_letter
```

### Memory Leaks from Extractors

Extractors are cleaned up every 5 minutes. Check extractor map sizes:
- Default TTL: 30 minutes
- Cleanup runs automatically
- Mutex prevents concurrent cleanup

## Linting and Type Checking

```bash
# Biome linting
bun run lint

# TypeScript type checking
bun run typecheck

# Format code
bun run format
```

## Architecture Notes

- **Dependency Injection**: `IngestionProcessor` accepts optional dependencies for testability
- **Factory Pattern**: `createIngestionProcessor()` factory function for cleaner instantiation
- **Singleton Registry**: `defaultRegistry` from `@engram/parser` contains all parsers
- **Schema-First**: All events validated with Zod before publishing
- **Defensive Programming**: Graceful handling of unknown providers, malformed JSON, and DLQ failures
