# Search Service

Vector semantic search and full-text indexing.

## Overview

The Search Service indexes graph nodes into the Qdrant vector store and provides semantic search capabilities. It listens for node creation events and maintains searchable indexes.

## Responsibilities

- Consume node creation events from Kafka (`memory.node_created` topic)
- Index Thought, CodeArtifact, and Turn nodes into Qdrant
- Provide HTTP `/search` endpoint for semantic queries
- Manage schema/collections via SchemaManager

## Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/search` | POST | Semantic search queries |
| `/health` | GET | Health check |

**Port:** 5002

## Dependencies

- `@engram/search` - SearchRetriever, SearchIndexer, SchemaManager
- `@engram/storage` - Kafka
- `@engram/logger` - Structured logging

## Kafka Topics

| Topic | Direction | Description |
|:------|:----------|:------------|
| `memory.node_created` | Consumer | Node creation events from Memory Service |

Consumer group: `search-group`

## Development

```bash
# From monorepo root
npm run dev --filter=@engram/search

# Or from this directory
npm run dev
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PORT` | HTTP server port | `5002` |
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:19092` |
| `QDRANT_URL` | Qdrant connection URL | `http://localhost:6333` |

## Search API

```bash
curl -X POST http://localhost:5002/search \
  -H "Content-Type: application/json" \
  -d '{"query": "how to implement auth", "limit": 10}'
```

Response includes ranked results with relevance scores and source metadata.
