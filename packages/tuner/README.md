# @engram/tuner

Hyperparameter optimization orchestration for Engram's search system.

## Overview

Provides a TypeScript client, CLI, and execution framework for automated hyperparameter tuning of the Engram search pipeline. Integrates with the Python tuner service (`apps/tuner`) which uses Optuna for Bayesian optimization.

## Installation

```bash
npm install @engram/tuner
```

## Architecture

- **TunerClient**: HTTP client for the tuner service API (`apps/tuner`)
- **Search Spaces**: Pre-defined parameter ranges for search, reranking, and abstention
- **Trial Executor**: Runs benchmark evaluations with suggested parameters
- **CLI**: Command-line interface for optimization workflows
- **Config Mapper**: Converts flat parameter names to structured configurations

## TunerClient

HTTP client for interacting with the Python tuner service.

```typescript
import { TunerClient } from "@engram/tuner";

const client = new TunerClient({
  baseUrl: "http://localhost:8000/api/v1",
  timeout: 30000,
});

// Health check
const health = await client.health();

// Create a study
const study = await client.createStudy({
  name: "search-optimization",
  direction: "maximize",
  search_space: searchSpaceParams,
  sampler: "tpe",
  pruner: "hyperband",
});

// Get next trial parameters
const suggestion = await client.suggestTrial("search-optimization");

// Report trial results
await client.completeTrial("search-optimization", suggestion.trial_id, {
  values: 0.85, // objective value(s)
  user_attrs: { ndcg: 0.85, p95_latency: 120 },
});

// Get best parameters
const best = await client.getBestParams("search-optimization");

// Analyze parameter importance
const importance = await client.getParamImportance("search-optimization");

// Get Pareto front (multi-objective)
const pareto = await client.getParetoFront("search-optimization");
```

### Client Methods

| Method | Description |
|--------|-------------|
| `health()` | Check service health and storage connectivity |
| `createStudy(req)` | Create a new optimization study |
| `listStudies()` | List all studies |
| `getStudy(name)` | Get study details |
| `deleteStudy(name)` | Delete a study |
| `suggestTrial(name)` | Get next parameters to evaluate |
| `completeTrial(name, id, req)` | Report trial results |
| `listTrials(name, opts)` | List trials for a study |
| `getBestParams(name)` | Get best parameters found |
| `getParetoFront(name)` | Get Pareto-optimal trials |
| `getParamImportance(name)` | Analyze parameter importance |

## Search Spaces

Pre-defined search spaces for Engram parameters.

```typescript
import { EngramSearchSpace, buildSearchSpace, SearchSpacePresets } from "@engram/tuner";

// Use pre-built presets
const quickSpace = SearchSpacePresets.quick;        // ~27 trials
const standardSpace = SearchSpacePresets.standard;  // ~729 trials
const fullSpace = SearchSpacePresets.full;          // All parameters

// Build custom space
const customSpace = buildSearchSpace([
  "reranker.depth",
  "reranker.defaultTier",
  "search.minScore.dense",
]);
```

### Available Parameters

| Parameter | Type | Range |
|-----------|------|-------|
| `search.minScore.dense` | float | 0.6 - 0.9 (step: 0.05) |
| `search.minScore.hybrid` | float | 0.35 - 0.65 (step: 0.05) |
| `search.minScore.sparse` | float | 0.05 - 0.2 (step: 0.05) |
| `reranker.depth` | int | 10 - 100 (step: 10) |
| `reranker.defaultTier` | categorical | fast, accurate, code |
| `reranker.timeoutMs` | int | 200 - 2000 (step: 100) |
| `reranker.tiers.fast.maxCandidates` | int | 20 - 100 (step: 10) |
| `reranker.tiers.accurate.maxCandidates` | int | 10 - 50 (step: 5) |
| `reranker.tiers.code.maxCandidates` | int | 10 - 50 (step: 5) |
| `abstention.minRetrievalScore` | float | 0.15 - 0.5 (step: 0.05) |
| `abstention.minScoreGap` | float | 0.05 - 0.25 (step: 0.05) |

## Parameter Mapping

Convert flat parameter names to structured configurations.

```typescript
import { mapParamsToConfig, flattenConfig } from "@engram/tuner";

// From tuner suggestion to config
const params = {
  "reranker.depth": 30,
  "reranker.defaultTier": "accurate",
  "search.minScore.dense": 0.75,
};

const config = mapParamsToConfig(params);
// Returns:
// {
//   reranker: { depth: 30, defaultTier: "accurate" },
//   search: { minScore: { dense: 0.75 } },
//   abstention: {}
// }

// Back to flat params
const flattened = flattenConfig(config);
```

## Trial Execution

Run optimization trials with benchmark evaluation.

```typescript
import { runTrial, runTrials, computeObjectiveValues } from "@engram/tuner";

const options = {
  client: new TunerClient(),
  studyName: "search-optimization",
  objectives: {
    mode: "balanced",
    weights: { quality: 0.7, latency: 0.3 },
    latencyBudgetMs: 500,
  },
  evaluationFn: async (config) => {
    // Run benchmark with trial config
    const metrics = await runBenchmark(config);
    return {
      ndcg: metrics.ndcgAt10,
      mrr: metrics.mrr,
      p95Latency: metrics.p95Latency,
    };
  },
  onProgress: (event) => {
    console.log(`${event.type}: trial ${event.trialId}`);
  },
};

// Run single trial
await runTrial(options);

// Run multiple trials
const result = await runTrials(options, 100);
console.log(`Success: ${result.successful}, Failed: ${result.failed}`);
```

### Objective Modes

| Mode | Description | Returns |
|------|-------------|---------|
| `quality` | Maximize NDCG | Single value |
| `latency` | Minimize P95 latency | Single value (negated) |
| `balanced` | Weighted combination | Single value |
| `pareto` | Multi-objective optimization | Array [quality, -latency] |

## Benchmark Integration

Evaluate trial configurations using the LongMemEval benchmark.

```typescript
import { evaluateWithBenchmark } from "@engram/tuner";

const metrics = await evaluateWithBenchmark(trialConfig, {
  dataset: "./data/longmemeval_oracle.json",
  variant: "oracle",
  limit: 50,
  llm: "stub",
  qdrantUrl: "http://localhost:6333",
  onProgress: (stage, pct) => console.log(`${stage}: ${pct}%`),
});

// Returns TrialMetrics with quality, latency, and abstention metrics
```

## CLI

Command-line interface for optimization workflows.

```bash
# Start optimization study
engram-tuner optimize \
  --dataset ./data/longmemeval.json \
  --name my-study \
  --trials 100 \
  --objective balanced \
  --preset standard \
  --service-url http://localhost:8000/api/v1

# Check study status
engram-tuner status my-study

# Get best parameters
engram-tuner best my-study --export .env

# List all studies
engram-tuner list

# Get Pareto front (multi-objective)
engram-tuner pareto my-study

# Analyze parameter importance
engram-tuner importance my-study

# Delete study
engram-tuner delete my-study
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `optimize` | Start or continue an optimization study |
| `status` | Check study status and progress |
| `best` | Get best parameters from a study |
| `list` | List all studies |
| `delete` | Delete a study |
| `pareto` | Get Pareto-optimal solutions |
| `importance` | Analyze parameter importance |

## Dependencies

- **@engram/common**: Common utilities and types
- **@engram/logger**: Structured logging
- **commander**: CLI framework
- **zod**: Schema validation

## Integration with Tuner Service

This package is a TypeScript client for the Python tuner service (`apps/tuner`). The service must be running:

```bash
cd apps/tuner
uv sync
uv run tuner
# Service runs on http://localhost:8000
```

See `apps/tuner/README.md` for service documentation.
