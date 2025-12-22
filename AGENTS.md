# Engram

Bitemporal, graph-backed intelligent agent memory system. Hybrid TypeScript/Python monorepo.

## Critical Commands

```bash
# TypeScript (npm workspaces)
npm install              # Install all workspaces
npm run infra:up         # Start Redpanda, FalkorDB, Qdrant, Postgres
npm run infra:down       # Stop infrastructure
npm run dev              # Start all apps in dev mode
npm run build            # Build all apps/packages
npm test                 # Run vitest
npm run typecheck        # TypeScript validation
npm run lint             # Biome linting
npm run format           # Biome formatting

# Python apps (uv)
cd apps/search && uv sync      # Install dependencies
cd apps/search && uv run pytest  # Run tests
cd apps/search && uv run ruff check src tests  # Lint
cd apps/search && uv run ruff format src tests  # Format
cd apps/search && uv run search  # Start service

cd apps/tuner && uv sync       # Install tuner dependencies
cd apps/tuner && uv run tuner  # Start tuner service
```

## Code Standards

### TypeScript
- **Formatter/Linter**: Biome (tabs, double quotes, 100 char line width)
- **Package Manager**: npm only (never yarn/pnpm)
- **TypeScript**: Version 7 (tsgo), strict mode, ESNext target, bundler module resolution
- **Testing**: Vitest with globals enabled

#### TypeScript 7 Notes
- Uses `tsgo` - native Go implementation with ~10x faster builds
- Target `ESNext` for latest ES2025 features (Set methods, Iterator helpers, Promise.try, etc.)
- Downlevel emit only supports ES2021+, so modern Node.js runtimes required
- Multi-threaded builds and parallel project compilation enabled by default

IMPORTANT: Run `npm run lint` and `npm run typecheck` before committing.

### Python
- **Formatter/Linter**: Ruff (88 char line width, Python 3.12+)
- **Package Manager**: uv only (never pip/poetry/pdm)
- **Type Hints**: Required for all function signatures
- **Testing**: pytest with pytest-asyncio

IMPORTANT: Run `uv run ruff check` and `uv run pytest` before committing.

## Monorepo Structure

```
apps/
├── api/         # Cloud REST API (Hono) - memory operations, API key auth, rate limiting (port 8080)
├── control/     # Session orchestration, XState decision engine, VFS, MCP tool integration
├── ingestion/   # Event parsing pipeline, 8+ provider parsers, PII redaction (port 5001)
├── mcp/         # Engram MCP server - remember/recall/query/context tools (stdio + HTTP ingest)
├── memory/      # Graph persistence, turn aggregation, real-time pub/sub (Kafka consumer)
├── observatory/ # Neural Observatory - Next.js 16 real-time session visualization (port 5000)
├── search/      # Python/FastAPI vector search - hybrid retrieval, multi-tier reranking (port 5002)
└── tuner/       # Python/FastAPI hyperparameter optimization with Optuna (port 8000)

packages/
├── benchmark/   # LongMemEval evaluation suite (Python) - MTEB/BEIR benchmarks
├── common/      # Utilities, errors, constants, testing fixtures
├── events/      # Zod event schemas (RawStreamEvent, ParsedStreamEvent)
├── graph/       # Bitemporal graph models, repositories, QueryBuilder, GraphPruner
├── infra/       # Pulumi IaC for GCP/GKE (VPC, GKE Autopilot, databases)
├── logger/      # Pino structured logging with PII redaction and lifecycle management
├── parser/      # Provider stream parsers, ThinkingExtractor, DiffExtractor, Redactor
├── storage/     # FalkorDB, Kafka, PostgreSQL, Redis, GCS/blob clients
├── temporal/    # Rehydrator, TimeTravelService, ReplayEngine for time-travel
├── tsconfig/    # Shared TypeScript configuration (base.json)
├── tuner/       # TypeScript client, CLI, and trial executor for tuner service
└── vfs/         # VirtualFileSystem, NodeFileSystem, InMemoryFileSystem, PatchManager
```

## Architecture Quick Reference

**Data Flow**: External Agent → Ingestion → Kafka → Memory → FalkorDB → Search → Qdrant

**Storage**: FalkorDB (graph), Qdrant (vectors), Redpanda (events), Redis (pub/sub), PostgreSQL (API keys, Optuna)

**Bitemporal**: All nodes have `vt_start/vt_end` (valid time) + `tt_start/tt_end` (transaction time)

**Key Patterns**:
- See `packages/storage/src/falkor.ts:1` for graph client
- See `packages/graph/src/writer.ts:1` for bitemporal node creation
- See `apps/search/src/search/retrieval/retriever.py:1` for hybrid search pipeline
- See `apps/memory/src/aggregator.ts:1` for turn aggregation
- See `packages/temporal/src/rehydrator.ts:1` for VFS time-travel

## Provider Support

Parsers in `packages/parser/src/providers/`: Anthropic, OpenAI, Gemini, Claude Code, Cline, Codex, XAI, OpenCode

**Registry Aliases**: `claude` → `anthropic`, `gpt`/`gpt-4` → `openai`, `grok` → `xai`, `claude-code` → `claude_code`

## MCP Tools (apps/mcp)

| Tool | Purpose |
|------|---------|
| `engram_remember` | Store memory with content, type (decision/context/insight/preference/fact), tags |
| `engram_recall` | Retrieve memories by query with hybrid search and optional reranking |
| `engram_query` | Execute read-only Cypher queries (local mode only) |
| `engram_context` | Get comprehensive context for task (memories, file history, decisions) |
| `engram_summarize` | Summarize text using client LLM (requires sampling capability) |
| `engram_extract_facts` | Extract key facts from text as structured list |
| `engram_enrich_memory` | Auto-generate summary, keywords, category for memory |

**Resources (local mode)**: `memory://{id}`, `session://{id}/transcript`, `file-history://{path}`

**Prompts (local mode)**: `/e prime`, `/e recap`, `/e why`

## API Endpoints (apps/api)

| Endpoint | Method | Purpose | Scope |
|----------|--------|---------|-------|
| `/v1/health` | GET | Health check | Public |
| `/v1/memory/remember` | POST | Store memory with deduplication | `memory:write` |
| `/v1/memory/recall` | POST | Hybrid search with reranking | `memory:read` |
| `/v1/memory/query` | POST | Read-only Cypher queries | `query:read` |
| `/v1/memory/context` | POST | Comprehensive context assembly | `memory:read` |
| `/v1/keys` | GET | List API keys | `keys:manage` |
| `/v1/keys/revoke` | POST | Revoke API key | `keys:manage` |

## Search Service API (apps/search)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with Qdrant status |
| `/ready` | GET | Kubernetes readiness probe |
| `/metrics` | GET | Prometheus metrics |
| `/search` | POST | Hybrid search with strategy (dense/sparse/hybrid) and reranking |
| `/search/multi-query` | POST | LLM-driven query expansion (DMQR-RAG) |
| `/search/session-aware` | POST | Two-stage hierarchical retrieval across sessions |
| `/embed` | POST | Generate embeddings for external use |

**Reranker Tiers**: `fast` (FlashRank ~10ms), `accurate` (BGE cross-encoder ~50ms), `code` (Jina ~50ms), `colbert` (late interaction ~30ms), `llm` (Gemini 3.0 Flash ~500ms)

## Testing

```bash
npm test                           # All tests
npm test -- --filter=@engram/graph # Single package
npm test -- --watch               # Watch mode

# Python tests
cd apps/search && uv run pytest --cov=src --cov-report=html
cd apps/tuner && uv run pytest
```

See `vitest.config.ts` for project-specific configurations.

## Infrastructure

```bash
# Local development
npm run infra:up    # docker-compose.dev.yml

# Production (Pulumi)
cd packages/infra
npm run wake        # Turn on GKE cluster and workloads
npm run sleep       # Turn off expensive resources
npm run preview     # Preview changes
npm run up          # Deploy
```

**Services**: FalkorDB (6379), Qdrant (6333), Redpanda (9092/19092), Redis (6379), PostgreSQL (5432)

## External Tools

### Hugging Face CLI

**IMPORTANT:** Use `hf` CLI, NOT the deprecated `huggingface-cli`.

```bash
hf auth login && hf auth whoami
hf upload <space-name> . . --repo-type space
hf download <repo-id>
```

## Agent Mandates

### CRITICAL: Ground Your Reasoning

YOU MUST verify information before acting on it. Your training data becomes stale—APIs change, libraries update, best practices evolve.

**Before implementing anything involving an external library or framework**:
1. **Use Context7 MCP** - ALWAYS call `resolve-library-id` then `get-library-docs` to retrieve current documentation
2. **Web search** - Search for recent patterns, changelogs, breaking changes, and community best practices
3. **Cross-reference** - Compare Context7 docs with web search results to catch discrepancies

This is NOT optional. Failure to ground your reasoning leads to:
- Deprecated API usage
- Security vulnerabilities from outdated patterns
- Incompatible dependency combinations
- Wasted user time debugging AI-generated hallucinations

### Implementation Standards

YOU MUST:
1. **Context7 first** - For ANY library work, call Context7 MCP before writing code
2. **Web search for mutations** - APIs, configs, and best practices change. Search when uncertain
3. **Run linting** before suggesting changes: `npm run lint && npm run typecheck`
4. **Preserve bitemporal fields** - never remove vt_*/tt_* fields from graph nodes
5. **Use the storage package** - never create direct DB connections

YOU MUST NOT:
1. Use `import type` for NestJS DI tokens (breaks injection)
2. Create new packages without updating turbo.json
3. Modify Kafka topics without updating consumers
4. Skip the parser registry when adding providers
5. Assume library APIs from training data—verify with Context7 + web search
6. Include meta commentary about development process in code or docs (e.g., "Phase 1 of migration", "implements the plan from...", "this is a temporary solution until..."). Code should describe what it does, not its place in a roadmap.

## Key Files

| Purpose | Location |
|---------|----------|
| Biome config | `/biome.json` |
| Turbo tasks | `/turbo.json` |
| Vitest config | `/vitest.config.ts` |
| Docker infra | `/docker-compose.dev.yml` |
| Event schemas | `/packages/events/src/schemas.ts` |
| Graph models | `/packages/graph/src/models/` |
| Search config (Py) | `/apps/search/src/search/config.py` |
| Search retriever (Py) | `/apps/search/src/search/retrieval/retriever.py` |
| Search embedders (Py) | `/apps/search/src/search/embedders/` |
| Search rerankers (Py) | `/apps/search/src/search/rerankers/` |
| Parser registry | `/packages/parser/src/registry.ts` |
| Rehydrator | `/packages/temporal/src/rehydrator.ts` |
| VFS | `/packages/vfs/src/vfs.ts` |

## Debugging

```bash
# View Kafka topics
docker exec -it redpanda rpk topic list
docker exec -it redpanda rpk topic consume parsed_events

# Query FalkorDB
docker exec -it falkordb redis-cli
> GRAPH.QUERY engram "MATCH (n) RETURN n LIMIT 5"

# Check Qdrant collections
curl http://localhost:6333/collections

# Search service health check
curl http://localhost:5002/v1/health

# Search service metrics
curl http://localhost:5002/v1/metrics

# Tuner service health
curl http://localhost:8000/v1/health

# Optuna Dashboard
open http://localhost:8081
```

## Common Patterns

**Creating graph nodes** (always include bitemporal fields):
```typescript
// See packages/graph/src/writer.ts
await writer.writeNode("Session", {
  id: generateId(),
  vt_start: Date.now(),
  tt_start: Date.now(),
  // ... node-specific fields
});
```

**Publishing events**:
```typescript
// See packages/storage/src/kafka.ts
await producer.send({
  topic: "parsed_events",
  messages: [{ key: sessionId, value: JSON.stringify(event) }]
});
```

**Hybrid search (Python)**:
```python
# See apps/search/src/search/retrieval/retriever.py
results = await retriever.search(
    query="user question",
    strategy="hybrid",
    rerank=True,
    rerank_tier="accurate",
    limit=20
)
```

**Time-travel VFS reconstruction**:
```typescript
// See packages/temporal/src/rehydrator.ts
const rehydrator = createRehydrator();
const vfs = await rehydrator.rehydrate("session-123", 1640000000000);
const content = vfs.readFile("/src/index.ts");
```

**Using parser registry**:
```typescript
// See packages/parser/src/registry.ts
import { defaultRegistry } from "@engram/parser";
const parser = defaultRegistry.get("anthropic"); // or "claude", "gpt", "xai"
const delta = parser.parse(rawEvent);
```

---

For detailed architecture diagrams, see `/ARCHITECTURE.md`.
