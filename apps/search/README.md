# Engram Search Service

Python FastAPI service providing hybrid vector search, multi-tier reranking, and session-aware retrieval for Engram's bitemporal memory system.

## Features

- **Hybrid Search**: Dense (BGE/Nomic) + sparse (SPLADE) with RRF fusion
- **Multi-Tier Reranking**: FlashRank (~10ms), BGE cross-encoder (~50ms), ColBERT, Jina code, LLM listwise
- **Multi-Query Expansion**: DMQR-RAG with paraphrase/keyword/stepback/decompose strategies
- **Session-Aware**: Two-stage hierarchical retrieval (session summaries → turn content)
- **Real-time Indexing**: NATS JetStream consumer, API key auth (PostgreSQL)

## Quick Start

```bash
# From apps/search/
uv sync                          # Production deps
uv sync --group dev              # + pytest, ruff, mypy

uv run search                    # Start service (port 6176)
uv run pytest --cov=src          # Tests (70% threshold)
uv run ruff check src tests      # Lint (88 char, Python 3.12+)
```

## API Endpoints (Base: `http://localhost:6176/v1/search`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (Qdrant status) |
| `/ready` | GET | K8s readiness probe |
| `/metrics` | GET | Prometheus metrics |
| `/query` | POST | Hybrid search (dense/sparse/hybrid) + reranking (fast/accurate/code/colbert/llm) |
| `/multi-query` | POST | Multi-query expansion (DMQR-RAG) |
| `/session-aware` | POST | Hierarchical session → turn retrieval |
| `/embed` | POST | Generate embeddings (text/code/sparse/colbert) |

**Example: Hybrid Search**
```bash
curl -X POST http://localhost:6176/v1/search/query -H "Content-Type: application/json" -d '{
  "text": "OAuth2 implementation",
  "limit": 10,
  "strategy": "hybrid",
  "rerank": true,
  "rerank_tier": "accurate"
}'
```

## Configuration (Environment Variables)

```bash
SEARCH_PORT=6176                               # Server port
QDRANT_URL=http://localhost:6180               # Vector DB
NATS_URL=nats://localhost:6181                 # Event stream
EMBEDDER_DEVICE=cpu                            # cpu | cuda | mps | auto
EMBEDDER_TEXT_MODEL=BAAI/bge-base-en-v1.5      # Dense embeddings
RERANKER_ACCURATE_MODEL=BAAI/bge-reranker-v2-m3
RERANKER_LLM_MODEL=gemini-3-flash-preview
```

**Note**: ML deps (torch, sentence-transformers) are optional. Use `uv sync --group local` for local inference.

## Architecture

```
src/
├── main.py          # FastAPI app + NATS consumer lifespan
├── api/             # Routes (health, search, embed)
├── clients/         # Qdrant, NATS, Redis, PostgreSQL
├── embedders/       # Text, code, sparse, ColBERT
├── rerankers/       # FlashRank, cross-encoder, ColBERT, LLM
├── retrieval/       # Hybrid, multi-query, session-aware
├── indexing/        # NATS consumer, turns indexer
└── middleware/      # Auth, tracing, metrics
```

## Tech Stack

**Core**: FastAPI 0.126, Qdrant 1.16, NATS 2.9, PostgreSQL (asyncpg)
**ML**: sentence-transformers 5.1, litellm 1.80, fastembed 0.5 (optional: `uv sync --group local`)
**Observability**: structlog 25.5, prometheus-client 0.23

## Docker

```bash
docker build -t engram-search .                  # Production
docker run -p 6176:6176 -e QDRANT_URL=http://qdrant:6180 engram-search
```

## Related Services

**API** (6174) · **Ingestion** (6175) · **Memory** (6172) · **Tuner** (6177) · **Observatory** (6178)
