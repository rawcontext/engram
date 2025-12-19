# Tuner-Benchmark Integration Plan

This document describes the integration between `@engram/tuner` and `@engram/benchmark` to enable hyperparameter optimization.

## Current State

### Tuner (`packages/tuner`)
- CLI with `optimize`, `status`, `best`, `list` commands
- `TunerClient` for HTTP communication with Python tuner service
- `runTrial()` in `executor/trial-runner.ts` - placeholder evaluation function
- Search spaces defined in `spaces/engram.ts`

### Benchmark (`packages/benchmark`)
- `BenchmarkPipeline` runs full evaluation
- `runCommand()` in CLI mixes config, provider setup, and execution
- `Evaluator` computes metrics: accuracy, recall@k, NDCG@k, MRR, abstention F1
- Returns `PipelineResult` with `metrics`, `report`, `jsonl`

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          packages/tuner                              │
├─────────────────────────────────────────────────────────────────────┤
│  CLI: engram-tuner optimize                                         │
│       ↓                                                              │
│  runTrial() ──→ TunerClient.suggestTrial() ──→ apps/tuner (Python)  │
│       ↓                                                              │
│  evaluationAdapter() ←─────────────────────────────────────────────→│
└───────────│─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        packages/benchmark                            │
├─────────────────────────────────────────────────────────────────────┤
│  runBenchmark(config) ──→ BenchmarkPipeline.run()                   │
│       ↓                                                              │
│  PipelineResult { metrics, report, jsonl }                          │
│       ↓                                                              │
│  metricsToTrialResult() ──→ { ndcg, mrr, hitRate, p95Latency }     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Extract Programmatic API from Benchmark

**Goal**: Make benchmark callable as a library function, not just CLI.

#### 1.1 Create `packages/benchmark/src/core/runner.ts`

```typescript
export interface RunBenchmarkConfig {
  dataset: string;
  variant: DatasetVariant;
  limit?: number;

  // Retrieval settings
  topK: number;
  retriever: "dense" | "bm25" | "hybrid";

  // Engram pipeline settings
  embeddings: "engram" | "qdrant" | "stub";
  hybridSearch: boolean;
  rerank: boolean;
  rerankTier: "fast" | "accurate" | "code" | "colbert";
  rerankDepth: number;

  // Multi-query
  multiQuery: boolean;
  multiQueryVariations: number;

  // Abstention
  abstention: boolean;
  abstentionThreshold: number;

  // Session-aware
  sessionAware: boolean;
  topSessions: number;
  turnsPerSession: number;

  // Temporal
  temporalAware: boolean;
  temporalConfidenceThreshold: number;

  // Embedding model
  embeddingModel: EmbeddingModel;

  // LLM provider
  llm: "stub" | "anthropic" | "openai" | "ollama";

  // Infrastructure
  qdrantUrl?: string;
}

export interface BenchmarkMetrics {
  // QA accuracy
  accuracy: number;

  // Retrieval metrics
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  ndcgAt10: number;
  mrr: number;

  // Abstention
  abstentionPrecision: number;
  abstentionRecall: number;
  abstentionF1: number;

  // Latency (ms)
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  totalDurationMs: number;
}

export async function runBenchmark(
  config: RunBenchmarkConfig,
  callbacks?: {
    onProgress?: (progress: PipelineProgress) => void;
  }
): Promise<{
  metrics: BenchmarkMetrics;
  report: string;
  jsonl: string;
}>;
```

#### 1.2 Create `packages/benchmark/src/core/config.ts`

Configuration builder with environment variable fallbacks:

```typescript
export function buildBenchmarkConfig(
  options: Partial<RunBenchmarkConfig>
): RunBenchmarkConfig {
  return {
    // Dataset (required)
    dataset: options.dataset ?? process.env.BENCHMARK_DATASET ?? "",
    variant: options.variant ?? "oracle",
    limit: options.limit,

    // Retrieval defaults
    topK: options.topK ?? 10,
    retriever: options.retriever ?? "hybrid",

    // Engram pipeline defaults
    embeddings: options.embeddings ?? "engram",
    hybridSearch: options.hybridSearch ?? true,
    rerank: options.rerank ?? true,
    rerankTier: options.rerankTier ?? "accurate",
    rerankDepth: options.rerankDepth ?? 30,

    // Multi-query defaults
    multiQuery: options.multiQuery ?? false,
    multiQueryVariations: options.multiQueryVariations ?? 3,

    // Abstention defaults
    abstention: options.abstention ?? true,
    abstentionThreshold: options.abstentionThreshold ?? 0.3,

    // Session-aware defaults
    sessionAware: options.sessionAware ?? false,
    topSessions: options.topSessions ?? 5,
    turnsPerSession: options.turnsPerSession ?? 3,

    // Temporal defaults
    temporalAware: options.temporalAware ?? false,
    temporalConfidenceThreshold: options.temporalConfidenceThreshold ?? 0.7,

    // Model defaults
    embeddingModel: options.embeddingModel ?? "e5-small",
    llm: options.llm ?? "stub",

    // Infrastructure
    qdrantUrl: options.qdrantUrl ?? process.env.QDRANT_URL ?? "http://localhost:6333",
  };
}
```

#### 1.3 Update `packages/benchmark/src/index.ts`

Export programmatic API:

```typescript
export { runBenchmark, buildBenchmarkConfig } from "./core/runner.js";
export type { RunBenchmarkConfig, BenchmarkMetrics } from "./core/runner.js";
export { BenchmarkPipeline } from "./longmemeval/pipeline.js";
export { Evaluator } from "./longmemeval/evaluator.js";
```

---

### Phase 2: Create Evaluation Adapter in Tuner

**Goal**: Bridge tuner config to benchmark execution.

#### 2.1 Create `packages/tuner/src/executor/evaluation-adapter.ts`

```typescript
import { runBenchmark, buildBenchmarkConfig } from "@engram/benchmark";
import type { TrialConfig } from "./config-mapper.js";
import type { TrialMetrics } from "./trial-runner.js";

export interface EvaluationAdapterOptions {
  dataset: string;
  variant?: string;
  limit?: number;
  qdrantUrl?: string;
  llm?: "stub" | "anthropic" | "openai" | "ollama";
  onProgress?: (stage: string, percent: number) => void;
}

/**
 * Map tuner TrialConfig to benchmark config and run evaluation
 */
export async function evaluateWithBenchmark(
  trialConfig: TrialConfig,
  options: EvaluationAdapterOptions,
): Promise<TrialMetrics> {
  const startTime = Date.now();

  // Build benchmark config from trial parameters
  const benchmarkConfig = buildBenchmarkConfig({
    dataset: options.dataset,
    variant: options.variant ?? "oracle",
    limit: options.limit,
    qdrantUrl: options.qdrantUrl,
    llm: options.llm ?? "stub",

    // Map reranker settings from trial
    rerank: trialConfig.reranker.enabled ?? true,
    rerankTier: trialConfig.reranker.defaultTier ?? "accurate",
    rerankDepth: trialConfig.reranker.depth ?? 30,

    // Map search settings (threshold will be applied via RuntimeConfig)
    hybridSearch: true,

    // Map abstention settings
    abstention: true,
    abstentionThreshold: trialConfig.abstention.minRetrievalScore ?? 0.3,
  });

  // Run benchmark
  const result = await runBenchmark(benchmarkConfig, {
    onProgress: options.onProgress
      ? (p) => options.onProgress!(p.stage, (p.current / p.total) * 100)
      : undefined,
  });

  const totalDurationMs = Date.now() - startTime;

  // Map to TrialMetrics
  return {
    ndcg: result.metrics.ndcgAt10,
    mrr: result.metrics.mrr,
    hitRate: result.metrics.recallAt1,
    precision: result.metrics.accuracy,
    recall: result.metrics.recallAt10,

    p50Latency: result.metrics.p50Latency,
    p95Latency: result.metrics.p95Latency,
    p99Latency: result.metrics.p99Latency,

    abstentionPrecision: result.metrics.abstentionPrecision,
    abstentionRecall: result.metrics.abstentionRecall,
    abstentionF1: result.metrics.abstentionF1,
  };
}
```

#### 2.2 Update `packages/tuner/src/cli/commands/optimize.ts`

Wire the real evaluation:

```typescript
import { evaluateWithBenchmark } from "../../executor/evaluation-adapter.js";

// In optimizeCommand():
const evaluationFn = async (config: TrialConfig) => {
  return evaluateWithBenchmark(config, {
    dataset: options.dataset,
    limit: options.limit,
    llm: options.llm ?? "stub",
    onProgress: (stage, pct) => {
      process.stdout.write(`\r  Trial ${trialNum}: ${stage} ${pct.toFixed(0)}%`);
    },
  });
};
```

---

### Phase 3: Add Latency Tracking to Benchmark

**Goal**: Capture timing metrics for each stage.

#### 3.1 Add latency collection to `BenchmarkPipeline`

```typescript
interface LatencyMetrics {
  indexingMs: number;
  retrievalMs: number;
  rerankingMs: number;
  generationMs: number;
  evaluationMs: number;
  perQueryLatencies: number[];
}

// In pipeline.run():
const latencies: number[] = [];
for (const instance of instances) {
  const queryStart = Date.now();
  const result = await this.processInstance(instance);
  latencies.push(Date.now() - queryStart);
}

// Compute percentiles
const sorted = [...latencies].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
const p99 = sorted[Math.floor(sorted.length * 0.99)];
```

---

### Phase 4: Caching for Expensive Evaluations

**Goal**: Avoid re-computing results for identical configurations.

Based on research, implement parameter-based caching:

```typescript
// packages/tuner/src/executor/cache.ts
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface CacheEntry {
  params: Record<string, unknown>;
  metrics: TrialMetrics;
  timestamp: string;
}

export class EvaluationCache {
  constructor(private cacheDir: string = ".tuner-cache") {}

  private getKey(params: Record<string, unknown>): string {
    const sorted = JSON.stringify(params, Object.keys(params).sort());
    return createHash("md5").update(sorted).digest("hex");
  }

  async get(params: Record<string, unknown>): Promise<TrialMetrics | null> {
    const key = this.getKey(params);
    const path = join(this.cacheDir, `${key}.json`);

    try {
      const data = await readFile(path, "utf-8");
      const entry: CacheEntry = JSON.parse(data);
      return entry.metrics;
    } catch {
      return null;
    }
  }

  async set(params: Record<string, unknown>, metrics: TrialMetrics): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const key = this.getKey(params);
    const entry: CacheEntry = {
      params,
      metrics,
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(this.cacheDir, `${key}.json`),
      JSON.stringify(entry, null, 2)
    );
  }
}
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/benchmark/src/core/runner.ts` | Create | Programmatic benchmark API |
| `packages/benchmark/src/core/config.ts` | Create | Config builder with env fallbacks |
| `packages/benchmark/src/core/types.ts` | Create | Shared types |
| `packages/benchmark/src/index.ts` | Modify | Export programmatic API |
| `packages/benchmark/src/longmemeval/pipeline.ts` | Modify | Add latency tracking |
| `packages/tuner/src/executor/evaluation-adapter.ts` | Create | Bridge tuner → benchmark |
| `packages/tuner/src/executor/cache.ts` | Create | Evaluation cache |
| `packages/tuner/src/cli/commands/optimize.ts` | Modify | Wire real evaluation |
| `packages/tuner/package.json` | Modify | Add `@engram/benchmark` dep |

---

## Usage After Integration

```bash
# Start infrastructure
docker compose up -d postgres tuner tuner-dashboard qdrant

# Run optimization with real evaluation
npx engram-tuner optimize \
  --dataset ./data/longmemeval_oracle.json \
  --name engram-v1 \
  --trials 50 \
  --objective balanced \
  --preset quick \
  --llm stub  # Use stub for fast iteration, anthropic/openai for real

# Monitor at http://localhost:8080

# Get best params
npx engram-tuner best engram-v1 --export .env.optimized
```

---

## Research Grounding

### Optuna Integration
- Use **ask/tell pattern** for distributed optimization (already implemented)
- Enable `constant_liar=True` for TPESampler in parallel trials
- Use **HyperbandPruner** for early stopping of poor trials

### Metrics Design
- **Single objective (balanced)**: `0.5 * NDCG@10 + 0.3 * (1 - p95_latency/500) + 0.2 * abstention_f1`
- **Multi-objective (pareto)**: `[maximize(NDCG@10), minimize(p95_latency)]`

### Caching Strategy
- Cache by parameter hash - identical params = identical results
- 30-50% compute savings in typical optimization runs

### Sources
- [Optuna Ask-and-Tell Interface](https://optuna.readthedocs.io/en/stable/tutorial/20_recipes/009_ask_and_tell.html)
- [Multi-Objective HPO for RAG Systems](https://arxiv.org/html/2502.18635v1)
- [RAGAS Evaluation Framework](https://docs.ragas.io/en/stable/)
- [MLflow LLM Evaluation Patterns](https://mlflow.org/docs/latest/llms/llm-evaluate/index.html)
