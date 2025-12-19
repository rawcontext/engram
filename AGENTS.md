# Engram

Bitemporal, graph-backed intelligent agent memory system. TypeScript monorepo.

## Critical Commands

```bash
npm install              # Install all workspaces
npm run infra:up         # Start Redpanda, FalkorDB, Qdrant, Postgres
npm run infra:down       # Stop infrastructure
npm run dev              # Start all apps in dev mode
npm run build            # Build all apps/packages
npm test                 # Run vitest
npm run typecheck        # TypeScript validation
npm run lint             # Biome linting
npm run format           # Biome formatting
```

## Code Standards

- **Formatter/Linter**: Biome (tabs, double quotes, 100 char line width)
- **Package Manager**: npm only (never yarn/pnpm)
- **TypeScript**: Strict mode, ES2022 target, NodeNext modules
- **Testing**: Vitest with globals enabled

IMPORTANT: Run `npm run lint` and `npm run typecheck` before committing.

## Monorepo Structure

```
apps/
├── control/     # Session orchestration, VFS, time-travel
├── ingestion/   # Event parsing pipeline (port 5001)
├── interface/   # Next.js 16 frontend (port 3000/5000)
├── mcp/         # Model Context Protocol server (stdio)
├── memory/      # Graph persistence, real-time pub/sub
├── search/      # Vector search & reranking (port 5002)
└── tuner/       # Python/FastAPI hyperparameter tuning (port 8000)

packages/
├── benchmark/   # LongMemEval evaluation suite
├── common/      # Utilities, errors, constants
├── events/      # Zod event schemas (RawStreamEvent, ParsedStreamEvent)
├── graph/       # Bitemporal graph models & repositories
├── infra/       # Pulumi IaC for GCP/GKE
├── logger/      # Pino structured logging
├── parser/      # Provider stream parsers (8+ LLMs)
├── search/      # Embedders, retrieval, reranking
├── storage/     # Falkor, Kafka, Redis, GCS clients
├── temporal/    # Bitemporal state, time-travel
├── tsconfig/    # Shared TypeScript config
├── tuner/       # Tuner orchestration client
└── vfs/         # Virtual file system for snapshots
```

## Architecture Quick Reference

**Data Flow**: External Agent → Interface → Ingestion → Kafka → Memory → FalkorDB → Search → Qdrant

**Storage**: FalkorDB (graph), Qdrant (vectors), Redpanda (events), Redis (pub/sub)

**Bitemporal**: All nodes have `vt_start/vt_end` (valid time) + `tt_start/tt_end` (transaction time)

**Key Patterns**:
- See `packages/storage/src/falkor.ts:1` for graph client
- See `packages/graph/src/writer.ts:1` for bitemporal node creation
- See `packages/search/src/retriever.ts:1` for hybrid search pipeline
- See `apps/memory/src/aggregator.ts:1` for turn aggregation

## Provider Support

Parsers in `packages/parser/src/providers/`: Anthropic, OpenAI, Gemini, Claude Code, Cline, Codex, XAI, OpenCode

## MCP Tools (apps/mcp)

| Tool | Purpose |
|------|---------|
| `remember` | Store memory with content, type, tags |
| `recall` | Retrieve relevant memories by query |
| `query` | Execute raw Cypher on graph |
| `context` | Get comprehensive context for query |

## Testing

```bash
npm test                           # All tests
npm test -- --filter=@engram/graph # Single package
npm test -- --watch               # Watch mode
```

See `vitest.config.ts` for project-specific configurations.

## Infrastructure

```bash
# Local development
npm run infra:up    # docker-compose.dev.yml

# Production (Pulumi)
cd packages/infra && pulumi preview
cd packages/infra && pulumi up
```

## External Tools

### Hugging Face CLI

**IMPORTANT:** Use `hf` CLI, NOT the deprecated `huggingface-cli`.

```bash
# Auth
hf auth login
hf auth whoami

# Upload to Spaces
hf upload <space-name> . . --repo-type space

# Download models/datasets
hf download <repo-id>
```

Install with: `pip install huggingface_hub[cli]`

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

## Key Files

| Purpose | Location |
|---------|----------|
| Biome config | `/biome.json` |
| Turbo tasks | `/turbo.json` |
| Vitest config | `/vitest.config.ts` |
| Docker infra | `/docker-compose.dev.yml` |
| Event schemas | `/packages/events/src/schemas.ts` |
| Graph models | `/packages/graph/src/models/` |
| Search config | `/packages/search/src/config.ts` |

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
```

## Common Patterns

**Creating graph nodes** (always include bitemporal fields):
```typescript
// See packages/graph/src/writer.ts
await writer.createNode({
  id: generateId(),
  vt_start: new Date().toISOString(),
  tt_start: new Date().toISOString(),
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

**Hybrid search**:
```typescript
// See packages/search/src/retriever.ts
const results = await retriever.search({
  query: "user question",
  hybridSearch: true,
  rerank: true,
  rerankerTier: "accurate"
});
```

---

For detailed architecture diagrams, see `/ARCHITECTURE.md`.
