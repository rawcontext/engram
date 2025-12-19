# @engram/tuner

Hyperparameter optimization orchestration for the search system.

## Overview

Provides client utilities and search space definitions for automated hyperparameter tuning of embedders, rerankers, fusion strategies, and abstention detection.

## Installation

```bash
npm install @engram/tuner
```

## Core Components

### TunerClient

HTTP client for interacting with the Tuner Service API.

```typescript
import { TunerClient } from "@engram/tuner";

const client = new TunerClient({
  baseUrl: "http://localhost:8000",
});

// Create a study
const study = await client.createStudy({
  name: "search-optimization",
  direction: "maximize",
  sampler: "tpe",
});

// Run trials
const results = await client.runTrials({
  studyId: study.id,
  numTrials: 100,
});
```

### Search Space Builder

Define optimization search spaces for Engram parameters.

```typescript
import { buildSearchSpace } from "@engram/tuner";

const space = buildSearchSpace({
  embedding: {
    model: ["e5-small", "e5-base", "e5-large"],
    dimension: [384, 768],
  },
  reranker: {
    tier: ["fast", "accurate", "code"],
    depth: { min: 10, max: 100 },
  },
  fusion: {
    alpha: { min: 0.0, max: 1.0 },
    method: ["rrf", "weighted", "learned"],
  },
});
```

### Parameter Mapping

Convert optimization parameters to search configuration.

```typescript
import { mapParamsToConfig } from "@engram/tuner";

const params = {
  embedding_model: "e5-small",
  reranker_tier: "accurate",
  fusion_alpha: 0.6,
};

const config = mapParamsToConfig(params);
// Returns SearchConfig compatible object
```

### Trial Execution

```typescript
import { runTrial, runTrials, computeObjectiveValues } from "@engram/tuner";

// Run a single trial
const result = await runTrial({
  params,
  dataset: testQueries,
  evaluate: async (query, config) => {
    return await searchService.search(query, config);
  },
});

// Compute objective metrics
const objectives = computeObjectiveValues(result, {
  metrics: ["recall@10", "mrr", "latency_p95"],
});
```

## Search Space Presets

```typescript
import { PRESETS } from "@engram/tuner";

// Quick optimization
const quickSpace = PRESETS.quick;

// Full optimization
const fullSpace = PRESETS.full;

// Code-focused optimization
const codeSpace = PRESETS.code;
```

## Optimizable Parameters

| Category | Parameters |
|:---------|:-----------|
| **Embedding** | Model, dimension, batch size |
| **Retrieval** | Top-K, hybrid weights, fusion method |
| **Reranking** | Tier, depth, threshold |
| **Abstention** | Confidence threshold, NLI threshold |
