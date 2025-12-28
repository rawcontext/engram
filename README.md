# Engram

Bitemporal, graph-backed memory system for AI coding agents. Captures reasoning traces from Claude Code, Codex CLI, and others into a knowledge graph with full temporal history.

[engram_preview.webm](https://github.com/user-attachments/assets/f869ee5a-5f45-4d84-a33c-757e3d17276d)

## Quick Start

```bash
# Prerequisites: Bun v1.3.5+, Docker, Python 3.12+ with uv

git clone https://github.com/ccheney/engram.git
cd engram
bun install
bun run infra:up   # Start FalkorDB, Qdrant, NATS, PostgreSQL
bun run dev        # Start all services
```

**Verify**: Observatory http://localhost:6178 | API http://localhost:6174/v1/health

## Architecture

```
CLI Agents → Ingestion (6175) → NATS → Memory → FalkorDB
                                    ↓
                              Search (6176) → Qdrant
                                    ↓
                           Neural Observatory (6178)
```

**Storage**: FalkorDB (graph), Qdrant (vectors), NATS+JetStream (events), PostgreSQL (API keys/usage)

**Bitemporal**: All graph nodes track `vt_start/vt_end` (valid time) and `tt_start/tt_end` (transaction time) for time-travel queries.

## Project Structure

### Applications

| App | Port | Purpose |
|-----|------|---------|
| [api](apps/api) | 6174 | REST API - memory ops, OAuth, rate limiting, OpenTofu state backend |
| [ingestion](apps/ingestion) | 6175 | Event parsing from 8+ providers, PII redaction |
| [mcp](apps/mcp) | stdio | MCP server - remember/recall/query/context tools |
| [memory](apps/memory) | - | Graph persistence, turn aggregation, NATS consumer |
| [observatory](apps/observatory) | 6178 | Next.js 16 real-time session visualization |
| [search](apps/search) | 6176 | Python/FastAPI hybrid search, multi-tier reranking |
| [tuner](apps/tuner) | 6177 | Python/FastAPI Optuna hyperparameter optimization |

### Packages

| Package | Purpose |
|---------|---------|
| [benchmark](packages/benchmark) | LongMemEval/MTEB/BEIR evaluation suite (Python) |
| [common](packages/common) | Utilities, errors, constants, test fixtures |
| [engram-plugin](packages/engram-plugin) | Claude Code plugin for memory commands |
| [events](packages/events) | Zod schemas for RawStreamEvent/ParsedStreamEvent |
| [graph](packages/graph) | Bitemporal models, repositories, QueryBuilder |
| [infra](packages/infra) | OpenTofu IaC for Hetzner Cloud deployment |
| [logger](packages/logger) | Pino structured logging with PII redaction |
| [parser](packages/parser) | Provider parsers, extractors, redaction |
| [storage](packages/storage) | FalkorDB, NATS, PostgreSQL, Redis, blob clients |
| [temporal](packages/temporal) | Rehydrator, TimeTravelService, ReplayEngine |
| [tsconfig](packages/tsconfig) | Shared TypeScript 7 configuration |
| [tuner](packages/tuner) | TypeScript client/CLI for tuner service |
| [vfs](packages/vfs) | VirtualFileSystem, NodeFileSystem, PatchManager |

## Commands

```bash
# Development
bun run dev          # Start all services
bun run infra:up     # Start infrastructure (Docker)
bun run infra:down   # Stop infrastructure

# Build & Test
bun run build        # Build all packages
bun run test         # Run Vitest tests
bun run typecheck    # TypeScript validation
bun run lint         # Biome linting
bun run format       # Biome formatting

# Python services
cd apps/search && uv sync && uv run search
cd apps/tuner && uv sync && uv run tuner
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `remember` | Store memory with type (decision/insight/preference/fact) and tags |
| `recall` | Retrieve memories via hybrid semantic/keyword search |
| `query` | Execute read-only Cypher queries (local mode) |
| `context` | Comprehensive context assembly for tasks (local mode) |
| `summarize` | Condense text using client LLM (requires sampling) |
| `extract_facts` | Parse text into atomic facts (requires sampling) |
| `enrich_memory` | Auto-generate summary/keywords/category (requires sampling) |

## API Endpoints

| Endpoint | Method | Scope | Purpose |
|----------|--------|-------|---------|
| `/v1/health` | GET | Public | Health check |
| `/v1/memory/remember` | POST | `memory:write` | Store memory with deduplication |
| `/v1/memory/recall` | POST | `memory:read` | Hybrid search with reranking |
| `/v1/memory/query` | POST | `query:read` | Read-only Cypher queries |
| `/v1/memory/context` | POST | `memory:read` | Context assembly |
| `/v1/tofu` | GET/POST | `state:write` | OpenTofu remote state |

## Providers

Ingestion supports 8+ LLM providers:

| Provider | Key | Aliases |
|----------|-----|---------|
| Anthropic | `anthropic` | `claude` |
| OpenAI | `openai` | `gpt`, `gpt-4` |
| Google Gemini | `gemini` | - |
| XAI (Grok) | `xai` | `grok` |
| Claude Code | `claude_code` | `claude-code` |
| Cline | `cline` | - |
| Codex | `codex` | - |
| OpenCode | `opencode` | - |

## Infrastructure

All services use Kaprekar's constant (6174) as the base port.

| Service | Port | Category |
|---------|------|----------|
| API | 6174 | Service |
| Ingestion | 6175 | Service |
| Search | 6176 | Service |
| Tuner | 6177 | Service |
| Observatory | 6178 | Service |
| FalkorDB | 6179 | Database |
| Qdrant | 6180 | Database |
| NATS | 6181 | Database |
| NATS Monitor | 6182 | Dev Tool |
| PostgreSQL | 6183 | Database |
| Optuna Dashboard | 6184 | Dev Tool |
| Console | 6185 | Service |

## Tech Stack

- **TypeScript**: Bun runtime, TypeScript 7 (tsgo), Biome
- **Python**: uv, Ruff, FastAPI, Optuna, sentence-transformers
- **Graph**: FalkorDB (Redis-based graph DB)
- **Vectors**: Qdrant with BGE/SPLADE embeddings
- **Messaging**: NATS JetStream
- **Frontend**: Next.js 16, React 19, React Flow

## License

AGPL-3.0
