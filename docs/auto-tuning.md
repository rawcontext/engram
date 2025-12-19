# Engram Auto-Tuning Guide

This document describes strategies for automatically tuning Engram's configuration parameters to achieve optimal performance, similar to ECU/PCM tuning for automotive engines.

## Table of Contents

- [Philosophy: Dyno Tuning for Search](#philosophy-dyno-tuning-for-search)
- [Evaluation Metrics](#evaluation-metrics)
- [Architecture: Tuner Service](#architecture-tuner-service)
- [Implementation Plan](#implementation-plan)
- [API Reference](#api-reference)
- [Quick Start: Manual Tuning](#quick-start-manual-tuning)
- [Production Deployment](#production-deployment)
- [Tuning Recipes](#tuning-recipes)

---

## Philosophy: Dyno Tuning for Search

Just like tuning a car's ECU requires:
1. **A dyno** (controlled environment to measure output)
2. **Baseline measurement** (stock power curve)
3. **Iterative adjustments** (fuel maps, timing, boost)
4. **Real-time feedback** (AFR, knock, temps)
5. **Safety limits** (don't blow the engine)

Search tuning requires:
1. **Evaluation dataset** (ground-truth queries and answers)
2. **Baseline metrics** (current precision/recall/latency)
3. **Parameter sweeps** (thresholds, models, depths)
4. **Automated metrics** (RAGAS, NDCG, MRR)
5. **Guard rails** (latency budgets, cost limits)

---

## Evaluation Metrics

### Retrieval Metrics

| Metric | What It Measures | When to Use |
|--------|------------------|-------------|
| **Hit Rate** | % of queries where correct doc is in top-k | Quick sanity check |
| **MRR@k** | Average reciprocal rank of first correct doc | Single correct answer scenarios |
| **NDCG@k** | Graded relevance considering position | Multiple relevant docs with varying relevance |
| **Precision@k** | % of top-k results that are relevant | When false positives are costly |
| **Recall@k** | % of all relevant docs in top-k | When missing docs is costly |

**Research Grounding:**
- [Weaviate evaluation guide](https://weaviate.io/blog/retrieval-evaluation-metrics)
- [Pinecone offline evaluation](https://www.pinecone.io/learn/offline-evaluation/)
- MRR is used by Spotify for search evaluation

### Generation Metrics (RAGAS)

| Metric | What It Measures | Range |
|--------|------------------|-------|
| **Faithfulness** | Is the answer factually grounded? | 0-1 |
| **Answer Relevancy** | Does the answer address the question? | 0-1 |
| **Context Precision** | Are relevant docs ranked higher? | 0-1 |
| **Context Recall** | Is all needed info retrieved? | 0-1 |

**Research Grounding:**
- [RAGAS documentation](https://docs.ragas.io/en/stable/)
- [LlamaIndex + RAGAS integration](https://docs.ragas.io/en/stable/howtos/integrations/_llamaindex/)

### Latency Metrics

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| **P50 latency** | < 100ms | < 200ms |
| **P95 latency** | < 300ms | < 500ms |
| **P99 latency** | < 500ms | < 1000ms |

---

## Architecture: Tuner Service

Engram uses a **microservice architecture** for auto-tuning, separating the optimization engine (Python/Optuna) from the trial execution (TypeScript/Engram).

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Engram Auto-Tuning System                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────┐         ┌────────────────────────────────┐  │
│  │   packages/tuner (TS)      │   HTTP  │   apps/tuner-service (Python)  │  │
│  │                            │◄───────►│                                │  │
│  │  • Search space definition │         │  • Optuna optimization engine  │  │
│  │  • Trial orchestration     │         │  • Bayesian sampling (TPE)     │  │
│  │  • Benchmark integration   │         │  • Study persistence (Postgres)│  │
│  │  • Config application      │         │  • Multi-objective support     │  │
│  │  • CLI interface           │         │  • Pruning (Hyperband)         │  │
│  └────────────────────────────┘         └────────────────────────────────┘  │
│              │                                        │                      │
│              │                                        │                      │
│              ▼                                        ▼                      │
│  ┌────────────────────────────┐         ┌────────────────────────────────┐  │
│  │   packages/benchmark       │         │   Optuna Dashboard             │  │
│  │                            │         │                                │  │
│  │  • Evaluation harness      │         │  • Real-time visualization     │  │
│  │  • Metrics collection      │         │  • Parameter importance        │  │
│  │  • RAGAS integration       │         │  • Optimization history        │  │
│  └────────────────────────────┘         │  • Pareto frontier (MO)        │  │
│              │                          └────────────────────────────────┘  │
│              ▼                                        │                      │
│  ┌────────────────────────────┐                       │                      │
│  │   packages/search-core     │                       │                      │
│  │                            │                       ▼                      │
│  │  • RuntimeConfig updates   │         ┌────────────────────────────────┐  │
│  │  • Live parameter tuning   │         │   PostgreSQL                   │  │
│  └────────────────────────────┘         │                                │  │
│                                         │  • Study persistence           │  │
│                                         │  • Trial history               │  │
│                                         │  • Multi-node coordination     │  │
│                                         └────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Python for Optuna** | Required | Optuna is Python-only; best-in-class Bayesian optimization |
| **Microservice** | vs Subprocess | Persistent studies, dashboard, multi-user, always-warm |
| **FastAPI** | vs Litestar | Larger ecosystem, battle-tested, [OptunAPI](https://github.com/mbarbetti/optunapi) reference |
| **PostgreSQL** | vs SQLite | Required for [parallel/distributed optimization](https://optuna.readthedocs.io/en/stable/tutorial/10_key_features/004_distributed.html) |
| **TypeScript client** | Integration | Type-safe search space, integrates with existing TS tooling |

**Research Grounding:**
- [Optuna parallelization docs](https://optuna.readthedocs.io/en/stable/tutorial/10_key_features/004_distributed.html): SQLite not recommended for parallel optimization
- [Optuna Dashboard](https://github.com/optuna/optuna-dashboard): Production deployment via WSGI
- [FastAPI vs Litestar comparison](https://betterstack.com/community/guides/scaling-python/litestar-vs-fastapi/): FastAPI has 84k+ GitHub stars, enterprise adoption

### Component Details

#### 1. apps/tuner-service (Python)

The optimization brain. Runs Optuna and exposes a REST API.

```
apps/tuner-service/
├── src/
│   ├── main.py              # FastAPI application entry
│   ├── api/
│   │   ├── studies.py       # Study CRUD endpoints
│   │   ├── trials.py        # Trial suggest/complete endpoints
│   │   └── health.py        # Health check endpoints
│   ├── core/
│   │   ├── optuna_manager.py    # Optuna study management
│   │   ├── samplers.py          # Sampler configuration (TPE, GP, etc.)
│   │   └── pruners.py           # Pruner configuration (Hyperband, etc.)
│   ├── models/
│   │   ├── study.py         # Study Pydantic models
│   │   ├── trial.py         # Trial Pydantic models
│   │   └── search_space.py  # Search space definitions
│   └── config.py            # Service configuration
├── tests/
├── pyproject.toml           # Python dependencies (uv/poetry)
├── Dockerfile
└── README.md
```

**Key Dependencies:**
- `optuna>=4.0.0` - Optimization framework
- `optuna-dashboard>=0.15.0` - Web dashboard
- `fastapi>=0.110.0` - REST API framework
- `uvicorn>=0.27.0` - ASGI server
- `psycopg2-binary>=2.9.0` - PostgreSQL driver
- `pydantic>=2.0.0` - Data validation

#### 2. packages/tuner (TypeScript)

The orchestration layer. Defines search spaces, runs trials, applies configs.

```
packages/tuner/
├── src/
│   ├── index.ts             # Package exports
│   ├── cli/
│   │   ├── index.ts         # CLI entry point
│   │   └── commands/
│   │       ├── optimize.ts  # Start optimization
│   │       ├── status.ts    # Check study status
│   │       ├── apply.ts     # Apply best config
│   │       └── compare.ts   # Compare trials
│   ├── client/
│   │   ├── tuner-client.ts  # HTTP client for tuner-service
│   │   └── types.ts         # API types
│   ├── spaces/
│   │   ├── search-space.ts  # Search space definitions
│   │   ├── presets.ts       # Pre-defined search spaces
│   │   └── engram.ts        # Engram-specific parameters
│   ├── objectives/
│   │   ├── quality.ts       # NDCG, MRR, Hit Rate objectives
│   │   ├── latency.ts       # P50, P95, P99 objectives
│   │   ├── cost.ts          # API cost estimation
│   │   └── multi.ts         # Multi-objective combinations
│   └── executor/
│       ├── trial-runner.ts  # Execute single trial
│       └── parallel.ts      # Parallel trial execution
├── package.json
├── tsconfig.json
└── README.md
```

**Key Dependencies:**
- `@engram/benchmark` - Evaluation harness
- `@engram/search-core` - RuntimeConfig integration
- `@engram/common` - Shared utilities
- `commander` - CLI framework

#### 3. Optuna Dashboard

Real-time visualization of optimization progress.

**Features:**
- Optimization history plot (convergence over trials)
- Parameter importance analysis
- Parallel coordinate plots
- Contour plots (parameter interactions)
- Slice plots (individual parameter effects)
- Pareto frontier visualization (multi-objective)

**Deployment:**
```bash
# Via Docker (recommended)
docker run -p 8080:8080 \
  ghcr.io/optuna/optuna-dashboard \
  postgresql://user:pass@host:5432/optuna

# Or embedded in tuner-service via optuna_dashboard.run_server()
```

**Research Grounding:**
- [Optuna Dashboard docs](https://optuna-dashboard.readthedocs.io/en/stable/getting-started.html)
- For production, use WSGI server (Gunicorn) instead of built-in wsgiref

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Goal:** Basic infrastructure and API communication

#### 1.1 Python Service Setup

```python
# apps/tuner-service/src/main.py
from fastapi import FastAPI
from contextlib import asynccontextmanager
import optuna

app = FastAPI(title="Engram Tuner Service", version="0.1.0")

# Global study storage
storage: optuna.storages.RDBStorage = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global storage
    storage = optuna.storages.RDBStorage(
        url=settings.database_url,
        engine_kwargs={"pool_size": 20, "max_overflow": 40}
    )
    yield
    # Cleanup

@app.post("/studies")
async def create_study(request: CreateStudyRequest) -> StudyResponse:
    study = optuna.create_study(
        study_name=request.name,
        storage=storage,
        direction=request.direction,
        sampler=get_sampler(request.sampler),
        pruner=get_pruner(request.pruner),
        load_if_exists=True,
    )
    return StudyResponse(id=study._study_id, name=study.study_name)

@app.post("/studies/{study_id}/suggest")
async def suggest_trial(study_id: int) -> TrialSuggestion:
    study = optuna.load_study(study_name=..., storage=storage)
    trial = study.ask()

    # Suggest values based on registered search space
    params = {}
    for param in study.user_attrs.get("search_space", []):
        if param["type"] == "float":
            params[param["name"]] = trial.suggest_float(
                param["name"], param["low"], param["high"]
            )
        elif param["type"] == "int":
            params[param["name"]] = trial.suggest_int(
                param["name"], param["low"], param["high"]
            )
        elif param["type"] == "categorical":
            params[param["name"]] = trial.suggest_categorical(
                param["name"], param["choices"]
            )

    return TrialSuggestion(trial_id=trial.number, params=params)

@app.post("/studies/{study_id}/trials/{trial_id}/complete")
async def complete_trial(
    study_id: int,
    trial_id: int,
    result: TrialResult
) -> TrialResponse:
    study = optuna.load_study(study_name=..., storage=storage)
    study.tell(trial_id, result.values)
    return TrialResponse(...)
```

#### 1.2 TypeScript Client

```typescript
// packages/tuner/src/client/tuner-client.ts
export class TunerClient {
  constructor(private baseUrl: string = "http://localhost:8000") {}

  async createStudy(options: CreateStudyOptions): Promise<Study> {
    const response = await fetch(`${this.baseUrl}/studies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: options.name,
        direction: options.direction,
        search_space: options.searchSpace,
        sampler: options.sampler ?? "tpe",
        pruner: options.pruner ?? "hyperband",
      }),
    });
    return response.json();
  }

  async suggestTrial(studyId: string): Promise<TrialSuggestion> {
    const response = await fetch(
      `${this.baseUrl}/studies/${studyId}/suggest`,
      { method: "POST" }
    );
    return response.json();
  }

  async completeTrial(
    studyId: string,
    trialId: number,
    values: number | number[]
  ): Promise<void> {
    await fetch(
      `${this.baseUrl}/studies/${studyId}/trials/${trialId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      }
    );
  }

  async getBestParams(studyId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/studies/${studyId}/best`);
    return response.json();
  }
}
```

#### 1.3 Docker Compose Integration

```yaml
# docker-compose.dev.yml (additions)
services:
  tuner-service:
    build: ./apps/tuner-service
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/optuna
    depends_on:
      - postgres

  tuner-dashboard:
    image: ghcr.io/optuna/optuna-dashboard
    ports:
      - "8080:8080"
    command: ["postgresql://postgres:postgres@postgres:5432/optuna"]
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: optuna
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Phase 2: Search Space & Evaluation (Week 2)

**Goal:** Type-safe search space definitions and benchmark integration

#### 2.1 Engram Search Space

```typescript
// packages/tuner/src/spaces/engram.ts
import { z } from "zod";

export const EngramSearchSpace = {
  // Search thresholds
  "search.minScore.dense": {
    type: "float" as const,
    low: 0.60,
    high: 0.90,
    step: 0.05,
  },
  "search.minScore.hybrid": {
    type: "float" as const,
    low: 0.35,
    high: 0.65,
    step: 0.05,
  },

  // Reranker settings
  "reranker.depth": {
    type: "int" as const,
    low: 10,
    high: 100,
    step: 10,
  },
  "reranker.defaultTier": {
    type: "categorical" as const,
    choices: ["fast", "accurate", "code"],
  },
  "reranker.timeoutMs": {
    type: "int" as const,
    low: 200,
    high: 2000,
    step: 100,
  },

  // Abstention thresholds
  "abstention.minRetrievalScore": {
    type: "float" as const,
    low: 0.15,
    high: 0.50,
    step: 0.05,
  },
  "abstention.minScoreGap": {
    type: "float" as const,
    low: 0.05,
    high: 0.25,
    step: 0.05,
  },
} as const;

export type EngramSearchSpaceKey = keyof typeof EngramSearchSpace;
```

#### 2.2 Trial Runner Integration

```typescript
// packages/tuner/src/executor/trial-runner.ts
import { RuntimeConfig } from "@engram/search-core";
import { evaluateDataset } from "@engram/benchmark";

export async function runTrial(
  params: Record<string, unknown>,
  datasetPath: string
): Promise<TrialResult> {
  // Apply configuration
  RuntimeConfig.update({
    // Map flat params to nested config
    ...mapParamsToConfig(params),
  });

  // Run evaluation
  const startTime = Date.now();
  const metrics = await evaluateDataset({
    dataset: datasetPath,
    metrics: ["hitRate", "mrr", "ndcg", "precision", "recall"],
  });
  const latencyMs = Date.now() - startTime;

  // Collect latency metrics from benchmark
  const latencyMetrics = metrics.latency ?? {
    p50: latencyMs / metrics.totalQueries,
    p95: latencyMs / metrics.totalQueries * 1.5,
    p99: latencyMs / metrics.totalQueries * 2,
  };

  return {
    quality: {
      ndcg: metrics.ndcgAt10,
      mrr: metrics.mrr,
      hitRate: metrics.hitRate,
      precision: metrics.precision,
      recall: metrics.recall,
    },
    latency: latencyMetrics,
    cost: estimateCost(params),
  };
}
```

### Phase 3: Multi-Objective & Pruning (Week 3)

**Goal:** Support for Pareto optimization and early stopping

#### 3.1 Multi-Objective Configuration

```python
# Multi-objective study creation
study = optuna.create_study(
    study_name="engram-pareto",
    storage=storage,
    directions=["maximize", "minimize", "minimize"],  # quality, latency, cost
    sampler=optuna.samplers.NSGAIISampler(),
)
```

#### 3.2 Pruning Support

```python
# Hyperband pruner for early stopping
pruner = optuna.pruners.HyperbandPruner(
    min_resource=10,      # Minimum queries before pruning
    max_resource=1000,    # Full dataset size
    reduction_factor=3,
)

# In trial execution, report intermediate values
for i, batch in enumerate(dataset.batches()):
    metrics = evaluate_batch(batch, config)
    trial.report(metrics.ndcg, step=i)

    if trial.should_prune():
        raise optuna.TrialPruned()
```

**Research Grounding:**
- [Optuna multi-objective docs](https://optuna.readthedocs.io/en/stable/tutorial/20_recipes/002_multi_objective.html)
- NSGA-II sampler for Pareto optimization
- Hyperband for [efficient pruning](https://optuna.readthedocs.io/en/stable/tutorial/10_key_features/005_visualization.html)

### Phase 4: CLI & Production (Week 4)

**Goal:** User-friendly CLI and production deployment

#### 4.1 CLI Commands

```typescript
// packages/tuner/src/cli/index.ts
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("engram-tuner")
  .description("Hyperparameter optimization for Engram search")
  .version("0.1.0");

program
  .command("optimize")
  .description("Start a new optimization study")
  .requiredOption("-d, --dataset <path>", "Path to evaluation dataset")
  .option("-n, --name <name>", "Study name", "engram-study")
  .option("-t, --trials <n>", "Number of trials", parseInt, 100)
  .option("--objective <type>", "Objective: quality|latency|balanced|pareto", "balanced")
  .option("--sampler <type>", "Sampler: tpe|gp|random|nsgaii", "tpe")
  .option("--pruner <type>", "Pruner: hyperband|median|none", "hyperband")
  .option("--parallel <n>", "Parallel trial workers", parseInt, 1)
  .action(optimizeCommand);

program
  .command("status")
  .description("Check optimization status")
  .argument("<study>", "Study name")
  .option("--format <type>", "Output format: table|json", "table")
  .action(statusCommand);

program
  .command("best")
  .description("Get best parameters from a study")
  .argument("<study>", "Study name")
  .option("--apply", "Apply best config to environment", false)
  .option("--export <path>", "Export to .env file")
  .action(bestCommand);

program
  .command("compare")
  .description("Compare multiple studies")
  .argument("<studies...>", "Study names to compare")
  .action(compareCommand);

program.parse();
```

#### 4.2 Example Usage

```bash
# Start optimization
npx engram-tuner optimize \
  --dataset ./eval-data.jsonl \
  --name engram-v1 \
  --trials 100 \
  --objective balanced \
  --parallel 4

# Check progress (or use dashboard at http://localhost:8080)
npx engram-tuner status engram-v1

# Get best parameters
npx engram-tuner best engram-v1 --export .env.optimized

# Apply to production
source .env.optimized
npm run dev
```

---

## API Reference

### Studies API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/studies` | POST | Create a new study |
| `/studies` | GET | List all studies |
| `/studies/{id}` | GET | Get study details |
| `/studies/{id}` | DELETE | Delete a study |
| `/studies/{id}/suggest` | POST | Get next trial parameters |
| `/studies/{id}/trials/{tid}/complete` | POST | Report trial results |
| `/studies/{id}/trials/{tid}/prune` | POST | Mark trial as pruned |
| `/studies/{id}/best` | GET | Get best parameters |
| `/studies/{id}/pareto` | GET | Get Pareto frontier (multi-objective) |
| `/studies/{id}/importance` | GET | Get parameter importance |

### Request/Response Types

```typescript
interface CreateStudyRequest {
  name: string;
  direction: "maximize" | "minimize" | ("maximize" | "minimize")[];
  search_space: SearchSpaceParameter[];
  sampler?: "tpe" | "gp" | "random" | "nsgaii";
  pruner?: "hyperband" | "median" | "none";
}

interface SearchSpaceParameter {
  name: string;
  type: "float" | "int" | "categorical";
  low?: number;
  high?: number;
  step?: number;
  choices?: (string | number)[];
}

interface TrialSuggestion {
  trial_id: number;
  params: Record<string, unknown>;
}

interface TrialResult {
  values: number | number[];
  intermediate_values?: Record<number, number>;
  user_attrs?: Record<string, unknown>;
}
```

---

## Quick Start: Manual Tuning

For quick experiments without the full service:

### Step 1: Prepare Evaluation Data

```jsonl
{"query": "How do I configure the reranker?", "expected_doc_ids": ["config-guide.md"], "relevance": [1]}
{"query": "What is the default batch size?", "expected_doc_ids": ["limits.ts"], "relevance": [1]}
```

### Step 2: Run Baseline

```bash
cd packages/benchmark
npm run benchmark -- --dataset ./eval-data.jsonl --output ./baseline.json
```

### Step 3: Sweep Parameters

```bash
for threshold in 0.65 0.70 0.75 0.80; do
  SEARCH_MIN_SCORE_DENSE=$threshold npm run benchmark -- \
    --dataset ./eval-data.jsonl \
    --output "./sweep-dense-$threshold.json"
done
```

### Step 4: Compare Results

```bash
npm run benchmark:compare -- ./baseline.json ./sweep-*.json
```

---

## Production Deployment

### Infrastructure Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| tuner-service | 1 CPU, 512MB RAM | 2 CPU, 1GB RAM |
| tuner-dashboard | 1 CPU, 256MB RAM | 1 CPU, 512MB RAM |
| PostgreSQL | 1 CPU, 256MB RAM | 2 CPU, 1GB RAM |

### Environment Variables

```bash
# tuner-service
DATABASE_URL=postgresql://user:pass@host:5432/optuna
CORS_ORIGINS=["http://localhost:3000"]
LOG_LEVEL=info

# tuner-dashboard (if separate)
OPTUNA_DASHBOARD_STORAGE=postgresql://user:pass@host:5432/optuna
```

### Security Considerations

1. **Authentication**: Add API key authentication for production
2. **Rate limiting**: Limit trial creation to prevent abuse
3. **Network isolation**: Keep PostgreSQL on private network
4. **Secrets management**: Use proper secrets for database credentials

### Monitoring

Track these metrics:

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Active studies | tuner-service | > 10 (warn) |
| Trial queue depth | tuner-service | > 100 (warn) |
| PostgreSQL connections | PostgreSQL | > 80% pool (warn) |
| Dashboard latency | tuner-dashboard | > 2s (warn) |

---

## Tuning Recipes

### Recipe 1: Maximum Quality (Research/Offline)

```bash
npx engram-tuner optimize \
  --dataset ./eval-data.jsonl \
  --name quality-max \
  --objective quality \
  --trials 200 \
  --sampler gp
```

**Expected Config Range:**
- `reranker.defaultTier`: llm or accurate
- `reranker.depth`: 75-100
- `search.minScore.dense`: 0.80-0.85

### Recipe 2: Balanced Production

```bash
npx engram-tuner optimize \
  --dataset ./eval-data.jsonl \
  --name balanced-prod \
  --objective balanced \
  --trials 100
```

**Objective Function:**
```
0.5 * ndcg + 0.3 * (1 - p95_latency/500) + 0.2 * (1 - cost/0.01)
```

### Recipe 3: Pareto Optimization

```bash
npx engram-tuner optimize \
  --dataset ./eval-data.jsonl \
  --name pareto-frontier \
  --objective pareto \
  --trials 150 \
  --sampler nsgaii
```

**Objectives:** `[maximize(ndcg), minimize(p95_latency), minimize(cost)]`

View Pareto frontier in dashboard to pick optimal trade-off point.

---

## Appendix: Parameter Sensitivity

Based on research and experimentation:

| Parameter | Impact on Quality | Impact on Latency | Tuning Priority |
|-----------|-------------------|-------------------|-----------------|
| `reranker.depth` | HIGH | MEDIUM | 1 |
| `reranker.defaultTier` | HIGH | HIGH | 2 |
| `search.minScore.dense` | MEDIUM | LOW | 3 |
| `search.minScore.hybrid` | MEDIUM | LOW | 4 |
| `abstention.minRetrievalScore` | MEDIUM | NONE | 5 |
| `reranker.timeoutMs` | LOW | MEDIUM | 6 |

**Recommendation:** Start with parameters at the top of this list.

---

## Sources

- [Optuna: A hyperparameter optimization framework](https://optuna.org/)
- [Optuna Dashboard](https://github.com/optuna/optuna-dashboard)
- [Optuna Parallelization Guide](https://optuna.readthedocs.io/en/stable/tutorial/10_key_features/004_distributed.html)
- [Optuna Multi-Objective Optimization](https://optuna.readthedocs.io/en/stable/tutorial/20_recipes/002_multi_objective.html)
- [OptunAPI: REST API for Optuna](https://github.com/mbarbetti/optunapi)
- [AutoRAG-HP: Automatic Online Hyper-Parameter Tuning](https://arxiv.org/abs/2406.19251)
- [RAGAS: Evaluation framework for RAG](https://docs.ragas.io/en/stable/)
- [FastAPI vs Litestar Comparison](https://betterstack.com/community/guides/scaling-python/litestar-vs-fastapi/)
- [Bayesian vs Grid vs Random Search](https://blog.dailydoseofds.com/p/grid-search-vs-random-search-vs-bayesian)
- [Weaviate: Retrieval Evaluation Metrics](https://weaviate.io/blog/retrieval-evaluation-metrics)
- [Pinecone: Offline Evaluation](https://www.pinecone.io/learn/offline-evaluation/)
