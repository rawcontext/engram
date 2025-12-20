# Engram Search Service (Python)

Intelligent vector search service with embedding, sparse retrieval, and multi-tier reranking for the Engram memory system.

## Overview

This service provides high-performance semantic search capabilities using:
- Dense vector embeddings (text and code)
- Sparse embeddings (SPLADE)
- ColBERT late interaction
- Multi-tier reranking (fast, accurate, code, LLM)
- Session-aware hierarchical retrieval
- Hybrid search with Reciprocal Rank Fusion

## Current Status: Phase 1 - Foundation

### Completed
- ✅ Project scaffolding with pyproject.toml
- ✅ FastAPI app with lifespan management
- ✅ Pydantic settings with env validation
- ✅ Docker multi-stage build
- ✅ Health endpoint at `/health`
- ✅ Async Qdrant client wrapper
- ✅ Test infrastructure with pytest

### Coming Next
- Phase 2: Embedders (text, code, sparse, ColBERT)
- Phase 3: Rerankers (cross-encoder, ColBERT, LLM)
- Phase 4: Retrieval pipeline (hybrid search, session-aware)
- Phase 5: Indexing & Kafka consumer
- Phase 6: Production hardening (metrics, logging, tracing)
- Phase 7: Cutover from TypeScript service

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

# Run with coverage
uv run pytest --cov=search --cov-report=html

# Run specific test file
uv run pytest tests/test_health.py

# Run in watch mode
uv run pytest --watch
```

### Linting and Type Checking

```bash
# Run ruff linter
uv run ruff check .

# Run ruff formatter
uv run ruff format .

# Run mypy type checker
uv run mypy src/search
```

## API Endpoints

### Health Check

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

### Readiness Probe

```bash
curl http://localhost:5002/ready
```

### Search (Phase 4+)

```bash
curl -X POST http://localhost:5002/search \
  -H "Content-Type: application/json" \
  -d '{
    "text": "How do I create a memory?",
    "limit": 10,
    "strategy": "hybrid",
    "rerank": true,
    "rerankTier": "fast"
  }'
```

## Docker

### Build

```bash
# Production build
docker build -t engram-search:latest .

# Development build
docker build -f Dockerfile.dev -t engram-search:dev .
```

### Run

```bash
# Production
docker run -p 5002:5002 \
  -e QDRANT_URL=http://qdrant:6333 \
  engram-search:latest

# Development with hot reload
docker run -p 5002:5002 \
  -v $(pwd)/src:/app/src \
  -e QDRANT_URL=http://qdrant:6333 \
  engram-search:dev
```

## Architecture

### Directory Structure

```
apps/search-py/
├── src/
│   └── search/
│       ├── __init__.py
│       ├── main.py              # FastAPI app + lifespan
│       ├── config.py            # Pydantic settings
│       ├── api/
│       │   ├── __init__.py
│       │   ├── router.py        # Main router
│       │   ├── routes.py        # Route handlers
│       │   └── schemas.py       # Request/response models
│       ├── clients/
│       │   ├── __init__.py
│       │   └── qdrant.py        # Async Qdrant client
│       └── utils/
│           └── __init__.py
├── tests/
│   ├── conftest.py              # Pytest fixtures
│   ├── test_health.py           # Health endpoint tests
│   └── test_search.py           # Search endpoint tests
├── pyproject.toml               # Project config
├── Dockerfile                   # Production image
├── Dockerfile.dev               # Development image
└── README.md
```

### Lifespan Management

The service uses FastAPI's modern lifespan pattern for proper resource management:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize resources
    qdrant_client = QdrantClientWrapper(settings)
    await qdrant_client.connect()
    app.state.qdrant = qdrant_client

    yield

    # Shutdown: Cleanup
    await qdrant_client.close()
```

## Migration Plan

See [search-python-migration.md](../../docs/plans/search-python-migration.md) for the complete migration plan from TypeScript to Python.

## Technology Stack

- **FastAPI 0.115+**: Async web framework with OpenAPI
- **Pydantic v2**: Type-safe settings and schemas
- **qdrant-client 1.12+**: Async vector database client
- **uv**: Fast Python package manager
- **pytest**: Testing framework
- **ruff**: Fast Python linter and formatter
- **mypy**: Static type checker

## License

Part of the Engram project.
