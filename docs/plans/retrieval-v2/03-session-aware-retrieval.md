# P3: Session-Aware Retrieval

## Problem Statement

Engram scored **74.4% on Multi-Session Reasoning (MR)** tasks. These questions require synthesizing information across multiple conversation sessions.

Current approach retrieves individual turns, losing session-level context. Research shows hierarchical retrieval significantly improves multi-session tasks ([LiCoMemory](https://arxiv.org/html/2511.01448), [SGMem](https://arxiv.org/html/2509.21212)).

## Expected Impact

- **MR Accuracy**: +5-10% (from 74.4% to ~80-85%)
- **Overall Accuracy**: +2-4%
- **Context Coherence**: Better retrieval of related conversations

## Proposed Solution

### Two-Stage Hierarchical Retrieval

```
┌─────────────────────────────────────────────────────────────┐
│                    Stage 1: Session                          │
│                    Retrieval                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Query ──▶ Session Index ──▶ Top-S Sessions                │
│              (summaries)       (S=5)                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    Stage 2: Turn                             │
│                    Retrieval                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   For each session in Top-S:                                │
│     Query ──▶ Turn Index ──▶ Top-T Turns                    │
│                (filtered)     (T=3)                         │
│                                                              │
│   Total: S × T = 15 turns, then rerank to Top-K             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Session Representation

Based on [SGMem](https://arxiv.org/html/2509.21212) and [CogMem](https://arxiv.org/html/2512.14118):

```typescript
interface SessionSummary {
  sessionId: string;
  /** Generated summary of session content */
  summary: string;
  /** Key topics discussed */
  topics: string[];
  /** Named entities mentioned */
  entities: string[];
  /** Time range of session */
  startTime: Date;
  endTime: Date;
  /** Number of turns in session */
  turnCount: number;
  /** Embedding of summary for retrieval */
  embedding: number[];
}
```

### Implementation

#### New Module: `packages/search-core/src/session-retriever.ts`

```typescript
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { TextEmbedder } from "./embedders/text.js";

export interface SessionRetrieverConfig {
  /** Number of sessions to retrieve in stage 1 */
  topSessions: number;
  /** Number of turns per session in stage 2 */
  turnsPerSession: number;
  /** Final top-K after reranking */
  finalTopK: number;
  /** Collection for session summaries */
  sessionCollection: string;
  /** Collection for turns */
  turnCollection: string;
}

const DEFAULT_CONFIG: SessionRetrieverConfig = {
  topSessions: 5,
  turnsPerSession: 3,
  finalTopK: 10,
  sessionCollection: "sessions",
  turnCollection: "turns",
};

export class SessionAwareRetriever {
  private client: QdrantClient;
  private embedder: TextEmbedder;
  private config: SessionRetrieverConfig;
  private reranker?: Reranker;

  constructor(
    client: QdrantClient,
    embedder: TextEmbedder,
    config: Partial<SessionRetrieverConfig> = {},
    reranker?: Reranker
  ) {
    this.client = client;
    this.embedder = embedder;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reranker = reranker;
  }

  async retrieve(query: string): Promise<SearchResult[]> {
    // Stage 1: Retrieve relevant sessions
    const queryEmbedding = await this.embedder.embedQuery(query);
    const sessions = await this.retrieveSessions(queryEmbedding);

    if (sessions.length === 0) {
      return [];
    }

    // Stage 2: Retrieve turns within each session
    const allTurns: SearchResult[] = [];
    for (const session of sessions) {
      const turns = await this.retrieveTurnsInSession(
        queryEmbedding,
        session.sessionId
      );
      allTurns.push(...turns);
    }

    // Rerank combined results
    if (this.reranker && allTurns.length > this.config.finalTopK) {
      return this.reranker.rerank(
        query,
        allTurns,
        this.config.finalTopK
      );
    }

    return allTurns.slice(0, this.config.finalTopK);
  }

  private async retrieveSessions(
    queryEmbedding: number[]
  ): Promise<SessionResult[]> {
    const results = await this.client.search(this.config.sessionCollection, {
      vector: queryEmbedding,
      limit: this.config.topSessions,
      with_payload: true,
    });

    return results.map(r => ({
      sessionId: r.payload!.session_id as string,
      summary: r.payload!.summary as string,
      score: r.score,
    }));
  }

  private async retrieveTurnsInSession(
    queryEmbedding: number[],
    sessionId: string
  ): Promise<SearchResult[]> {
    const results = await this.client.search(this.config.turnCollection, {
      vector: queryEmbedding,
      limit: this.config.turnsPerSession,
      filter: {
        must: [
          { key: "session_id", match: { value: sessionId } }
        ]
      },
      with_payload: true,
    });

    return results.map(r => ({
      id: r.payload!.doc_id as string,
      content: r.payload!.content as string,
      sessionId: r.payload!.session_id as string,
      score: r.score,
    }));
  }
}

interface SessionResult {
  sessionId: string;
  summary: string;
  score: number;
}
```

#### Session Summarization

```typescript
// packages/search-core/src/session-summarizer.ts

export class SessionSummarizer {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async summarize(turns: Turn[]): Promise<SessionSummary> {
    const context = turns
      .map(t => `${t.role}: ${t.content}`)
      .join("\n");

    const prompt = `Summarize this conversation in 2-3 sentences, focusing on:
1. Main topics discussed
2. Key facts or decisions
3. Named entities mentioned

Conversation:
${context}

Summary:`;

    const summary = await this.llm.complete(prompt);
    const topics = await this.extractTopics(context);
    const entities = await this.extractEntities(context);

    return {
      sessionId: turns[0].sessionId,
      summary,
      topics,
      entities,
      startTime: turns[0].timestamp,
      endTime: turns[turns.length - 1].timestamp,
      turnCount: turns.length,
      embedding: await this.embedder.embed(summary),
    };
  }

  private async extractTopics(text: string): Promise<string[]> {
    // Use KeyBERT or similar for topic extraction
    const { KeywordExtractor } = await import("@engram/search-core");
    const extractor = new KeywordExtractor();
    return extractor.extract(text, { topK: 5 });
  }

  private async extractEntities(text: string): Promise<string[]> {
    // Use NER for entity extraction
    const { pipeline } = await import("@xenova/transformers");
    const ner = await pipeline("ner", "Xenova/bert-base-NER");
    const entities = await ner(text);
    return [...new Set(entities.map(e => e.word))];
  }
}
```

#### Indexing Pipeline Update

```typescript
// packages/benchmark/src/longmemeval/providers/engram-provider.ts

export class EngramRetriever {
  async index(documents: EngramDocument[]): Promise<void> {
    // Group by session
    const sessionGroups = this.groupBySession(documents);

    // Index individual turns (existing)
    await this.indexTurns(documents);

    // Index session summaries (new)
    if (this.config.sessionAware) {
      const summaries = await Promise.all(
        Object.entries(sessionGroups).map(([sessionId, turns]) =>
          this.sessionSummarizer.summarize(turns)
        )
      );
      await this.indexSessionSummaries(summaries);
    }
  }

  private groupBySession(docs: EngramDocument[]): Record<string, EngramDocument[]> {
    const groups: Record<string, EngramDocument[]> = {};
    for (const doc of docs) {
      if (!groups[doc.sessionId]) {
        groups[doc.sessionId] = [];
      }
      groups[doc.sessionId].push(doc);
    }
    return groups;
  }
}
```

### CLI Flag

```typescript
.option("--session-aware", "Enable session-aware hierarchical retrieval", false)
.option("--top-sessions <n>", "Sessions to retrieve in stage 1", parseInt, 5)
.option("--turns-per-session <n>", "Turns per session in stage 2", parseInt, 3)
```

## Testing Strategy

1. **Unit Tests**: Session grouping, summarization
2. **Integration Tests**: Two-stage retrieval
3. **MR Subset**: Run on 121 MR questions, target >80% accuracy

## Considerations

### Memory Overhead
- Session summaries add ~5-10% storage overhead
- Acceptable tradeoff for improved MR performance

### Latency
- Two-stage retrieval adds ~100-200ms
- Can be parallelized if needed

### Cold Start
- Session summaries must be generated at index time
- LLM calls for summarization add indexing time

## Success Metrics

- MR accuracy: 80%+ (from 74.4%)
- Session recall: 90%+ (correct session in top-5)
- Overall accuracy: +2-4%

## References

- [LiCoMemory: Hierarchical Retrieval](https://arxiv.org/html/2511.01448)
- [SGMem: Sentence Graph Memory](https://arxiv.org/html/2509.21212)
- [CogMem: Cognitive Memory Architecture](https://arxiv.org/html/2512.14118)
- [TaciTree: Hierarchical Tree Retrieval](https://arxiv.org/html/2503.07018)
- [Amazon Bedrock AgentCore Memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/)
