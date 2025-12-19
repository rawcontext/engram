# P1: Multi-Query Retrieval

## Problem Statement

Current Engram retrieval uses a single query to retrieve documents. This limits recall because:
1. User queries may use different terminology than documents
2. Relevant documents may match different aspects of the query
3. Single embedding captures only one semantic interpretation

Research shows multi-query approaches consistently outperform single-query ([DMQR-RAG](https://arxiv.org/html/2411.13154v1)).

## Expected Impact

- **Accuracy Gain**: +5-8% overall
- **Recall Improvement**: +15-20% at top-K
- **Latency Impact**: +200-500ms (parallel queries)

## Proposed Solution

### Architecture

```
                    ┌──────────────┐
                    │ Original     │
                    │ Query        │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Query        │
                    │ Expander     │
                    │ (LLM)        │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │ Variation 1 │  │ Variation 2 │  │ Variation 3 │
   │ (Rephrase)  │  │ (Entity)    │  │ (Step-back) │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │ Retrieve    │  │ Retrieve    │  │ Retrieve    │
   │ K docs      │  │ K docs      │  │ K docs      │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────▼───────┐
                    │ RRF Fusion   │
                    │ (dedupe)     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Top-K        │
                    │ Results      │
                    └──────────────┘
```

### Query Expansion Strategies

Based on [DMQR-RAG research](https://arxiv.org/html/2411.13154v1), implement 4 rewriting strategies:

1. **Paraphrase**: Rephrase query with synonyms
2. **Entity Extraction**: Focus on named entities and key terms
3. **Step-back**: Generalize to broader concept
4. **Decomposition**: Break into sub-questions (for complex queries)

### Implementation

#### New Module: `packages/search-core/src/multi-query.ts`

```typescript
import type { LLMProvider } from "./types.js";
import type { SearchResult } from "./search.js";

export interface MultiQueryConfig {
  /** Number of query variations to generate */
  numVariations: number;
  /** Expansion strategies to use */
  strategies: ("paraphrase" | "entity" | "stepback" | "decompose")[];
  /** Whether to include original query */
  includeOriginal: boolean;
  /** RRF fusion constant */
  rrfK: number;
}

const DEFAULT_CONFIG: MultiQueryConfig = {
  numVariations: 3,
  strategies: ["paraphrase", "entity", "stepback"],
  includeOriginal: true,
  rrfK: 60,
};

export class MultiQueryRetriever {
  private baseRetriever: BaseRetriever;
  private llm: LLMProvider;
  private config: MultiQueryConfig;

  constructor(
    baseRetriever: BaseRetriever,
    llm: LLMProvider,
    config: Partial<MultiQueryConfig> = {}
  ) {
    this.baseRetriever = baseRetriever;
    this.llm = llm;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async retrieve(query: string, topK: number): Promise<SearchResult[]> {
    // 1. Generate query variations
    const variations = await this.expandQuery(query);

    // 2. Retrieve for each variation in parallel
    const allResults = await Promise.all(
      variations.map(q => this.baseRetriever.retrieve(q, topK * 2))
    );

    // 3. RRF fusion across all results
    return this.rrfFusion(allResults, topK);
  }

  private async expandQuery(query: string): Promise<string[]> {
    const variations: string[] = [];

    if (this.config.includeOriginal) {
      variations.push(query);
    }

    const prompt = this.buildExpansionPrompt(query);
    const response = await this.llm.complete(prompt);
    const expanded = this.parseExpansionResponse(response);

    variations.push(...expanded.slice(0, this.config.numVariations));
    return variations;
  }

  private buildExpansionPrompt(query: string): string {
    return `Generate ${this.config.numVariations} alternative search queries for: "${query}"

Strategies to use:
${this.config.strategies.includes("paraphrase") ? "- Paraphrase: Rephrase using different words" : ""}
${this.config.strategies.includes("entity") ? "- Entity: Focus on key entities and names" : ""}
${this.config.strategies.includes("stepback") ? "- Step-back: Generalize to broader concept" : ""}
${this.config.strategies.includes("decompose") ? "- Decompose: Break into simpler sub-questions" : ""}

Return each query on a new line, no numbering or bullets.`;
  }

  private parseExpansionResponse(response: string): string[] {
    return response
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("-"));
  }

  private rrfFusion(
    resultSets: SearchResult[][],
    topK: number
  ): SearchResult[] {
    const scoreMap = new Map<string, { result: SearchResult; score: number }>();
    const k = this.config.rrfK;

    for (const results of resultSets) {
      results.forEach((result, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        const existing = scoreMap.get(result.id);

        if (existing) {
          existing.score += rrfScore;
        } else {
          scoreMap.set(result.id, { result, score: rrfScore });
        }
      });
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ result, score }) => ({ ...result, score }));
  }
}
```

#### Integration with Benchmark

```typescript
// packages/benchmark/src/longmemeval/providers/engram-provider.ts

import { MultiQueryRetriever } from "@engram/search-core";

export class EngramRetriever {
  private multiQueryRetriever?: MultiQueryRetriever;

  constructor(config: EngramProviderConfig) {
    // ... existing init ...

    if (config.multiQuery) {
      this.multiQueryRetriever = new MultiQueryRetriever(
        this, // base retriever
        config.llmForExpansion,
        {
          numVariations: config.multiQueryVariations ?? 3,
          strategies: config.multiQueryStrategies ?? ["paraphrase", "entity", "stepback"],
        }
      );
    }
  }

  async retrieve(query: string, topK: number): Promise<SearchResult[]> {
    if (this.multiQueryRetriever) {
      return this.multiQueryRetriever.retrieve(query, topK);
    }
    return this.search(query, topK);
  }
}
```

### CLI Flag

```typescript
.option("--multi-query", "Enable multi-query expansion", false)
.option("--multi-query-variations <n>", "Number of query variations", parseInt, 3)
```

## Testing Strategy

1. **Unit Tests**: Query expansion parsing, RRF fusion logic
2. **Integration Tests**: End-to-end retrieval with expansion
3. **Benchmark**: Compare single vs multi-query on LongMemEval subset

## Rollout Plan

1. Implement `MultiQueryRetriever` in search-core
2. Add CLI flags to benchmark
3. Run ablation study on 50 instances
4. If +5% gain, enable by default
5. Tune `numVariations` and `strategies` for optimal performance

## Success Metrics

- Recall@10 improvement: +15% or more
- Overall accuracy: +5% or more
- Latency: <1s additional per query

## References

- [DMQR-RAG: Diverse Multi-Query Rewriting](https://arxiv.org/html/2411.13154v1)
- [RAG Query Transformation Optimization](https://dev.to/jamesli/in-depth-understanding-of-rag-query-transformation-optimization-multi-query-problem-decomposition-and-step-back-27jg)
- [Best Practices in RAG](https://arxiv.org/abs/2407.01219)
