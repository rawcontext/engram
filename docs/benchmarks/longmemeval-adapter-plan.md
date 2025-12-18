# LongMemEval Benchmark Adapter for Engram

> **Status**: In Progress (Milestones 1-3 Complete)
> **Created**: 2025-12-18
> **Updated**: 2025-12-18
> **Benchmark**: [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (ICLR 2025)

## Executive Summary

This document outlines the implementation plan for a LongMemEval benchmark adapter that enables evaluating Engram's bitemporal memory system against the industry-standard long-term memory benchmark.

### Why LongMemEval?

| Engram Capability | LongMemEval Test Category | Alignment |
|:---|:---|:---|
| Bitemporal queries (VT + TT) | Temporal Reasoning (TR) | Strong |
| REPLACES edges, soft deletes | Knowledge Update (KU) | Strong |
| Session→Turn graph chains | Multi-Session Reasoning (MR) | Strong |
| Qdrant vector search | Information Extraction (IE) | Standard |
| Graph-based retrieval | Abstention (ABS) | Testable |

### Current SOTA Baselines

| System | Score | Notes |
|:---|:---|:---|
| Vectorize Hindsight | 91.4% | First to break 90% (Dec 2025) |
| ChatGPT Memory | ~30-70% | Struggles with knowledge updates |
| Coze | ~30-70% | Fails on indirect information |
| Full-context LLMs | -30% drop | From baseline accuracy |

---

## 1. LongMemEval Dataset Structure

### 1.1 Dataset Files

```
longmemeval-cleaned/
├── longmemeval_s_cleaned.json    # ~115k tokens, ~40 sessions
├── longmemeval_m_cleaned.json    # ~1.5M tokens, ~500 sessions
└── longmemeval_oracle.json       # Evidence-only (for oracle retrieval)
```

**Source**: [HuggingFace - xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)

### 1.2 JSON Schema

```typescript
interface LongMemEvalInstance {
  question_id: string;           // Unique ID; ends with "_abs" for abstention
  question_type: QuestionType;   // Category of memory ability being tested
  question: string;              // The query to answer
  answer: string;                // Expected response
  question_date: string;         // ISO timestamp for when question is asked
  haystack_session_ids: string[];// Session IDs (timestamp-sorted)
  haystack_dates: string[];      // Session timestamps
  haystack_sessions: Session[];  // Array of chat sessions
  answer_session_ids: string[];  // Ground truth evidence session IDs
}

type QuestionType =
  | "single-session-user"        // IE: User-stated facts
  | "single-session-assistant"   // IE: Assistant-generated info
  | "single-session-preference"  // IE: User preferences
  | "multi-session"              // MR: Cross-session reasoning
  | "temporal-reasoning"         // TR: Time-based queries
  | "knowledge-update";          // KU: Changed facts over time

interface Session {
  role: "user" | "assistant";
  content: string;
  has_answer?: boolean;          // True if this turn contains evidence
}
```

### 1.3 Five Core Memory Abilities

| Ability | Code | Description | Challenge |
|:---|:---|:---|:---|
| Information Extraction | IE | Recall specific facts from history | Needle-in-haystack |
| Multi-Session Reasoning | MR | Synthesize across sessions | Aggregation/comparison |
| Temporal Reasoning | TR | Use timestamps and temporal refs | Time-aware filtering |
| Knowledge Update | KU | Handle contradictory info over time | Version tracking |
| Abstention | ABS | Recognize unanswerable questions | Confidence calibration |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    LongMemEval Adapter                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Ingester   │───▶│   Engram     │───▶│   Querier    │      │
│  │              │    │   Memory     │    │              │      │
│  │ • Load JSON  │    │   System     │    │ • Retrieve   │      │
│  │ • Map to     │    │              │    │ • Read       │      │
│  │   Sessions   │    │ • FalkorDB   │    │ • Generate   │      │
│  │ • Create     │    │ • Qdrant     │    │              │      │
│  │   Turns      │    │ • Bitemporal │    └──────────────┘      │
│  └──────────────┘    └──────────────┘           │              │
│                                                 ▼              │
│                      ┌──────────────────────────────────────┐  │
│                      │            Evaluator                  │  │
│                      │                                       │  │
│                      │ • Compare hypothesis vs answer        │  │
│                      │ • Compute retrieval recall            │  │
│                      │ • Generate per-category metrics       │  │
│                      └──────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Plan

### Phase 1: Dataset Ingestion Layer

**Goal**: Convert LongMemEval JSON format into Engram's graph structure.

#### 3.1.1 Data Loader

```typescript
// packages/benchmark/src/longmemeval/loader.ts

interface LoaderConfig {
  datasetPath: string;           // Path to JSON file
  variant: "s" | "m" | "oracle"; // Which dataset variant
}

interface LoadedInstance {
  questionId: string;
  questionType: QuestionType;
  question: string;
  answer: string;
  questionDate: Date;
  sessions: ParsedSession[];
  answerSessionIds: string[];
}

interface ParsedSession {
  sessionId: string;
  timestamp: Date;
  turns: ParsedTurn[];
}

interface ParsedTurn {
  role: "user" | "assistant";
  content: string;
  hasAnswer: boolean;
  sequenceIndex: number;
}
```

**Tasks**:
1. Parse JSON with Zod validation
2. Normalize timestamps to ISO-8601
3. Validate session ordering matches timestamps
4. Handle abstention questions (`_abs` suffix)

#### 3.1.2 Graph Mapper

Map LongMemEval sessions to Engram's bitemporal graph model:

| LongMemEval | Engram Node | Notes |
|:---|:---|:---|
| Instance | Session | One Session per benchmark instance |
| Session in haystack | (embedded in Turns) | Sessions become turn groupings |
| Turn (user/assistant pair) | Turn | Map role + content |
| `has_answer: true` | Turn metadata | Track for retrieval eval |

**Bitemporal Mapping**:
```typescript
// For each turn:
{
  vt_start: session.timestamp,     // Valid time = conversation time
  vt_end: MAX_DATE,                // Still valid
  tt_start: Date.now(),            // Transaction time = ingestion time
  tt_end: MAX_DATE,                // Current version
}
```

**Key Design Decision**:
- Each LongMemEval instance becomes a separate Engram Session
- `haystack_sessions` become Turn nodes with `vt_start` set to `haystack_dates`
- Evidence turns (`has_answer: true`) are tagged in metadata for retrieval evaluation

### Phase 2: Retrieval Interface

**Goal**: Implement the three-stage memory pipeline (Index → Retrieve → Read).

#### 3.2.1 Indexing Stage

Engram already implements indexing through:
- **FalkorDB**: Graph relationships (Session→Turn→Reasoning)
- **Qdrant**: Vector embeddings for semantic search

**Enhancements needed**:
```typescript
// packages/benchmark/src/longmemeval/indexer.ts

interface IndexConfig {
  // Value granularity (LongMemEval finding: "round" is optimal)
  granularity: "session" | "turn";

  // Key expansion (LongMemEval: +9.4% recall)
  keyExpansion: {
    enabled: boolean;
    types: ("summary" | "keyphrase" | "userfact" | "event")[];
  };

  // Time-aware indexing
  temporalIndexing: {
    enabled: boolean;
    extractEventDates: boolean;
  };
}
```

**Fact Extraction** (for key expansion):
- Extract summaries, keyphrases, user facts, timestamped events
- Use LLM (Llama 3.1 8B or equivalent) for extraction
- Store as additional metadata on Turn nodes

#### 3.2.2 Retrieval Stage

```typescript
// packages/benchmark/src/longmemeval/retriever.ts

interface RetrieverConfig {
  method: "bm25" | "dense" | "hybrid";
  topK: number;

  // Time-aware query expansion (LongMemEval: +7-11% on TR)
  timeAwareExpansion: {
    enabled: boolean;
    extractTemporalRange: boolean;
  };
}

interface RetrievalResult {
  turnIds: string[];
  sessionIds: string[];
  scores: number[];

  // For evaluation
  retrievedEvidence: boolean[];  // Which retrieved items have has_answer
}

async function retrieve(
  sessionId: string,
  query: string,
  queryDate: Date,
  config: RetrieverConfig
): Promise<RetrievalResult>;
```

**Retrieval Strategy**:
1. Parse query for temporal constraints
2. If temporal: filter by `vt_start` range before semantic search
3. Vector search in Qdrant with filtered candidates
4. Optionally combine with BM25 for hybrid retrieval
5. Return top-K turns with scores

#### 3.2.3 Reading Stage

```typescript
// packages/benchmark/src/longmemeval/reader.ts

interface ReaderConfig {
  model: string;                    // LLM for answer generation

  // Chain-of-Note (LongMemEval: +10 points)
  chainOfNote: {
    enabled: boolean;
    extractKeyInfo: boolean;
  };

  // JSON prompt format (recommended by paper)
  structuredFormat: boolean;
}

interface ReadResult {
  hypothesis: string;              // Generated answer
  reasoning?: string;              // Chain-of-thought (if enabled)
  confidence?: number;             // For abstention decisions
}

async function read(
  query: string,
  retrievedTurns: Turn[],
  config: ReaderConfig
): Promise<ReadResult>;
```

**Reading Optimizations**:
1. Present retrieved items as structured JSON
2. Apply Chain-of-Note: extract key information before reasoning
3. For abstention: calibrate confidence threshold

### Phase 3: Evaluation Pipeline

**Goal**: Compute metrics compatible with LongMemEval's evaluation methodology.

#### 3.3.1 Metrics

```typescript
// packages/benchmark/src/longmemeval/evaluator.ts

interface EvaluationMetrics {
  // QA Correctness (LLM-judged)
  qa: {
    overall: number;
    byType: Record<QuestionType, number>;
  };

  // Retrieval metrics
  retrieval: {
    turnRecall: number;           // % of evidence turns retrieved
    sessionRecall: number;        // % of evidence sessions retrieved
    recallAtK: Record<number, number>;  // Recall@1, @5, @10
    ndcgAtK: Record<number, number>;    // NDCG@1, @5, @10
  };

  // Abstention metrics (30 questions)
  abstention: {
    precision: number;            // Correct abstentions / total abstentions
    recall: number;               // Correct abstentions / questions requiring abstention
  };
}
```

#### 3.3.2 QA Evaluation

LongMemEval uses GPT-4o for QA correctness (97% human agreement):

```typescript
interface QAJudgment {
  questionId: string;
  hypothesis: string;
  answer: string;
  correct: boolean;
  reasoning?: string;
}

async function evaluateQA(
  results: { questionId: string; hypothesis: string }[],
  groundTruth: LongMemEvalInstance[]
): Promise<QAJudgment[]>;
```

#### 3.3.3 Output Format

```jsonl
{"question_id": "q001", "hypothesis": "The user's favorite color is blue"}
{"question_id": "q002", "hypothesis": "They visited Paris in March 2023"}
{"question_id": "q003_abs", "hypothesis": "I don't have information about that"}
```

### Phase 4: CLI & Reporting

```bash
# Run full benchmark
npx engram-benchmark longmemeval \
  --dataset longmemeval_s_cleaned.json \
  --retriever hybrid \
  --top-k 10 \
  --output results/longmemeval-s.jsonl

# Evaluate results
npx engram-benchmark evaluate \
  --hypothesis results/longmemeval-s.jsonl \
  --ground-truth data/longmemeval_s_cleaned.json \
  --output results/metrics.json
```

---

## 4. Package Structure

```
packages/benchmark/
├── package.json
├── src/
│   ├── index.ts
│   ├── longmemeval/
│   │   ├── index.ts
│   │   ├── loader.ts          # Dataset loading
│   │   ├── mapper.ts          # LongMemEval → Engram mapping
│   │   ├── indexer.ts         # Index expansion, temporal indexing
│   │   ├── retriever.ts       # Retrieval pipeline
│   │   ├── reader.ts          # LLM reading stage
│   │   ├── evaluator.ts       # Metrics computation
│   │   └── types.ts           # Shared types
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── run.ts
│   │       └── evaluate.ts
│   └── utils/
│       ├── temporal.ts        # Time-aware query parsing
│       └── llm.ts             # LLM client abstraction
├── tests/
│   ├── loader.test.ts
│   ├── mapper.test.ts
│   ├── retriever.test.ts
│   └── evaluator.test.ts
└── data/
    └── .gitkeep               # User downloads datasets here
```

---

## 5. Engram-Specific Optimizations

### 5.1 Leveraging Bitemporal Queries

Engram's bitemporal model provides a unique advantage for temporal reasoning:

```cypher
// "What was the user's job in March 2023?"
MATCH (s:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
WHERE t.vt_start >= datetime('2023-03-01')
  AND t.vt_start < datetime('2023-04-01')
  AND t.tt_end = $MAX_DATE  // Current version only
RETURN t
ORDER BY t.vt_start ASC
```

### 5.2 Leveraging REPLACES Edges for Knowledge Updates

```cypher
// Find all versions of facts about "job"
MATCH (t:Turn)-[:REPLACES*0..]->(older:Turn)
WHERE t.content CONTAINS 'job'
RETURN t, older
ORDER BY t.vt_start DESC
```

### 5.3 Graph Traversal for Multi-Session Reasoning

```cypher
// Find related turns across sessions via shared entities
MATCH (t1:Turn)-[:MENTIONS]->(e:Entity)<-[:MENTIONS]-(t2:Turn)
WHERE t1.id <> t2.id
RETURN t1, t2, e
```

---

## 6. Implementation Milestones

### Milestone 1: Basic Pipeline (MVP)
- [ ] Dataset loader with Zod validation
- [ ] Session/Turn mapper to Engram graph
- [ ] Basic dense retrieval (Qdrant)
- [ ] Simple reader (direct LLM)
- [ ] Output in LongMemEval JSONL format

### Milestone 2: Optimized Retrieval
- [ ] Turn-level granularity indexing
- [ ] Key expansion (fact extraction)
- [ ] Time-aware query expansion
- [ ] Hybrid retrieval (BM25 + dense)

### Milestone 3: Optimized Reading
- [ ] Chain-of-Note implementation
- [ ] Structured JSON prompts
- [ ] Abstention confidence calibration

### Milestone 4: Full Evaluation
- [ ] GPT-4o QA evaluation integration
- [ ] Per-category metrics breakdown
- [ ] Retrieval recall/NDCG computation
- [ ] Comparison with published baselines

### Milestone 5: CI/CD & Reporting
- [ ] Automated benchmark runs
- [ ] Historical score tracking
- [ ] Regression detection
- [ ] Dashboard/reporting

---

## 7. Success Criteria

| Metric | Target | Stretch Goal |
|:---|:---|:---|
| Overall QA Accuracy | >70% | >85% |
| Temporal Reasoning (TR) | >65% | >80% |
| Knowledge Update (KU) | >60% | >75% |
| Retrieval Recall@10 | >80% | >90% |

**Competitive Positioning**:
- Match or exceed ChatGPT Memory (~30-70%)
- Target Mem0's performance level (+26% over ChatGPT)
- Stretch: Approach Hindsight's 91.4%

---

## 8. Open Questions

1. **LLM Selection**: Which model for fact extraction and reading?
   - Options: Llama 3.1 8B (paper's choice), Claude, GPT-4o-mini

2. **Embedding Model**: Which model for dense retrieval?
   - Options: Stella V5 1.5B (paper's choice), Qwen2 embeddings, OpenAI

3. **Graph Expansion**: Should we extract entities for graph-based retrieval?
   - Mem0g approach: Entity extraction → relationship triplets

4. **Abstention Strategy**: How to calibrate confidence for abstention?
   - Options: Logit analysis, separate classifier, threshold tuning

---

## References

1. [LongMemEval Paper](https://arxiv.org/abs/2410.10813) - Wu et al., ICLR 2025
2. [LongMemEval GitHub](https://github.com/xiaowu0162/LongMemEval)
3. [LongMemEval Dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
4. [Mem0 Architecture](https://docs.mem0.ai/open-source/graph_memory/overview)
5. [Vectorize Hindsight](https://www.prnewswire.com/news-releases/vectorize-breaks-90-on-longmemeval-with-open-source-ai-agent-memory-system-302643146.html)
6. [LoCoMo Benchmark](https://arxiv.org/abs/2402.17753) - ACL 2024
