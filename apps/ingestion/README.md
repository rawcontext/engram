# Ingestion Service

Streaming data parsing and normalization pipeline.

## Overview

The Ingestion Service consumes raw LLM provider events, extracts structured information, and normalizes them into a canonical event format. It handles thinking block extraction, diff detection, and PII redaction.

## Responsibilities

- Consume raw events from Kafka (`raw_events` topic)
- Extract thinking blocks (Claude's `<thinking>` tags)
- Detect and extract file diffs from code changes
- Redact personally identifiable information (PII)
- Publish normalized events to `parsed_events` topic
- Maintain per-session extractor state with TTL-based cleanup
- Send failed messages to Dead Letter Queue

## Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/ingest` | POST | Direct event ingestion (50MB limit) |
| `/health` | GET | Health check |

**Port:** 5001

## Dependencies

- `@engram/parser` - DiffExtractor, ThinkingExtractor, Redactor
- `@engram/events` - Event schemas
- `@engram/storage` - Kafka, Redis
- `@engram/logger` - Structured logging

## Kafka Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `raw_events` | Consumer | Raw LLM provider events |
| `parsed_events` | Producer | Normalized events |
| `ingestion.dead_letter` | Producer | Failed messages |

Consumer group: `ingestion-group`

## Development

```bash
# From monorepo root
npm run dev --filter=@engram/ingestion

# Or from this directory
npm run dev
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PORT` | HTTP server port | `5001` |
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
