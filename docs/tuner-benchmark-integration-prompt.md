# Session Continuation: Tuner-Benchmark Integration

## Context

We're implementing the Engram auto-tuning system from `docs/auto-tuning.md`. The tuner infrastructure is complete:

- **Python service** (`apps/tuner`): FastAPI + Optuna on port 8000
- **TypeScript package** (`packages/tuner`): CLI + TunerClient + search spaces
- **Docker**: PostgreSQL, tuner, optuna-dashboard in `docker-compose.dev.yml`

## Current Task

Implement the integration between `@engram/tuner` and `@engram/benchmark` per the plan in `docs/tuner-benchmark-integration.md`.

## What's Done

1. ✅ Python tuner service with ask/tell API
2. ✅ TypeScript TunerClient and CLI commands
3. ✅ Search space definitions for Engram parameters
4. ✅ Trial runner with placeholder evaluation
5. ✅ Integration plan document

## What's Next

### Phase 1: Extract Programmatic API from Benchmark

Create `packages/benchmark/src/core/runner.ts`:
- `runBenchmark(config): Promise<{ metrics, report, jsonl }>`
- Move provider creation logic from CLI to factory
- Export from `packages/benchmark/src/index.ts`

Create `packages/benchmark/src/core/config.ts`:
- `buildBenchmarkConfig(options)` with env var fallbacks

### Phase 2: Create Evaluation Adapter

Create `packages/tuner/src/executor/evaluation-adapter.ts`:
- `evaluateWithBenchmark(trialConfig, options): Promise<TrialMetrics>`
- Map `TrialConfig` to benchmark config
- Return metrics in tuner format

### Phase 3: Add Latency Tracking

Modify `packages/benchmark/src/longmemeval/pipeline.ts`:
- Track per-query latencies
- Compute p50/p95/p99 percentiles
- Include in `PipelineResult`

### Phase 4: Wire and Cache

Update `packages/tuner/src/cli/commands/optimize.ts`:
- Replace placeholder with `evaluateWithBenchmark()`

Create `packages/tuner/src/executor/cache.ts`:
- MD5 hash of params → cached metrics
- Skip re-evaluation for identical configs

## Key Files to Reference

- Plan: `docs/tuner-benchmark-integration.md`
- Benchmark CLI: `packages/benchmark/src/cli/commands/run.ts`
- Benchmark pipeline: `packages/benchmark/src/longmemeval/pipeline.ts`
- Benchmark evaluator: `packages/benchmark/src/longmemeval/evaluator.ts`
- Tuner trial runner: `packages/tuner/src/executor/trial-runner.ts`
- Tuner optimize CLI: `packages/tuner/src/cli/commands/optimize.ts`

## Command to Start

```
Implement the tuner-benchmark integration per docs/tuner-benchmark-integration.md. Start with Phase 1: extract a programmatic API from @engram/benchmark.
```
