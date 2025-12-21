# Engram Architecture

A bitemporal, graph-backed intelligent agent memory system.

## System Overview

```mermaid
flowchart TB
    subgraph External["External Sources"]
        Agent["AI Agent Streams<br/>(Claude Code, Codex, Gemini CLI,<br/>OpenCode, Cline, XAI, etc.)"]
    end

    subgraph Interface["Interface Layer"]
        Observatory["Neural Observatory<br/>(Next.js 16)<br/>:5000"]
        CloudAPI["Cloud REST API<br/>(Hono)<br/>:8080"]
        WebSocket["WebSocket Server"]
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
        Memory["Memory Service<br/>(Kafka Consumer)"]
        Search["Search Service<br/>(FastAPI)<br/>:5002"]
        Control["Control Service<br/>(VFS/Time-Travel)"]
        EngramMCP["Engram MCP Server<br/>(stdio + HTTP)"]
    end

    subgraph Storage["Data Stores"]
        Falkor[("FalkorDB<br/>(Graph)<br/>:6379")]
        Qdrant[("Qdrant<br/>(Vector)<br/>:6333")]
        Redis[("Redis<br/>(Pub/Sub)")]
        Postgres[("PostgreSQL<br/>(API Keys/Optuna)<br/>:5432")]
    end

    subgraph Optimization["Hyperparameter Tuning"]
        Tuner["Tuner Service<br/>(FastAPI/Optuna)<br/>:8000"]
        Dashboard["Optuna Dashboard<br/>:8080"]
    end

    Agent --> CloudAPI
    Agent --> EngramMCP
    CloudAPI --> RawTopic
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
    WebSocket --> Observatory

    Control --> Falkor
    EngramMCP --> Falkor
    EngramMCP --> Qdrant
    CloudAPI --> Falkor
    CloudAPI --> Qdrant

    Tuner --> Postgres
    Dashboard --> Postgres
    CloudAPI --> Postgres
```

## Data Flow Pipeline

```mermaid
flowchart LR
    subgraph Capture["1. Capture"]
        Stream["Agent Stream"]
        Raw["Raw Event"]
    end

    subgraph Parse["2. Parse"]
        Registry["Provider Registry"]
        Extract["Content Extraction"]
        Thinking["Thinking Extraction"]
        Diff["Diff Extraction"]
        Redact["PII Redaction"]
    end

    subgraph Store["3. Store"]
        Aggregate["Turn Aggregation"]
        Graph["Graph Persistence"]
        Temporal["Bitemporal Tracking"]
    end

    subgraph Index["4. Index"]
        Classify["Type Classification"]
        Embed["Multi-Vector Embedding"]
        Vector["Vector Storage"]
    end

    subgraph Retrieve["5. Retrieve"]
        MultiQuery["Multi-Query Expansion"]
        Hybrid["Hybrid Search"]
        Fusion["Learned RRF Fusion"]
        Rerank["Tiered Reranking"]
        Abstention["Abstention Detection"]
        Return["Results"]
    end

    Stream --> Raw --> Registry --> Extract --> Thinking --> Diff --> Redact
    Redact --> Aggregate --> Graph --> Temporal
    Temporal --> Classify --> Embed --> Vector
    Vector --> MultiQuery --> Hybrid --> Fusion --> Rerank --> Abstention --> Return
```

## Graph Data Model

```mermaid
erDiagram
    Session ||--o{ Turn : HAS_TURN
    Turn ||--o| Turn : NEXT
    Turn ||--o{ Reasoning : CONTAINS
    Turn ||--o{ ToolCall : INVOKES
    Reasoning ||--o{ ToolCall : TRIGGERS
    ToolCall ||--o{ FileTouch : TOUCHES
    ToolCall ||--o{ Observation : YIELDS
    DiffHunk ||--o| CodeArtifact : MODIFIES
    Session ||--o{ Memory : HAS_MEMORY

    Session {
        string id PK
        string title
        string user_id
        timestamp started_at
        string working_dir
        string git_remote
        enum agent_type
        string summary
        float[] embedding
        timestamp vt_start
        timestamp vt_end
        timestamp tt_start
        timestamp tt_end
    }

    Turn {
        string id PK
        string user_content
        string user_content_hash
        string assistant_preview
        string assistant_blob_ref
        float[] embedding
        int sequence_index
        string[] files_touched
        int tool_calls_count
        int input_tokens
        int output_tokens
        int cache_read_tokens
        int cache_write_tokens
        int reasoning_tokens
        float cost_usd
        int duration_ms
        string git_commit
    }

    Reasoning {
        string id PK
        string content_hash
        string preview
        string blob_ref
        enum reasoning_type
        int sequence_index
        float[] embedding
    }

    ToolCall {
        string id PK
        string call_id
        string tool_name
        enum tool_type
        string arguments_json
        string arguments_preview
        enum status
        string error_message
        int sequence_index
        int reasoning_sequence
    }

    FileTouch {
        string id PK
        string file_path
        enum action
        string tool_call_id
        int sequence_index
        string diff_preview
        int lines_added
        int lines_removed
        int match_count
        string[] matched_files
    }

    Observation {
        string id PK
        string tool_call_id
        string content
        string content_preview
        string content_hash
        boolean is_error
        string error_type
        int execution_time_ms
    }

    CodeArtifact {
        string id PK
        string filename
        string language
        string content_hash
        string blob_ref
    }

    DiffHunk {
        string id PK
        string file_path
        int original_line_start
        int original_line_end
        string patch_content
    }

    Memory {
        string id PK
        string content
        string content_hash
        enum type
        string[] tags
        string source_session_id
        string source_turn_id
        enum source
        string project
        string working_dir
        float[] embedding
    }

    Snapshot {
        string id PK
        string vfs_state_blob_ref
        string state_hash
        timestamp snapshot_at
    }
```

### Node Types

| Node | Purpose | Key Fields |
|:-----|:--------|:-----------|
| **Session** | Container for conversation | working_dir, git_remote, agent_type, summary |
| **Turn** | User prompt + assistant response pair | user_content, assistant_preview, embedding, files_touched |
| **Reasoning** | Thinking/reasoning block | reasoning_type (chain_of_thought, reflection, planning, analysis) |
| **ToolCall** | Tool invocation with lineage | tool_name, tool_type, status, arguments_json |
| **FileTouch** | File operation record | file_path, action (read/edit/create/delete/list/search) |
| **Observation** | Tool execution result | content, is_error, execution_time_ms |
| **Memory** | Explicit long-term memory | type (decision, context, insight, preference, fact, turn) |
| **CodeArtifact** | Code snippets | filename, language, blob_ref |
| **DiffHunk** | Patch content | file_path, patch_content |
| **Snapshot** | VFS state snapshot | vfs_state_blob_ref, snapshot_at |

### Edge Types

| Edge | From → To | Purpose |
|:-----|:----------|:--------|
| **HAS_TURN** | Session → Turn | Session contains turns |
| **NEXT** | Turn → Turn | Sequential ordering |
| **CONTAINS** | Turn → Reasoning | Turn contains thinking blocks |
| **INVOKES** | Turn → ToolCall | Turn triggers tool calls |
| **TRIGGERS** | Reasoning → ToolCall | Causal link: reasoning led to tool call |
| **TOUCHES** | ToolCall → FileTouch | Tool operated on file |
| **YIELDS** | ToolCall → Observation | Tool produced result |
| **MODIFIES** | DiffHunk → CodeArtifact | Diff changes code |
| **REPLACES** | Node → Node | Version supersession |
| **SAME_AS** | Node → Node | Deduplication link |

### Tool Call Types

```typescript
const ToolCallType = {
  // File operations
  FILE_READ, FILE_WRITE, FILE_EDIT, FILE_MULTI_EDIT,
  FILE_GLOB, FILE_GREP, FILE_LIST,

  // Execution
  BASH_EXEC, NOTEBOOK_READ, NOTEBOOK_EDIT,

  // Web
  WEB_FETCH, WEB_SEARCH,

  // Agent
  AGENT_SPAWN, TODO_READ, TODO_WRITE,

  // MCP
  MCP,

  // Fallback
  UNKNOWN,
};
```

## MCP Server Architecture

The Engram MCP Server provides Model Context Protocol integration for AI agents with both stdio and HTTP transports.

```mermaid
flowchart TB
    subgraph Client["MCP Client (Claude Code, etc.)"]
        Agent["AI Agent"]
    end

    subgraph Transport["Transport Layer"]
        Stdio["Stdio Transport"]
        HTTP["HTTP Transport<br/>(Ingest Endpoints)"]
    end

    subgraph EngramMCP["Engram MCP Server"]
        subgraph Tools["Tools"]
            Remember["engram_remember<br/>Store memories"]
            Recall["engram_recall<br/>Retrieve memories"]
            Query["engram_query<br/>Execute Cypher"]
            Context["engram_context<br/>Get full context"]
            Summarize["engram_summarize<br/>LLM summarization"]
            ExtractFacts["engram_extract_facts<br/>Fact extraction"]
            EnrichMemory["engram_enrich_memory<br/>Auto-enrichment"]
        end

        subgraph Resources["Resources (Local Mode)"]
            MemoryRes["memory://{id}<br/>Memory content"]
            SessionRes["session://{id}/transcript<br/>Session data"]
            FileHistoryRes["file-history://{path}<br/>File changes"]
        end

        subgraph Prompts["Prompts (Local Mode)"]
            Prime["/e prime<br/>Initial context"]
            Recap["/e recap<br/>Session summary"]
            Why["/e why<br/>Reasoning explanation"]
        end

        subgraph Capabilities["Capability Services"]
            Sampling["SamplingService<br/>(Client LLM calls)"]
            Elicitation["ElicitationService"]
            Roots["RootsService"]
        end

        subgraph Services["Core Services"]
            MemoryStore["MemoryStore"]
            MemoryRetriever["MemoryRetriever"]
        end
    end

    subgraph Storage["Storage"]
        Falkor[("FalkorDB")]
        Qdrant[("Qdrant")]
    end

    Agent <--> Stdio
    Agent <--> HTTP
    Stdio <--> Tools & Resources & Prompts
    HTTP <--> Tools
    Tools --> Services
    Resources --> Services
    Prompts --> Services
    Capabilities --> Services
    Services --> Falkor & Qdrant
```

### MCP Tools

| Tool | Purpose | Parameters |
|:-----|:--------|:-----------|
| **engram_remember** | Store memory with deduplication | content, type (decision/context/insight/preference/fact), tags, project |
| **engram_recall** | Hybrid search with optional reranking | query, limit, project, types, rerank |
| **engram_query** | Execute read-only Cypher queries (local mode) | query (Cypher string) |
| **engram_context** | Comprehensive context for task | query, include_sessions, include_memories, include_file_history |
| **engram_summarize** | Summarize text using client LLM | text, max_length (requires sampling capability) |
| **engram_extract_facts** | Extract key facts as structured list | text (requires sampling capability) |
| **engram_enrich_memory** | Auto-generate summary, keywords, category | memory_id (requires sampling capability) |

### MCP Resources (Local Mode Only)

| Resource URI | Content |
|:-------------|:--------|
| `memory://{id}` | Memory node content with metadata |
| `session://{id}/transcript` | Full session transcript with turns |
| `file-history://{path}` | File change history across sessions |

### MCP Prompts (Local Mode Only)

| Prompt | Purpose |
|:-------|:--------|
| **/e prime** | Initial context priming with relevant memories and recent activity |
| **/e recap** | Session summary for context recovery after breaks |
| **/e why** | Explain reasoning behind decisions with causal trace |

## Cloud REST API

The Cloud API (`apps/api`) provides authenticated HTTP access to memory operations with API key authentication and rate limiting.

### API Endpoints

| Endpoint | Method | Purpose | Scope |
|:---------|:-------|:--------|:------|
| `/v1/health` | GET | Health check | Public |
| `/v1/memory/remember` | POST | Store memory with deduplication | `memory:write` |
| `/v1/memory/recall` | POST | Hybrid search with reranking | `memory:read` |
| `/v1/memory/query` | POST | Read-only Cypher queries | `query:read` |
| `/v1/memory/context` | POST | Comprehensive context assembly | `memory:read` |
| `/v1/keys` | GET | List API keys | `keys:manage` |
| `/v1/keys/revoke` | POST | Revoke API key | `keys:manage` |

### Authentication

- API keys stored in PostgreSQL with scoped permissions
- Rate limiting per API key
- CORS configuration for web clients

## Search Service API

The Search Service (`apps/search`) provides vector search capabilities via FastAPI.

### Search Endpoints

| Endpoint | Method | Purpose |
|:---------|:-------|:--------|
| `/health` | GET | Health check with Qdrant status |
| `/ready` | GET | Kubernetes readiness probe |
| `/metrics` | GET | Prometheus metrics |
| `/search` | POST | Hybrid search with strategy (dense/sparse/hybrid) |
| `/search/multi-query` | POST | LLM-driven query expansion (DMQR-RAG) |
| `/search/session-aware` | POST | Two-stage hierarchical retrieval |
| `/embed` | POST | Generate embeddings for external use |

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
        TextEmbed["TextEmbedder<br/>Xenova/multilingual-e5-small<br/>384d, 512 tokens"]
        CodeEmbed["CodeEmbedder<br/>Xenova/nomic-embed-text-v1<br/>768d, 8192 tokens"]
        SpladeEmbed["SpladeEmbedder<br/>splade-bert-tiny-nq-onnx<br/>30522d sparse"]
        ColBERTEmbed["ColBERTEmbedder<br/>jina-colbert-v2<br/>128d per token"]
    end

    subgraph Cache["Embedding Cache"]
        EmbedCache["LRU Cache<br/>TTL-based eviction"]
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
    Labels -->|"Turn, Reasoning, Memory"| TextEmbed

    TextEmbed --> Cache --> TextDense
    CodeEmbed --> Cache --> CodeDense

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

    subgraph PreProcessing["Pre-Processing"]
        TemporalParser["Temporal Parser<br/>(chrono-node)"]
        QueryClassifier["Query Classifier<br/>(code vs text)"]
        MultiQuery["Multi-Query Expansion"]
    end

    subgraph Retrieval["Hybrid Retrieval"]
        Dense["Dense Search<br/>(text_dense or code_dense)"]
        SparseSearch["Sparse Search<br/>(SPLADE)"]
        SessionRetriever["Session Retriever"]
    end

    subgraph Fusion["Score Fusion"]
        QueryFeatures["Query Feature Extraction"]
        FusionPredictor["Learned Fusion MLP"]
        RRF["Dynamic RRF Weights"]
        ScoreMerger["Score Merger"]
    end

    subgraph Reranking["Tiered Reranking"]
        RerankerRouter["Reranker Router"]
        Fast["Fast: FlashRank"]
        Accurate["Accurate: BGE cross-encoder"]
        CodeRank["Code: Jina-reranker-v2"]
        ColBERT["ColBERT: Late interaction"]
        LLM["LLM: Gemini 3.0 Flash"]
    end

    subgraph PostProcessing["Post-Processing"]
        Dedup["Deduplicator"]
        AbstentionDetector["Abstention Detector<br/>(Confidence Scoring)"]
    end

    subgraph Output["Results"]
        Results["Ranked Results"]
        Abstained["Abstained Response"]
    end

    UserQuery --> TemporalParser --> QueryClassifier --> MultiQuery
    MultiQuery --> Dense & SparseSearch & SessionRetriever
    Dense & SparseSearch --> QueryFeatures
    QueryFeatures --> FusionPredictor --> RRF --> ScoreMerger
    SessionRetriever --> ScoreMerger
    ScoreMerger --> RerankerRouter
    RerankerRouter --> Fast & Accurate & CodeRank & ColBERT & LLM
    Fast & Accurate & CodeRank & ColBERT & LLM --> Dedup --> AbstentionDetector
    AbstentionDetector --> Results
    AbstentionDetector -.->|"low confidence"| Abstained
```

### Search Services

| Service | Purpose |
|:--------|:--------|
| **TemporalParser** | Parse temporal expressions ("yesterday", "last week") |
| **QueryClassifier** | Classify queries as code vs text |
| **MultiQueryRetriever** | Expand queries for better recall |
| **SessionRetriever** | Two-stage session-aware retrieval |
| **SessionSummarizer** | Generate session summaries for indexing |
| **LearnedFusion** | MLP-based dynamic RRF weight prediction |
| **RerankerRouter** | Route to appropriate reranker tier |
| **AbstentionDetector** | Detect when to abstain from answering |
| **Deduplicator** | Remove duplicate results |

### Reranker Tiers

| Tier | Model | Latency | Use Case |
|:-----|:------|:--------|:---------|
| **fast** | FlashRank | ~10ms | High-throughput, real-time autocomplete |
| **accurate** | BGE cross-encoder | ~50ms | General-purpose accuracy |
| **code** | Jina-reranker-v2 | ~50ms | Code-specific ranking |
| **colbert** | Late interaction | ~30ms | Multi-vector token-level matching |
| **llm** | Gemini 3.0 Flash listwise | ~500ms | Highest quality, complex queries |

## Provider Parsers

The ingestion system uses a registry-based parser architecture to support multiple AI agent formats.

```mermaid
flowchart LR
    subgraph Input["Raw Events"]
        ClaudeCode["Claude Code"]
        Anthropic["Anthropic API"]
        OpenAI["OpenAI API"]
        Gemini["Gemini"]
        Codex["Codex"]
        Cline["Cline"]
        XAI["XAI/Grok"]
        OpenCode["OpenCode"]
    end

    subgraph Registry["Parser Registry"]
        Detect["Provider Detection"]
        Lookup["Parser Lookup"]
    end

    subgraph Parsers["Provider Parsers"]
        ClaudeCodeParser["ClaudeCodeParser"]
        AnthropicParser["AnthropicParser"]
        OpenAIParser["OpenAIParser"]
        GeminiParser["GeminiParser"]
        CodexParser["CodexParser"]
        ClineParser["ClineParser"]
        XAIParser["XAIParser"]
        OpenCodeParser["OpenCodeParser"]
    end

    subgraph Extractors["Stream Extractors"]
        ThinkingExtractor["ThinkingExtractor<br/>(<thinking> blocks)"]
        DiffExtractor["DiffExtractor<br/>(Unified diffs)"]
        Redactor["PII Redactor"]
    end

    subgraph Output["Normalized Output"]
        StreamDelta["StreamDelta"]
    end

    Input --> Detect --> Lookup --> Parsers
    Parsers --> ThinkingExtractor --> DiffExtractor --> Redactor --> StreamDelta
```

### Supported Providers

| Provider | Parser | Aliases |
|:---------|:-------|:--------|
| Anthropic | AnthropicParser | claude |
| Claude Code | ClaudeCodeParser | claude-code |
| OpenAI | OpenAIParser | gpt, gpt-4, gpt-3.5 |
| Gemini | GeminiParser | - |
| Codex | CodexParser | - |
| Cline | ClineParser | - |
| XAI | XAIParser | grok, grok-3 |
| OpenCode | OpenCodeParser | - |

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
        Observatory["Observatory<br/>:5000"]
        API["Cloud API<br/>:8080"]
        Ingestion["Ingestion<br/>:5001"]
        Memory["Memory<br/>(Consumer)"]
        Search["Search<br/>:5002"]
        Control["Control<br/>(VFS)"]
        EngramMCP["Engram MCP<br/>(stdio/HTTP)"]
        Tuner["Tuner<br/>:8000"]
    end

    subgraph Infra["Infrastructure"]
        Kafka["Redpanda"]
        Graph["FalkorDB"]
        Vector["Qdrant"]
        PubSub["Redis"]
        Postgres["PostgreSQL"]
    end

    Observatory <-->|"Pub/Sub"| PubSub
    Observatory -->|"Cypher queries"| Graph

    API -->|"POST events"| Kafka
    API -->|"Cypher queries"| Graph
    API -->|"Vector search"| Vector
    API -->|"API keys"| Postgres

    Ingestion <-->|"Consume/Produce"| Kafka

    Memory <-->|"Consume/Produce"| Kafka
    Memory -->|"Write nodes"| Graph
    Memory -->|"Publish updates"| PubSub

    Search <-->|"Consume"| Kafka
    Search -->|"Index/Search"| Vector

    Control <-->|"Consume"| Kafka
    Control -->|"Query context"| Graph

    EngramMCP -->|"Query"| Graph
    EngramMCP -->|"Search"| Vector

    Tuner -->|"Studies"| Postgres
```

## Infrastructure

### Development Stack (docker-compose.dev.yml)

| Service | Image | Ports | Purpose |
|:--------|:------|:------|:--------|
| **Redpanda** | redpanda:v24.2.1 | 9092, 19092, 18081 | Kafka-compatible streaming |
| **FalkorDB** | falkordb:v4.2.1 | 6379 | Graph database |
| **Qdrant** | qdrant:v1.12.1 | 6333, 6334 | Vector database (HTTP + gRPC) |
| **PostgreSQL** | postgres:17-alpine | 5432 | API keys & Optuna persistence |
| **Tuner** | Custom (FastAPI) | 8000 | Hyperparameter optimization |
| **Optuna Dashboard** | optuna-dashboard:v0.17.0 | 8080 | Optimization visualization |

### Production Infrastructure (Pulumi/GCP)

All infrastructure managed via Pulumi IaC (`packages/infra`) with cost control via `devEnabled` flag.

**Networking:**
- VPC network with private Google access
- Cloud Router with NAT gateway for egress
- Regional subnet with manual configuration

**GKE Autopilot Cluster:**
- Fully-managed node provisioning and scaling
- Vertical Pod Autoscaling enabled
- Regular release channel for automatic upgrades
- Deletion protection in production

**Kubernetes Workloads (engram namespace):**

| Component | Type | Storage | Replicas (dev/prod) |
|:----------|:-----|:--------|:--------------------|
| FalkorDB | StatefulSet | 50Gi PVC | 1 / 3 |
| Qdrant | Helm Chart | 50Gi PVC | 1 / 3 |
| Redpanda | Helm Chart | 50Gi PVC | 1 / 3 |
| PostgreSQL | StatefulSet | 10Gi PVC | 1 / 1 |
| Tuner API | Deployment | - | 2 / 2 |
| Dashboard | Deployment | - | 1 / 1 |

**Network Policies (Least Privilege):**
- Default deny-all ingress for namespace
- FalkorDB: memory, ingestion, mcp, backup jobs only
- Qdrant: search, memory, backup jobs only
- Redpanda: ingestion, memory, backup jobs only

**RBAC Service Accounts:**
- `memory-sa`, `ingestion-sa`, `search-sa`, `mcp-sa`: ConfigMaps, Secrets, Pods access
- `backup-sa`: ClusterRole for PVC and storage access

**Automated Backups:**
- GCS bucket with 30-day retention
- Daily CronJobs: FalkorDB (2 AM), Qdrant (3 AM), Redpanda (4 AM)
- Stored in `gs://{project}-engram-backups/`

**Secret Management:**
- Google Generative AI API key for Gemini reranking
- PostgreSQL credentials for tuner service
- Automatic replication across regions

## Hyperparameter Tuning

```mermaid
flowchart LR
    subgraph Benchmark["Benchmark Suite"]
        LongMemEval["LongMemEval Dataset"]
        Runner["Benchmark Runner"]
    end

    subgraph Tuner["Tuner Service"]
        FastAPI["FastAPI Server<br/>:8000"]
        Optuna["Optuna Studies"]
        Samplers["TPE/CMA-ES Samplers"]
    end

    subgraph Storage["Persistence"]
        Postgres[("PostgreSQL<br/>:5432")]
    end

    subgraph Visualization["Visualization"]
        Dashboard["Optuna Dashboard<br/>:8080"]
    end

    subgraph Targets["Tunable Parameters"]
        FusionWeights["RRF Fusion Weights"]
        RerankerThresholds["Reranker Thresholds"]
        AbstentionThreshold["Abstention Threshold"]
        EmbeddingParams["Embedding Parameters"]
    end

    LongMemEval --> Runner
    Runner <--> FastAPI
    FastAPI --> Optuna
    Optuna --> Samplers
    Optuna --> Postgres
    Postgres --> Dashboard
    Samplers --> Targets
```

## Benchmark Evaluation

The benchmark package provides LongMemEval evaluation for measuring retrieval quality.

### Supported Abilities

| Ability | Description |
|:--------|:------------|
| **Information Extraction** | Extract specific facts from memory |
| **Multi-Session Reasoning** | Reason across multiple sessions |
| **Temporal Reasoning** | Answer time-based queries |
| **Knowledge Update** | Handle conflicting/updated information |
| **Abstention** | Know when not to answer |

### Benchmark CLI

```bash
# Run full evaluation
engram-benchmark run --abilities all --judge anthropic

# Run specific ability
engram-benchmark run --abilities temporal_reasoning

# Train fusion weights
engram-benchmark train-fusion --study-name fusion-v1

# Validate dataset
engram-benchmark validate
```

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

## Time Travel & VFS

The Control Service provides filesystem reconstruction at any point in time via the integrated ExecutionService.

```mermaid
flowchart TB
    subgraph Query["Time Travel Query"]
        Request["list_files_at_time(path, timestamp)"]
    end

    subgraph TimeTravelService["Time Travel Service"]
        Rehydrator["VFS Rehydrator"]
        SnapshotManager["Snapshot Manager"]
    end

    subgraph Graph["FalkorDB"]
        Sessions["Sessions"]
        Turns["Turns"]
        FileTouches["FileTouches"]
        Snapshots["Snapshots"]
    end

    subgraph VFS["Virtual File System"]
        Tree["File Tree"]
        PatchManager["Patch Manager"]
    end

    subgraph Output["Result"]
        FileList["File listing at timestamp"]
    end

    Request --> TimeTravelService
    TimeTravelService --> Graph
    Graph --> Rehydrator
    Rehydrator --> VFS
    VFS --> Output
```

### VFS & Time-Travel Operations (Control Service)

| Operation | Purpose |
|:----------|:--------|
| **readFile** | Read file from VFS |
| **applyPatch** | Apply unified diff to VFS |
| **listFilesAtTime** | Get filesystem state at timestamp |
| **getFilesystemState** | Get full VFS at a point in time |
| **getZippedState** | Get zipped snapshot of VFS |

## Package Structure

```
engram/
├── apps/
│   ├── api/              # Cloud REST API (Hono) - API key auth, rate limiting (:8080)
│   ├── control/          # Session orchestration, XState decision engine, VFS
│   ├── ingestion/        # Event parsing pipeline, 8+ provider parsers (:5001)
│   ├── mcp/              # Engram MCP server (stdio + HTTP ingest)
│   ├── memory/           # Graph persistence, turn aggregation (Kafka consumer)
│   ├── observatory/      # Neural Observatory - Next.js 16 session visualization (:5000)
│   ├── search/           # Python/FastAPI vector search, hybrid retrieval (:5002)
│   └── tuner/            # Python/FastAPI hyperparameter optimization (:8000)
│
├── packages/
│   ├── benchmark/        # LongMemEval evaluation suite (Python)
│   ├── common/           # Utilities, errors, constants, testing fixtures
│   ├── events/           # Zod event schemas (RawStreamEvent, ParsedStreamEvent)
│   ├── graph/            # Bitemporal graph models, repositories, QueryBuilder
│   ├── infra/            # Pulumi IaC for GCP (VPC, GKE Autopilot, databases)
│   ├── logger/           # Pino structured logging with PII redaction
│   ├── parser/           # Provider stream parsers, ThinkingExtractor, Redactor
│   ├── storage/          # FalkorDB, Kafka, PostgreSQL, Redis, GCS clients
│   ├── temporal/         # Rehydrator, TimeTravelService, ReplayEngine
│   ├── tsconfig/         # Shared TypeScript 7 (tsgo) configuration
│   ├── tuner/            # TypeScript client, CLI, trial executor
│   └── vfs/              # VirtualFileSystem, NodeFileSystem, PatchManager
│
└── ARCHITECTURE.md       # This document
```
