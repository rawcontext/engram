# Engram Architecture

A bitemporal, graph-backed intelligent agent memory system.

## System Overview

```mermaid
flowchart TB
    subgraph External["External Sources"]
        Agent["AI Agent Streams<br/>(Claude Code, OpenAI, etc.)"]
    end

    subgraph Interface["Interface Layer"]
        NextJS["Next.js App<br/>:3000"]
        WebSocket["WebSocket Server"]
        API["REST API"]
    end

    subgraph Streaming["Event Streaming"]
        Redpanda["Redpanda (Kafka)<br/>:9092"]
        RawTopic[/"raw_events"/]
        ParsedTopic[/"parsed_events"/]
        NodeTopic[/"memory.node_created"/]
        DLQ[/"*.dead_letter"/]
    end

    subgraph Services["Application Services"]
        Ingestion["Ingestion Service<br/>:5001"]
        Memory["Memory Service<br/>(MCP Server)"]
        Search["Search Service<br/>:5002"]
        Control["Control Service"]
        Execution["Execution Service<br/>(MCP Server)"]
    end

    subgraph Storage["Data Stores"]
        Falkor[("FalkorDB<br/>(Graph)<br/>:6379")]
        Qdrant[("Qdrant<br/>(Vector)<br/>:6333")]
        Redis[("Redis<br/>(Pub/Sub)")]
    end

    subgraph Future["Future Components"]
        direction TB
        style Future fill:#f9f3e3,stroke:#d4a017

        subgraph QueryProc["Query Processing (Planned)"]
            TemporalParser["Temporal Parser<br/>P4: chrono-node"]
            MultiQuery["Multi-Query Expansion<br/>P1: DMQR-RAG"]
            SessionRouter["Session Router<br/>P3: Two-Stage"]
        end

        subgraph RetrievalV2["Retrieval v2 (Planned)"]
            NVEmbed["Dense: NV-Embed-v2<br/>P5: Upgrade"]
            SessionIndex["Session Index<br/>P3: Summaries"]
            LearnedFusion["Learned RRF Fusion<br/>P6: MLP Weights"]
        end

        subgraph PostProc["Post-Processing (Planned)"]
            Confidence["Confidence Scoring<br/>P2: Retrieval Score"]
            Abstention["Abstention Detector<br/>P2: HALT-RAG"]
        end
    end

    Agent --> API
    API --> RawTopic
    RawTopic --> Ingestion
    Ingestion --> ParsedTopic
    Ingestion -.-> DLQ

    ParsedTopic --> Memory
    ParsedTopic --> Control
    Memory --> Falkor
    Memory --> NodeTopic
    Memory --> Redis
    Memory -.-> DLQ

    NodeTopic --> Search
    Search --> Qdrant

    Redis --> WebSocket
    WebSocket --> NextJS

    Control --> Falkor
    Execution --> Falkor

    %% Future connections (dashed)
    Search -.->|"future"| QueryProc
    QueryProc -.-> RetrievalV2
    RetrievalV2 -.-> PostProc
```

## Data Flow Pipeline

```mermaid
flowchart LR
    subgraph Capture["1. Capture"]
        Stream["Agent Stream"]
        Raw["Raw Event"]
    end

    subgraph Parse["2. Parse"]
        Provider["Provider Detection"]
        Extract["Content Extraction"]
        Redact["PII Redaction"]
    end

    subgraph Store["3. Store"]
        Aggregate["Turn Aggregation"]
        Graph["Graph Persistence"]
        Temporal["Bitemporal Tracking"]
    end

    subgraph Index["4. Index"]
        Classify["Type Classification"]
        Embed["Embedding Generation"]
        Vector["Vector Storage"]
    end

    subgraph Retrieve["5. Retrieve"]
        Hybrid["Hybrid Search"]
        Rerank["Reranking"]
        Return["Results"]
    end

    Stream --> Raw --> Provider --> Extract --> Redact
    Redact --> Aggregate --> Graph --> Temporal
    Temporal --> Classify --> Embed --> Vector
    Vector --> Hybrid --> Rerank --> Return
```

## Graph Data Model

```mermaid
erDiagram
    Session ||--o{ Turn : HAS_TURN
    Turn ||--o| Turn : NEXT
    Turn ||--o{ Reasoning : CONTAINS
    Turn ||--o{ ToolCall : INVOKES
    ToolCall ||--o{ FileTouch : TOUCHES
    ToolCall ||--o{ Observation : YIELDS
    DiffHunk ||--o| CodeArtifact : MODIFIES

    Session {
        string id PK
        timestamp started_at
        string user_id
        string working_dir
        string git_remote
        string agent_type
        timestamp vt_start
        timestamp vt_end
        timestamp tt_start
        timestamp tt_end
    }

    Turn {
        string id PK
        string role
        string content
        int sequence
        timestamp vt_start
        timestamp vt_end
    }

    Reasoning {
        string id PK
        string content
        string type
    }

    ToolCall {
        string id PK
        string name
        json arguments
        string status
    }

    FileTouch {
        string id PK
        string path
        string action
    }

    CodeArtifact {
        string id PK
        string file_path
        string language
        string content
    }

    DiffHunk {
        string id PK
        string file_path
        string patch_content
    }

    Observation {
        string id PK
        string content
        boolean success
    }
```

## Embedding Architecture

```mermaid
flowchart TB
    subgraph Input["Content Input"]
        Text["Text Content"]
        Code["Code Content"]
    end

    subgraph Classification["Content Classification"]
        Labels{"Node Labels?"}
    end

    subgraph Embedders["Embedding Models"]
        subgraph Current["Current"]
            TextEmbed["TextEmbedder<br/>Xenova/multilingual-e5-small<br/>384d, 512 tokens"]
            CodeEmbed["CodeEmbedder<br/>Xenova/nomic-embed-text-v1<br/>768d, 8192 tokens"]
            SpladeEmbed["SpladeEmbedder<br/>splade-bert-tiny-nq-onnx<br/>30522d sparse"]
            ColBERTEmbed["ColBERTEmbedder<br/>jina-colbert-v2<br/>128d per token"]
        end

        subgraph Planned["Future (P5)"]
            style Planned fill:#f9f3e3,stroke:#d4a017
            GTEEmbed["GTE-Large<br/>1024d"]
            NVEmbed2["NV-Embed-v2<br/>4096d"]
        end
    end

    subgraph Vectors["Named Vectors in Qdrant"]
        TextDense["text_dense (384d)"]
        CodeDense["code_dense (768d)"]
        Sparse["sparse (indices + values)"]
        ColBERT["colbert (multivector)"]
    end

    Text --> Labels
    Code --> Labels
    Labels -->|"DiffHunk, CodeArtifact"| CodeEmbed
    Labels -->|"Turn, Thought, etc."| TextEmbed

    TextEmbed --> TextDense
    CodeEmbed --> CodeDense

    Text --> SpladeEmbed
    Code --> SpladeEmbed
    SpladeEmbed --> Sparse

    Text --> ColBERTEmbed
    Code --> ColBERTEmbed
    ColBERTEmbed --> ColBERT
```

## Search Pipeline

```mermaid
flowchart TB
    subgraph Query["Query Input"]
        UserQuery["User Query"]
    end

    subgraph CurrentPipeline["Current Pipeline"]
        QClassify["Query Classifier<br/>(code vs text)"]

        subgraph Retrieval["Hybrid Retrieval"]
            Dense["Dense Search<br/>(text_dense or code_dense)"]
            SparseSearch["Sparse Search<br/>(SPLADE BM25)"]
            RRF["Reciprocal Rank Fusion"]
        end

        subgraph Reranking["Reranking Tiers"]
            Fast["Fast: BM25"]
            Accurate["Accurate: ColBERT"]
            CodeRank["Code: AST-aware"]
            LLM["LLM: Claude/GPT"]
        end
    end

    subgraph FuturePipeline["Future Pipeline (Planned)"]
        style FuturePipeline fill:#f9f3e3,stroke:#d4a017

        subgraph P4["P4: Temporal"]
            TempParse["Temporal Parser<br/>chrono-node"]
            TimeFilter["Time Range Filter"]
        end

        subgraph P1["P1: Multi-Query"]
            Decompose["Query Decomposition"]
            Expand["Query Expansion"]
            Aggregate["Result Aggregation"]
        end

        subgraph P3["P3: Session-Aware"]
            SessionSum["Session Summaries"]
            TwoStage["Two-Stage Retrieval"]
        end

        subgraph P6["P6: Learned Fusion"]
            Features["Query Features"]
            MLP["Fusion MLP"]
            Weights["Dynamic Weights"]
        end

        subgraph P2["P2: Abstention"]
            ConfScore["Confidence Scoring"]
            NLI["NLI Grounding"]
            Hedge["Hedge Detection"]
            Abstain["Abstention Decision"]
        end
    end

    subgraph Output["Results"]
        Results["Ranked Results"]
        Abstained["Abstained Response"]
    end

    UserQuery --> QClassify
    QClassify --> Dense & SparseSearch
    Dense & SparseSearch --> RRF
    RRF --> Reranking --> Results

    %% Future flow
    UserQuery -.->|"future"| TempParse
    TempParse -.-> Decompose
    Decompose -.-> Expand
    Expand -.-> SessionSum
    SessionSum -.-> TwoStage
    TwoStage -.-> Features
    Features -.-> MLP
    MLP -.-> Weights
    Weights -.-> ConfScore
    ConfScore -.-> NLI
    NLI -.-> Hedge
    Hedge -.-> Abstain
    Abstain -.-> Abstained
```

## Kafka Topic Flow

```mermaid
flowchart LR
    subgraph Producers["Producers"]
        InterfaceP["Interface"]
        IngestionP["Ingestion"]
        MemoryP["Memory"]
    end

    subgraph Topics["Kafka Topics"]
        raw[/"raw_events"/]
        parsed[/"parsed_events"/]
        node[/"memory.node_created"/]
        dlq1[/"ingestion.dead_letter"/]
        dlq2[/"memory.dead_letter"/]
    end

    subgraph Consumers["Consumer Groups"]
        IngestionC["ingestion-group"]
        MemoryC["memory-group"]
        ControlC["control-group"]
        SearchC["search-group"]
    end

    InterfaceP --> raw
    IngestionP --> parsed & dlq1
    MemoryP --> node & dlq2

    raw --> IngestionC
    parsed --> MemoryC & ControlC
    node --> SearchC
```

## Service Communication Matrix

```mermaid
flowchart TB
    subgraph Services["Services"]
        Interface["Interface<br/>:3000"]
        Ingestion["Ingestion<br/>:5001"]
        Memory["Memory<br/>(MCP)"]
        Search["Search<br/>:5002"]
        Control["Control"]
        Execution["Execution<br/>(MCP)"]
    end

    subgraph Infra["Infrastructure"]
        Kafka["Redpanda"]
        Graph["FalkorDB"]
        Vector["Qdrant"]
        PubSub["Redis"]
    end

    Interface -->|"POST events"| Kafka
    Interface -->|"Cypher queries"| Graph
    Interface <-->|"Pub/Sub"| PubSub

    Ingestion <-->|"Consume/Produce"| Kafka

    Memory <-->|"Consume/Produce"| Kafka
    Memory -->|"Write nodes"| Graph
    Memory -->|"Publish updates"| PubSub

    Search <-->|"Consume"| Kafka
    Search -->|"Index/Search"| Vector

    Control <-->|"Consume"| Kafka
    Control -->|"Query context"| Graph

    Execution -->|"Query history"| Graph
```

## Future Roadmap

```mermaid
gantt
    title Retrieval v2 Implementation Phases
    dateFormat X
    axisFormat %s

    section Phase 1 - Quick Wins
    P2 Abstention Detection     :p2, 0, 1
    P4 Temporal Query Parser    :p4, 0, 1
    P5 Embedding Upgrade        :p5, 0, 1

    section Phase 2 - Core
    P1 Multi-Query Retrieval    :p1, 1, 2
    P3 Session-Aware Retrieval  :p3, 1, 2

    section Phase 3 - Optimization
    P6 Learned Fusion           :p6, 2, 3
```

| Priority | Feature | Expected Gain | Status |
|:--------:|:--------|:-------------:|:------:|
| P1 | Multi-Query Retrieval (DMQR-RAG) | +5-8% | Planned |
| P2 | Abstention Detection (HALT-RAG) | +3-5% | Planned |
| P3 | Session-Aware Retrieval | +2-4% | Planned |
| P4 | Temporal Query Understanding | +3-5% | Planned |
| P5 | Embedding Model Upgrade (GTE/NV-Embed) | +2-3% | Planned |
| P6 | Learned Fusion (MLP weights) | +1-2% | Planned |

**Current LongMemEval Accuracy**: 75.8%
**Target**: 85-88% (SOTA: 86%)

## Bitemporal Model

```mermaid
flowchart LR
    subgraph ValidTime["Valid Time (Reality)"]
        VT["When data is true<br/>vt_start / vt_end"]
    end

    subgraph TransactionTime["Transaction Time (System)"]
        TT["When data was recorded<br/>tt_start / tt_end"]
    end

    subgraph Queries["Query Types"]
        Current["Current State<br/>vt_end = ∞, tt_end = ∞"]
        AsOf["As-Of Query<br/>vt ≤ timestamp"]
        AsKnown["As-Known Query<br/>tt ≤ timestamp"]
        BiTemporal["Bitemporal Query<br/>vt ≤ t1, tt ≤ t2"]
    end

    ValidTime --> Queries
    TransactionTime --> Queries
```

All graph nodes and edges carry four timestamps:
- `vt_start`: When the fact became true
- `vt_end`: When the fact stopped being true (∞ if current)
- `tt_start`: When we recorded this fact
- `tt_end`: When we updated/deleted this record (∞ if current)

This enables time-travel queries like "What did we know about session X at time T?"
