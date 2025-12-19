# P4: Temporal Query Understanding

## Problem Statement

Engram scored **71.7% on Temporal Reasoning (TR)** tasks. These questions require understanding time-sensitive queries like:
- "What did we discuss last week?"
- "Before the project deadline, what was the status?"
- "What changed between January and March?"

Current embedding-based retrieval ignores temporal semantics. Research shows temporal-aware retrieval significantly improves TR tasks ([TG-RAG](https://arxiv.org/html/2510.13590v1), [TA-RAG](https://arxiv.org/html/2507.22917v1)).

## Expected Impact

- **TR Accuracy**: +7-11% (from 71.7% to ~80-83%)
- **Overall Accuracy**: +3-5%
- **Temporal Precision**: Correct time-filtered results

## Proposed Solution

### Temporal Query Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    Temporal Parser                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   "What did we discuss last week?"                          │
│                     │                                       │
│                     ▼                                       │
│   ┌─────────────────────────────────────────┐              │
│   │ Chrono.js Parser                         │              │
│   │                                          │              │
│   │ Extracted:                               │              │
│   │   - Reference: "last week"               │              │
│   │   - Range: [2024-12-11, 2024-12-18]     │              │
│   └─────────────────────────────────────────┘              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Query Decomposition                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Semantic: "What did we discuss"                           │
│   Temporal: { after: 2024-12-11, before: 2024-12-18 }      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Filtered Retrieval                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Qdrant Query:                                             │
│   {                                                         │
│     vector: embed("What did we discuss"),                   │
│     filter: {                                               │
│       must: [{                                              │
│         key: "valid_time",                                  │
│         range: { gte: "2024-12-11", lte: "2024-12-18" }    │
│       }]                                                    │
│     }                                                       │
│   }                                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Temporal Expression Types

| Type | Examples | Parsing Strategy |
|:-----|:---------|:-----------------|
| Relative | "last week", "yesterday", "3 days ago" | Chrono.js |
| Absolute | "January 2024", "on Dec 15" | Chrono.js |
| Range | "between Jan and March" | Extract start/end |
| Ordinal | "first meeting", "latest update" | Sort by time |
| Comparative | "before the deadline", "after we started" | Reference resolution |

### Implementation

#### New Module: `packages/search-core/src/temporal.ts`

```typescript
import * as chrono from "chrono-node";

export interface TemporalFilter {
  /** Start of time range (inclusive) */
  after?: Date;
  /** End of time range (inclusive) */
  before?: Date;
  /** Whether to sort by recency */
  sortByRecency?: boolean;
  /** Original temporal expression */
  expression?: string;
}

export interface TemporalQueryResult {
  /** Semantic part of query (temporal expressions removed) */
  semanticQuery: string;
  /** Extracted temporal filter */
  temporalFilter: TemporalFilter | null;
  /** Confidence in temporal extraction */
  confidence: number;
}

export class TemporalQueryParser {
  private referenceDate: Date;

  constructor(referenceDate?: Date) {
    this.referenceDate = referenceDate ?? new Date();
  }

  parse(query: string): TemporalQueryResult {
    // Parse temporal expressions
    const results = chrono.parse(query, this.referenceDate, {
      forwardDate: false, // Prefer past dates for "last X"
    });

    if (results.length === 0) {
      return {
        semanticQuery: query,
        temporalFilter: null,
        confidence: 0,
      };
    }

    // Extract the most relevant temporal reference
    const primary = results[0];
    const temporalFilter: TemporalFilter = {
      expression: primary.text,
    };

    // Handle different result types
    if (primary.start && primary.end) {
      // Range: "between X and Y"
      temporalFilter.after = primary.start.date();
      temporalFilter.before = primary.end.date();
    } else if (primary.start) {
      // Single reference: "last week", "in January"
      const start = primary.start.date();
      const end = primary.end?.date() ?? this.inferEndDate(primary, start);
      temporalFilter.after = start;
      temporalFilter.before = end;
    }

    // Remove temporal expression from query for semantic search
    const semanticQuery = query
      .replace(primary.text, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      semanticQuery: semanticQuery || query,
      temporalFilter,
      confidence: this.calculateConfidence(primary),
    };
  }

  private inferEndDate(result: chrono.ParsedResult, start: Date): Date {
    // Infer end date based on granularity
    const component = result.start;

    if (component.isCertain("day")) {
      // Same day
      return new Date(start.getTime() + 24 * 60 * 60 * 1000);
    } else if (component.isCertain("month")) {
      // End of month
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      return end;
    } else if (component.isCertain("year")) {
      // End of year
      return new Date(start.getFullYear(), 11, 31);
    }

    // Default: 7 days
    return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  private calculateConfidence(result: chrono.ParsedResult): number {
    // Higher confidence for more certain components
    let certainty = 0;
    const component = result.start;

    if (component.isCertain("year")) certainty += 0.3;
    if (component.isCertain("month")) certainty += 0.3;
    if (component.isCertain("day")) certainty += 0.3;
    if (result.end) certainty += 0.1; // Explicit range

    return Math.min(certainty, 1.0);
  }
}

/**
 * Build Qdrant filter from temporal constraints
 */
export function buildTemporalFilter(
  filter: TemporalFilter
): Record<string, unknown> | null {
  if (!filter.after && !filter.before) {
    return null;
  }

  const conditions: Record<string, unknown>[] = [];

  if (filter.after) {
    conditions.push({
      key: "valid_time",
      range: { gte: filter.after.toISOString() },
    });
  }

  if (filter.before) {
    conditions.push({
      key: "valid_time",
      range: { lte: filter.before.toISOString() },
    });
  }

  return { must: conditions };
}
```

#### Integration with Retriever

```typescript
// packages/benchmark/src/longmemeval/providers/engram-provider.ts

import { TemporalQueryParser, buildTemporalFilter } from "@engram/search-core";

export class EngramRetriever {
  private temporalParser?: TemporalQueryParser;

  constructor(config: EngramProviderConfig) {
    if (config.temporalAware) {
      this.temporalParser = new TemporalQueryParser(config.referenceDate);
    }
  }

  async retrieve(query: string, questionDate?: Date): Promise<SearchResult[]> {
    let semanticQuery = query;
    let qdrantFilter: Record<string, unknown> | undefined;

    // Parse temporal expressions
    if (this.temporalParser) {
      this.temporalParser = new TemporalQueryParser(questionDate);
      const parsed = this.temporalParser.parse(query);

      if (parsed.temporalFilter && parsed.confidence > 0.5) {
        semanticQuery = parsed.semanticQuery;
        qdrantFilter = buildTemporalFilter(parsed.temporalFilter) ?? undefined;
      }
    }

    // Retrieve with filter
    return this.search(semanticQuery, this.config.topK, qdrantFilter);
  }

  private async search(
    query: string,
    topK: number,
    filter?: Record<string, unknown>
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embedQuery(query);

    const results = await this.client.search(this.config.collectionName, {
      vector: { name: "dense", vector: Array.from(queryEmbedding) },
      limit: topK,
      filter,
      with_payload: true,
    });

    return results.map(r => ({
      id: r.payload!.doc_id as string,
      content: r.payload!.content as string,
      validTime: new Date(r.payload!.valid_time as string),
      score: r.score,
    }));
  }
}
```

### Recency Boosting

For queries implying recency ("latest", "recent", "current"):

```typescript
export function applyRecencyBoost(
  results: SearchResult[],
  referenceDate: Date,
  boostFactor: number = 0.1
): SearchResult[] {
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  return results.map(result => {
    const age = referenceDate.getTime() - result.validTime.getTime();
    const recencyScore = Math.max(0, 1 - age / maxAge);
    const boostedScore = result.score * (1 + boostFactor * recencyScore);

    return { ...result, score: boostedScore };
  }).sort((a, b) => b.score - a.score);
}
```

### CLI Flag

```typescript
.option("--temporal-aware", "Enable temporal query parsing", false)
```

## Dependencies

```json
{
  "dependencies": {
    "chrono-node": "^2.7.0"
  }
}
```

## Testing Strategy

1. **Unit Tests**: Chrono.js parsing for various temporal expressions
2. **Integration Tests**: Filtered retrieval with temporal constraints
3. **TR Subset**: Run on 127 TR questions, target >80% accuracy

## Edge Cases

| Case | Handling |
|:-----|:---------|
| No temporal expression | Skip filtering, use full semantic search |
| Ambiguous reference | Use lower confidence, widen time window |
| Future dates | Reject unless explicitly future-oriented query |
| Missing reference date | Default to current date |

## Success Metrics

- TR accuracy: 80%+ (from 71.7%)
- Temporal precision: 90%+ (correct time range identified)
- Overall accuracy: +3-5%

## References

- [TG-RAG: Temporal GraphRAG](https://arxiv.org/html/2510.13590v1)
- [TA-RAG: Time-Aware RAG](https://arxiv.org/html/2507.22917v1)
- [TempRALM: Temporal RALM](https://arxiv.org/html/2401.13222v2)
- [Timestamped Embeddings](https://asycd.medium.com/timestamped-embeddings-for-time-aware-retrieval-augmented-generation-rag-32dd9fb540ff)
- [Chrono.js Documentation](https://github.com/wanasit/chrono)
