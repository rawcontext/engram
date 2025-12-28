# Engram

Bitemporal, graph-backed intelligent agent memory system. Hybrid TypeScript/Python monorepo.

## Critical Commands

```bash
# TypeScript (bun workspaces)
bun install              # Install all workspaces
bun run infra:up         # Start NATS, FalkorDB, Qdrant, Postgres
bun run infra:down       # Stop infrastructure
bun run dev              # Start all apps in dev mode
bun run build            # Build all apps/packages
bun run test             # Run vitest (NOT `bun test` - that uses Bun's native runner)
bun run typecheck        # TypeScript validation
bun run lint             # Biome linting
bun run format           # Biome formatting

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
- **Package Manager**: bun only (never npm/yarn/pnpm)
- **TypeScript**: Version 7 (tsgo), strict mode, ESNext target, bundler module resolution
- **Testing**: Vitest with globals enabled

#### TypeScript 7 Notes
- Uses `tsgo` - native Go implementation with ~10x faster builds
- Target `ESNext` for latest ES2025 features (Set methods, Iterator helpers, Promise.try, etc.)
- Downlevel emit only supports ES2021+, so modern Bun runtime required
- Multi-threaded builds and parallel project compilation enabled by default

IMPORTANT: Run `bun run lint` and `bun run typecheck` before committing.

### Python
- **Formatter/Linter**: Ruff (88 char line width, Python 3.12+)
- **Package Manager**: uv only (never pip/poetry/pdm)
- **Type Hints**: Required for all function signatures
- **Testing**: pytest with pytest-asyncio

IMPORTANT: Run `uv run ruff check` and `uv run pytest` before committing.

## Monorepo Structure

```
apps/
├── api/         # Cloud REST API (Hono) - memory operations, API key auth, rate limiting (port 6174)
├── ingestion/   # Event parsing pipeline, 8+ provider parsers, PII redaction (port 6175)
├── mcp/         # Engram MCP server - remember/recall/query/context tools (stdio + HTTP ingest)
├── memory/      # Graph persistence, turn aggregation, real-time pub/sub (NATS consumer)
├── observatory/ # Neural Observatory - Next.js 16 real-time session visualization (port 6178)
├── search/      # Python/FastAPI vector search - hybrid retrieval, multi-tier reranking (port 6176)
└── tuner/       # Python/FastAPI hyperparameter optimization with Optuna (port 6177)

packages/
├── benchmark/   # LongMemEval evaluation suite (Python) - MTEB/BEIR benchmarks
├── common/      # Utilities, errors, constants, testing fixtures
├── events/      # Zod event schemas (RawStreamEvent, ParsedStreamEvent)
├── graph/       # Bitemporal graph models, repositories, QueryBuilder, GraphPruner
├── infra/       # Pulumi IaC for GCP/GKE (VPC, GKE Autopilot, databases)
├── logger/      # Pino structured logging with PII redaction and lifecycle management
├── parser/      # Provider stream parsers, ThinkingExtractor, DiffExtractor, Redactor
├── storage/     # FalkorDB, NATS, PostgreSQL, Redis, GCS/blob clients
├── temporal/    # Rehydrator, TimeTravelService, ReplayEngine for time-travel
├── tsconfig/    # Shared TypeScript configuration (base.json)
├── tuner/       # TypeScript client, CLI, and trial executor for tuner service
└── vfs/         # VirtualFileSystem, NodeFileSystem, InMemoryFileSystem, PatchManager
```

## Architecture Quick Reference

**Data Flow**: External Agent → Ingestion → NATS → Memory → FalkorDB → Search → Qdrant

**Storage**: FalkorDB (graph), Qdrant (vectors), NATS+JetStream (events), PostgreSQL (API keys, Optuna)

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

| Tool | Purpose | When to Use Proactively |
|------|---------|------------------------|
| `remember` | Persist valuable information to long-term memory | When learning user preferences, architectural decisions, project conventions, debugging insights |
| `recall` | Search memories using semantic similarity | At session start to prime with prior knowledge; before making decisions to check for existing rationale |
| `context` | Assemble comprehensive context (memories + decisions + file history) | At the START of complex tasks; more thorough than recall alone |
| `query` | Execute read-only Cypher queries (local mode) | When semantic search can't handle complex lookups (date ranges, relationships, counts) |
| `summarize` | Condense text using client LLM | Before storing memories; to compress verbose logs or context |
| `extract_facts` | Parse unstructured text into atomic facts | Before `remember` when processing docs, logs, or chat history |
| `enrich_memory` | Auto-generate summary, keywords, category | Before `remember` - use output to set type and tags |

**Resources (local mode)**: `memory://{id}`, `session://{id}/transcript`, `file-history://{path}`

**Prompts (local mode)**: `/e prime` (initialize session), `/e recap` (review past session), `/e why` (find past decisions)

**Sampling-Required Tools**: `summarize`, `extract_facts`, and `enrich_memory` require the MCP client to support **sampling capability** (server requesting LLM completions from the client). If unsupported, these tools return `available: false` gracefully.

## Engram Memory Triggers

### ALWAYS Recall Before:
- Starting any non-trivial task → `context(task)`
- Making architectural or design decisions → `recall("decisions about X", type='decision')`
- Working on files modified in previous sessions → include in `context(task, files=[...])`
- When user says "remember", "before", "last time", "we decided" → `recall(query)`

### ALWAYS Remember When:
- User expresses a preference ("I prefer...", "always use...", "never...") → `type: 'preference'`
- You make an architectural decision with rationale → `type: 'decision'`
- You discover something non-obvious while debugging → `type: 'insight'`
- You learn a project convention or pattern → `type: 'fact'`

### NEVER Remember:
- Transient status ("working on X", "about to...")
- Obvious facts already in code comments
- Temporary workarounds without noting they're temporary
- Duplicate information already stored

## Engram Quick Reference

| Trigger | Action |
|---------|--------|
| Starting a task | `context(task, files, depth='medium')` |
| User says "remember when..." | `recall(query, filters={type: 'turn'})` |
| Before making a decision | `recall("decisions about X", filters={type: 'decision'})` |
| Learn user preference | `remember(content, type='preference', tags=[...])` |
| Make architectural choice | `remember(content, type='decision', tags=[...])` |
| Debug discovery | `remember(content, type='insight', tags=[...])` |
| Processing verbose content | `extract_facts(text)` → `remember` each fact |

### Graph Schema (for `query`)
- **`Memory`**: `content`, `type`, `tags`, `project`, `vt_start`, `vt_end`
- **`Session`**: `id`, `agent_type`, `working_dir`, `summary`
- **`Turn`**: `user_content`, `assistant_preview`, `files_touched`, `tool_calls_count`
- **`FileTouch`**: `file_path`, `action` (read/edit/create/delete)

**Example**: `MATCH (m:Memory {type: 'decision'}) WHERE m.vt_end > $now RETURN m.content ORDER BY m.vt_start DESC LIMIT 5`

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

All endpoints are prefixed with `/v1/search`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/search/health` | GET | Health check with Qdrant status |
| `/v1/search/ready` | GET | Kubernetes readiness probe |
| `/v1/search/metrics` | GET | Prometheus metrics |
| `/v1/search/query` | POST | Hybrid search with strategy (dense/sparse/hybrid) and reranking |
| `/v1/search/multi-query` | POST | LLM-driven query expansion (DMQR-RAG) |
| `/v1/search/session-aware` | POST | Two-stage hierarchical retrieval across sessions |
| `/v1/search/embed` | POST | Generate embeddings for external use |

**Reranker Tiers**: `fast` (FlashRank ~10ms), `accurate` (BGE cross-encoder ~50ms), `code` (Jina ~50ms), `colbert` (late interaction ~30ms), `llm` (Gemini 3.0 Flash ~500ms)

## Testing

```bash
bun test                           # All tests
bun test -- --filter=@engram/graph # Single package
bun test -- --watch               # Watch mode

# Python tests
cd apps/search && uv run pytest --cov=src --cov-report=html
cd apps/tuner && uv run pytest
```

See `vitest.config.ts` for project-specific configurations.

## Infrastructure

```bash
# Local development
bun run infra:up    # docker-compose.dev.yml

# Production (Pulumi)
cd packages/infra
bun run wake        # Turn on GKE cluster and workloads
bun run sleep       # Turn off expensive resources
bun run preview     # Preview changes
bun run up          # Deploy
```

**Services**: API (6174), Ingestion (6175), Search (6176), Tuner (6177), Observatory (6178), FalkorDB (6179), Qdrant (6180), NATS (6181), Console (6182), PostgreSQL (6183)

## External Tools

### Hugging Face CLI

**IMPORTANT:** Use `hf` CLI, NOT the deprecated `huggingface-cli`.

```bash
hf auth login && hf auth whoami
hf upload <space-name> . . --repo-type space
hf download <repo-id>
```

## Agent Mandates

### CRITICAL: Use Institutional Memory (Engram)

YOU MUST leverage Engram for institutional knowledge. Don't start tasks blind.

**At session start or when beginning significant work**:
1. **Prime yourself** - Call `engram_context` with a specific task description
2. **Check for precedent** - Before architectural decisions, call `engram_recall` with `type: 'decision'`
3. **Review file history** - If modifying files touched in past sessions, include them in context

**When you learn something valuable**:
1. **Store decisions** - Architectural choices with rationale → `engram_remember` with `type: 'decision'`
2. **Store preferences** - User preferences and conventions → `type: 'preference'`
3. **Store insights** - Debugging discoveries, non-obvious learnings → `type: 'insight'`

This is NOT optional. Failure to use institutional memory leads to:
- Repeating past mistakes
- Contradicting previous decisions
- Missing established patterns
- Wasted user time re-explaining context

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
3. **Run linting** before suggesting changes: `bun run lint && bun run typecheck`
4. **Preserve bitemporal fields** - never remove vt_*/tt_* fields from graph nodes
5. **Use the storage package** - never create direct DB connections

YOU MUST NOT:
1. Use `import type` for NestJS DI tokens (breaks injection)
2. Create new packages without updating turbo.json
3. Modify NATS subjects without updating consumers
4. Skip the parser registry when adding providers
5. Assume library APIs from training data—verify with Context7 + web search
6. Include meta commentary about development process in code or docs (e.g., "Phase 1 of migration", "implements the plan from...", "this is a temporary solution until..."). Code should describe what it does, not its place in a roadmap.

## Key Files

| Purpose | Location |
|---------|----------|
| Biome config | `/biome.json` |
| Turbo tasks | `/turbo.json` |
| Vitest config | `/vitest.config.ts` |
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
# View NATS streams
docker exec -it engram-nats-1 nats stream ls

# Query FalkorDB
docker exec -it engram-falkordb-1 redis-cli
> GRAPH.QUERY engram "MATCH (n) RETURN n LIMIT 5"

# Check Qdrant collections
curl http://localhost:6180/collections

# Search service health check
curl http://localhost:6176/v1/search/health

# Search service metrics
curl http://localhost:6176/v1/search/metrics

# Tuner service health
curl http://localhost:6177/v1/tuner/health

# Optuna Dashboard
open http://localhost:6184
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
// See packages/storage/src/nats.ts
await nats.sendEvent("events.parsed", sessionId, event);
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
