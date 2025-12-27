# @engram/tuner

TypeScript client, CLI, and trial executor for hyperparameter optimization. Orchestrates Bayesian optimization of search pipeline parameters via the Python tuner service (`apps/tuner`, port 6177).

## Purpose

Automates tuning for vector search (score thresholds), reranker (depth/tier/timeout), and abstention (min score/gap). Evaluates using LongMemEval with multi-objective optimization (quality vs. latency).

## Client API

```typescript
import { TunerClient } from "@engram/tuner";

const client = new TunerClient({ baseUrl: "http://localhost:6177/v1/tuner" });

// Create study
await client.createStudy({
  name: "search-opt",
  direction: "maximize",
  search_space: params,
  sampler: "tpe",
  pruner: "hyperband",
});

// Optimization loop
const suggestion = await client.suggestTrial("search-opt");
const metrics = await evaluateConfig(suggestion.params);
await client.completeTrial("search-opt", suggestion.trial_id, {
  values: metrics.ndcg,
  user_attrs: { p95_latency: metrics.latency },
});

// Results
const best = await client.getBestParams("search-opt");
const importance = await client.getParamImportance("search-opt");
const pareto = await client.getParetoFront("search-opt");
```

**Methods**: `createStudy`, `suggestTrial`, `completeTrial`, `getBestParams`, `getParetoFront`, `getParamImportance`

## Search Spaces

```typescript
import { SearchSpacePresets, buildSearchSpace } from "@engram/tuner";

const space = SearchSpacePresets.standard; // ~729 trials
const quick = SearchSpacePresets.quick;     // ~27 trials

// Custom space
const custom = buildSearchSpace([
  "reranker.depth",           // 10-100 (step: 10)
  "reranker.defaultTier",     // fast | accurate | code
  "search.minScore.dense",    // 0.6-0.9 (step: 0.05)
]);
```

## Trial Execution

```typescript
import { runTrials } from "@engram/tuner";

await runTrials({
  client: new TunerClient(),
  studyName: "search-opt",
  objectives: {
    mode: "balanced",  // quality | latency | balanced | pareto
    weights: { quality: 0.7, latency: 0.3 },
  },
  evaluationFn: async (config) => ({
    ndcg: metrics.ndcgAt10,
    p95Latency: metrics.p95,
  }),
}, 100);
```

## CLI

```bash
# Start optimization
engram-tuner optimize --dataset ./data/longmemeval.json --name study --trials 100

# Monitor and analyze
engram-tuner status study
engram-tuner best study --export .env
engram-tuner importance study
engram-tuner pareto study
engram-tuner list
```

**Commands**: `optimize`, `status`, `best`, `importance`, `pareto`, `list`, `delete`

## Usage

Start tuner service: `cd apps/tuner && uv sync && uv run tuner` (port 6177)

See `apps/tuner/README.md` and `/CLAUDE.md` for details.
