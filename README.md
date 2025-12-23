# Engram

Bitemporal, graph-backed memory system for AI coding agents. Captures reasoning traces from Claude Code, Codex CLI, and others into a knowledge graph with full temporal history.

[engram_preview.webm](https://github.com/user-attachments/assets/f869ee5a-5f45-4d84-a33c-757e3d17276d)

## Quick Start

```bash
# Prerequisites: Bun v1.3.5+, Docker

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

**Storage**: FalkorDB (graph), Qdrant (vectors), NATS+JetStream (events), PostgreSQL (API keys)

## Project Structure

```
apps/
├── api/          # REST API - memory operations, auth, rate limiting (6174)
├── control/      # Session orchestration, VFS, time-travel
├── ingestion/    # Event parsing, PII redaction (6175)
├── mcp/          # MCP server - remember/recall/query tools
├── memory/       # Graph persistence, turn aggregation
├── observatory/  # Real-time visualization (6178)
├── search/       # Python/FastAPI hybrid search (6176)
└── tuner/        # Python/FastAPI hyperparameter optimization (6177)

packages/
├── benchmark/    # LongMemEval evaluation (Python)
├── common/       # Utilities, errors
├── events/       # Zod event schemas
├── graph/        # Bitemporal models, repositories
├── infra/        # Pulumi IaC (GCP/GKE)
├── logger/       # Pino structured logging
├── parser/       # Provider parsers (8 formats)
├── storage/      # DB clients (Kafka, Redis, FalkorDB, Qdrant)
├── temporal/     # Time-travel, rehydration
├── tuner/        # Tuner client, CLI
└── vfs/          # Virtual file system
```

## Commands

```bash
bun run dev          # Start all services
bun run build        # Build everything
bun test             # Run tests
bun run typecheck    # TypeScript validation
bun run lint         # Biome linting
bun run infra:up     # Start infrastructure
bun run infra:down   # Stop infrastructure
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `engram_remember` | Store memory with type and tags |
| `engram_recall` | Retrieve memories via hybrid search |
| `engram_query` | Execute Cypher queries (local only) |
| `engram_context` | Get comprehensive context for task |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/memory/remember` | POST | Store memory |
| `/v1/memory/recall` | POST | Hybrid search |
| `/v1/memory/query` | POST | Cypher query |
| `/v1/memory/context` | POST | Context assembly |

## Providers

Anthropic, OpenAI, Gemini, Claude Code, Cline, Codex, XAI, OpenCode

## Infrastructure

All services use Kaprekar's constant (6174) as the base port - a number with unique mathematical convergence properties that mirrors Engram's goal of converging memory traces into coherent knowledge.

| Service | Port |
|---------|------|
| API | 6174 |
| Ingestion | 6175 |
| Search | 6176 |
| Tuner | 6177 |
| Observatory | 6178 |
| FalkorDB | 6179 |
| Qdrant | 6180 |
| NATS | 6181 |
| NATS Monitor | 6182 |
| PostgreSQL | 6183 |
| Optuna Dashboard | 6184 |

## License

AGPL-3.0
