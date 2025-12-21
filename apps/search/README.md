# Engram Search Service

High-performance vector search service with multi-tier reranking, hybrid retrieval, and session-aware search for the Engram memory system.

## Overview

This service provides production-ready semantic search capabilities with advanced retrieval strategies:

**Core Features:**
- **Hybrid Search**: Combines dense (BGE, Nomic) and sparse (SPLADE) embeddings with Reciprocal Rank Fusion
- **Multi-Tier Reranking**: Fast (FlashRank), accurate (BGE cross-encoder), code-specialized, ColBERT late interaction, and LLM-based reranking
- **Multi-Query Expansion**: LLM-driven query rewriting with diverse expansion strategies (DMQR-RAG)
- **Session-Aware Retrieval**: Two-stage hierarchical retrieval for multi-session reasoning
- **Query Classification**: Automatic strategy and tier selection based on query complexity
- **Graceful Degradation**: Fallback mechanisms for timeout and error scenarios

**Infrastructure:**
- FastAPI with async/await throughout
- Qdrant vector database with multi-vector support
- Kafka consumer for real-time indexing
- Prometheus metrics and structured logging
- Request tracing with correlation IDs

## Quick Start

### Installation

```bash
# Install dependencies with uv
uv sync

# Or install dev dependencies
uv sync --group dev
```

### Running the Service

```bash
# Start the service
uv run search

# Or with uvicorn directly
uv run uvicorn search.main:app --host 0.0.0.0 --port 5002 --reload
```

### Configuration

Create a `.env` file in the project root:

```bash
# Server
SEARCH_HOST=0.0.0.0
SEARCH_PORT=5002
DEBUG=false

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=engram_memory
QDRANT_TIMEOUT=30

# CORS
CORS_ORIGINS=["http://localhost:3000","http://localhost:5000"]
```

### Testing

```bash
# Run all tests
uv run pytest

# Run with coverage (80% threshold)
uv run pytest --cov=src --cov-report=html

# Run specific test file
uv run pytest tests/test_health.py -v

# Watch mode
uv run pytest-watch
```

### Linting and Formatting

```bash
# Lint code
uv run ruff check src tests

# Auto-fix issues
uv run ruff check --fix src tests

# Format code
uv run ruff format src tests

# Type check
uv run mypy src
```

## API Endpoints

### Health & Monitoring

**Health Check**
```bash
curl http://localhost:5002/health
```

Response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "qdrant_connected": true
}
```

**Readiness Probe** (for Kubernetes)
```bash
curl http://localhost:5002/ready
```

**Prometheus Metrics**
```bash
curl http://localhost:5002/metrics
```

### Vector Search

**Standard Search**
```bash
curl -X POST http://localhost:5002/search \
  -H "Content-Type: application/json" \
  -d '{
    "text": "How do I implement OAuth2?",
    "limit": 10,
    "strategy": "hybrid",
    "rerank": true,
    "rerank_tier": "accurate",
    "rerank_depth": 30,
    "filters": {
      "session_id": "abc123",
      "type": "code"
    }
  }'
```

**Search Strategies:**
- `dense`: Semantic search using dense embeddings (BGE/Nomic)
- `sparse`: Keyword-based search using SPLADE embeddings
- `hybrid`: Combines dense + sparse with RRF fusion (default)

**Reranking Tiers:**
- `fast`: FlashRank for low-latency (~10ms)
- `accurate`: BGE cross-encoder for quality (~50ms)
- `code`: Jina code-specialized reranker
- `colbert`: Late interaction for nuanced similarity (~30ms)
- `llm`: Listwise reranking with LLMs (~500ms, rate-limited)

### Multi-Query Search

Uses LLM-based query expansion with diverse rewriting strategies (DMQR-RAG):

```bash
curl -X POST http://localhost:5002/search/multi-query \
  -H "Content-Type: application/json" \
  -d '{
    "text": "OAuth2 authentication implementation",
    "limit": 10,
    "num_variations": 3,
    "strategies": ["paraphrase", "keyword", "stepback"],
    "include_original": true,
    "rrf_k": 60,
    "rerank": true,
    "rerank_tier": "fast"
  }'
```

**Expansion Strategies:**
- `paraphrase`: Rephrase with synonyms for vocabulary variance
- `keyword`: Extract key entities for precise matching
- `stepback`: Generalize to broader concepts
- `decompose`: Break complex queries into sub-questions

### Session-Aware Search

Two-stage hierarchical retrieval for multi-session reasoning:

```bash
curl -X POST http://localhost:5002/search/session-aware \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What did we discuss about Docker?",
    "top_sessions": 5,
    "turns_per_session": 3,
    "final_top_k": 10
  }'
```

**How it works:**
1. Stage 1: Retrieve top-S sessions by summary embeddings
2. Stage 2: Retrieve top-T turns within each matched session
3. Rerank combined results to final top-K

### Embedding Generation

Generate embeddings for external use:

```bash
curl -X POST http://localhost:5002/embed \
  -H "Content-Type: application/json" \
  -d '{
    "text": "async function example() { }",
    "embedder_type": "code",
    "is_query": true
  }'
```

**Embedder Types:**
- `text`: General text (BAAI/bge-base-en-v1.5)
- `code`: Code-specialized (nomic-ai/nomic-embed-text-v1.5)
- `sparse`: SPLADE sparse vectors (naver/splade-cocondenser-ensembledistil)
- `colbert`: Multi-vector late interaction (colbert-ir/colbertv2.0)

## Configuration

All configuration is managed via environment variables (see `.env` file):

### Server Settings
- `SEARCH_HOST`: Server host (default: `0.0.0.0`)
- `SEARCH_PORT`: Server port (default: `5002`)
- `SEARCH_WORKERS`: Number of worker processes (default: `1`)
- `DEBUG`: Enable debug mode (default: `false`)

### Qdrant Connection
- `QDRANT_URL`: Qdrant server URL (default: `http://localhost:6333`)
- `QDRANT_COLLECTION`: Collection name (default: `engram_memory`)
- `QDRANT_TIMEOUT`: Request timeout in seconds (default: `30`)
- `QDRANT_GRPC_PORT`: Optional gRPC port for better performance
- `QDRANT_PREFER_GRPC`: Prefer gRPC over HTTP (default: `false`)

### Search Defaults
- `SEARCH_DEFAULT_LIMIT`: Default result limit (default: `10`)
- `SEARCH_MAX_LIMIT`: Maximum result limit (default: `100`)
- `SEARCH_MIN_SCORE_DENSE`: Dense retrieval threshold (default: `0.75`)
- `SEARCH_MIN_SCORE_SPARSE`: Sparse retrieval threshold (default: `0.1`)
- `SEARCH_MIN_SCORE_HYBRID`: Hybrid retrieval threshold (default: `0.5`)
- `SEARCH_RERANK_DEPTH`: Results to rerank (default: `30`)

### Embedder Settings
- `EMBEDDER_DEVICE`: Inference device - `cpu`, `cuda`, `mps`, `auto` (default: `cpu`)
- `EMBEDDER_TEXT_MODEL`: Dense text model (default: `BAAI/bge-base-en-v1.5`)
- `EMBEDDER_CODE_MODEL`: Code model (default: `nomic-ai/nomic-embed-text-v1.5`)
- `EMBEDDER_SPARSE_MODEL`: SPLADE model (default: `naver/splade-cocondenser-ensembledistil`)
- `EMBEDDER_COLBERT_MODEL`: ColBERT model (default: `colbert-ir/colbertv2.0`)
- `EMBEDDER_BATCH_SIZE`: Batch size (default: `32`)
- `EMBEDDER_CACHE_SIZE`: LRU cache size (default: `10000`)
- `EMBEDDER_CACHE_TTL`: Cache TTL in seconds (default: `3600`)
- `EMBEDDER_PRELOAD`: Preload models at startup (default: `true`)

### Reranker Settings
- `RERANKER_FAST_MODEL`: FlashRank model (default: `ms-marco-TinyBERT-L-2-v2`)
- `RERANKER_ACCURATE_MODEL`: Cross-encoder (default: `BAAI/bge-reranker-v2-m3`)
- `RERANKER_CODE_MODEL`: Code reranker (default: `jinaai/jina-reranker-v2-base-multilingual`)
- `RERANKER_COLBERT_MODEL`: ColBERT model (default: `colbert-ir/colbertv2.0`)
- `RERANKER_LLM_MODEL`: LLM for listwise reranking (default: `grok-4-1-fast-reasoning`)
- `RERANKER_LLM_PROVIDER`: LLM provider (default: `xai`)
- `RERANKER_BATCH_SIZE`: Batch size (default: `16`)
- `RERANKER_TIMEOUT_MS`: Timeout in milliseconds (default: `500`)

### Rate Limiting
- `RATE_LIMIT_REQUESTS_PER_HOUR`: Max LLM requests/hour (default: `100`)
- `RATE_LIMIT_BUDGET_CENTS`: Max budget in cents/hour (default: `1000`)

### CORS
- `CORS_ORIGINS`: Allowed origins (default: `["http://localhost:3000","http://localhost:5000"]`)

## Docker

### Build

```bash
# Production build (multi-stage)
docker build -t engram-search:latest .

# Development build with hot reload
docker build -f Dockerfile.dev -t engram-search:dev .
```

### Run

```bash
# Production
docker run -p 5002:5002 \
  -e QDRANT_URL=http://qdrant:6333 \
  -e EMBEDDER_DEVICE=cpu \
  engram-search:latest

# Development with volume mount
docker run -p 5002:5002 \
  -v $(pwd)/src:/app/src \
  -e QDRANT_URL=http://qdrant:6333 \
  engram-search:dev
```

### Health Check

The Docker image includes a built-in health check that queries `/health` every 30 seconds.

## Architecture

### Directory Structure

```
apps/search/
├── src/
│   ├── main.py                  # FastAPI app + lifespan
│   ├── config.py                # Pydantic settings
│   ├── api/                     # API routes & schemas
│   │   ├── router.py
│   │   ├── routes.py
│   │   └── schemas.py
│   ├── clients/                 # External clients
│   │   ├── qdrant.py            # Qdrant vector DB
│   │   ├── kafka.py             # Kafka consumer
│   │   └── redis.py             # Redis cache
│   ├── embedders/               # Embedding models
│   │   ├── base.py              # Abstract base
│   │   ├── factory.py           # Factory pattern
│   │   ├── text.py              # Dense text embeddings
│   │   ├── code.py              # Code embeddings
│   │   ├── sparse.py            # SPLADE sparse
│   │   └── colbert.py           # ColBERT multi-vector
│   ├── rerankers/               # Reranking models
│   │   ├── base.py              # Abstract base
│   │   ├── router.py            # Tier-based routing
│   │   ├── flash.py             # FlashRank (fast)
│   │   ├── cross_encoder.py     # BGE cross-encoder (accurate)
│   │   ├── colbert.py           # ColBERT late interaction
│   │   └── llm.py               # LLM listwise reranking
│   ├── retrieval/               # Retrieval pipelines
│   │   ├── retriever.py         # Main hybrid search
│   │   ├── multi_query.py       # Multi-query expansion
│   │   ├── session.py           # Session-aware retrieval
│   │   ├── classifier.py        # Query complexity classifier
│   │   ├── types.py             # Shared types
│   │   └── constants.py         # Constants
│   ├── indexing/                # Document indexing
│   │   ├── indexer.py           # Multi-vector indexer
│   │   ├── consumer.py          # Kafka consumer
│   │   └── batch.py             # Batch processing
│   ├── services/                # Business logic
│   │   └── schema_manager.py   # Collection schema management
│   └── utils/                   # Utilities
│       ├── logging.py           # Structured logging
│       ├── metrics.py           # Prometheus metrics
│       ├── tracing.py           # Request tracing
│       └── rate_limiter.py      # LLM rate limiting
├── tests/
│   ├── conftest.py              # Pytest fixtures
│   ├── test_health.py           # Health tests
│   ├── test_search.py           # Search tests
│   └── ...
├── pyproject.toml               # Project config & dependencies
├── uv.lock                      # Dependency lock file
├── Dockerfile                   # Production image
├── Dockerfile.dev               # Development image
└── README.md
```

### Lifespan Management

FastAPI's modern lifespan pattern ensures proper resource initialization and cleanup:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize clients and models
    qdrant_client = QdrantClientWrapper(settings)
    await qdrant_client.connect()
    app.state.qdrant = qdrant_client

    embedder_factory = EmbedderFactory(settings)
    app.state.embedder_factory = embedder_factory

    # Preload models if configured
    if settings.embedder_preload:
        await embedder_factory.preload_all()

    yield

    # Shutdown: Clean up resources
    await embedder_factory.unload_all()
    await qdrant_client.close()
```

## Technology Stack

**Core Framework:**
- **FastAPI 0.126+**: Async web framework with automatic OpenAPI docs
- **Pydantic v2**: Type-safe settings and request/response validation
- **uvicorn**: ASGI server with standard support

**Machine Learning:**
- **sentence-transformers 5.1+**: Dense embedding models (BGE, Nomic)
- **torch 2.6+**: PyTorch for model inference
- **transformers 4.41+**: Hugging Face models
- **rerankers 0.10+**: Multi-tier reranking framework
- **flashrank 0.2+**: Fast reranking
- **pylate 1.3+**: ColBERT late interaction
- **litellm 1.80+**: Unified LLM interface

**Storage & Messaging:**
- **qdrant-client 1.16+**: Async vector database client with multi-vector support
- **aiokafka 0.12+**: Async Kafka consumer for event ingestion
- **redis 7.1+**: Cache with hiredis for performance

**Observability:**
- **structlog 25.5+**: Structured logging with JSON output
- **prometheus-client 0.23+**: Metrics collection and exposition
- **httpx 0.28+**: HTTP client for tracing and health checks

**Development:**
- **uv**: Fast Python package installer and resolver
- **pytest 9.0+**: Testing framework with async support
- **pytest-cov 7.0+**: Coverage reporting (80% threshold)
- **ruff 0.14+**: Fast linter and formatter (100 char lines, Python 3.12+)
- **mypy 1.19+**: Static type checking

## Dependencies

See `/Users/ccheney/Projects/the-system/apps/search/pyproject.toml` for the complete dependency list with version constraints.
