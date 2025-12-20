# Changelog

All notable changes to the Engram Benchmark package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-XX

### Added

#### Core Features
- **LongMemEval Dataset Support**
  - Pydantic models for all LongMemEval dataset types
  - Dataset loader with validation and statistics
  - Support for all question types (IE, MR, TR, KU, ABS)
  - Dataset variant detection (oracle, s, m)

#### Pipeline & Orchestration
- **End-to-end Benchmark Pipeline**
  - Async pipeline with configurable concurrency
  - Document mapping with turn/session granularity
  - Integrated retrieval and answer generation
  - Automatic report generation (Markdown + JSON + JSONL)
  - Progress tracking with Rich terminal UI

#### LLM Integration
- **LiteLLM Provider**
  - Support for 100+ LLM providers (OpenAI, Anthropic, Google, etc.)
  - Configurable temperature and max tokens
  - Async streaming support
- **Chain-of-Note Prompting**
  - Key expansion from questions and contexts
  - Improved answer quality for complex queries
- **LongMemEval Reader**
  - Specialized prompting for LongMemEval tasks
  - Abstention detection
  - Context-aware answer generation

#### Retrieval
- **ChromaDB Retriever**
  - Local vector store with sentence-transformers embeddings
  - Configurable top-k retrieval
  - Automatic document indexing
  - Metadata filtering support
- **Engram API Retriever**
  - Integration with Engram search API
  - Hybrid search support (vector + keyword)
  - Configurable reranking
- **Embedding Provider**
  - sentence-transformers integration
  - Support for 5000+ models from HuggingFace
  - Batch encoding with configurable batch size
  - GPU acceleration support

#### Metrics & Evaluation
- **QA Metrics**
  - Exact match accuracy
  - LLM-based evaluation (GPT-4o)
  - Per-ability breakdown (IE, MR, TR, KU, ABS)
  - Per-question-type analysis
- **Retrieval Metrics**
  - Mean Reciprocal Rank (MRR) @1, @5, @10
  - Normalized Discounted Cumulative Gain (NDCG) @1, @5, @10
  - Recall @1, @5, @10
  - Precision @1, @5, @10
- **Abstention Metrics**
  - Precision, Recall, F1 score
  - Correct identification of unanswerable questions
- **Latency Metrics**
  - Mean, Median (P50), P95, P99 latencies
  - Per-stage timing (retrieval, generation)
- **RAGAS Metrics**
  - Context precision
  - Context recall
  - Answer relevancy
  - Faithfulness

#### Extended Benchmarks
- **MTEB (Massive Text Embedding Benchmark)**
  - Support for 100+ embedding evaluation tasks
  - Classification, clustering, retrieval, reranking
  - Multi-language support
  - Automatic result aggregation
- **BEIR (Benchmarking Information Retrieval)**
  - 18+ diverse retrieval datasets
  - Zero-shot evaluation
  - Standard metrics (NDCG, Recall, MAP)

#### Temporal & Special Features
- **Temporal Reasoning**
  - Date/time extraction from conversations
  - Relative time parsing ("last week", "3 days ago")
  - Temporal context augmentation
- **Abstention Detection**
  - Pattern-based detection ("I don't know", "unsure")
  - LLM-based classification
  - Configurable confidence thresholds
- **Document Mapping**
  - Turn-level granularity (default)
  - Session-level granularity
  - Automatic metadata extraction
  - Timestamp normalization

#### CLI Commands
- `validate`: Validate LongMemEval dataset files
- `run`: Execute full LongMemEval benchmark pipeline
- `mteb`: Run MTEB embedding benchmarks
- `beir`: Run BEIR retrieval benchmarks
- `version`: Display package version
- Rich terminal UI with progress bars and live updates

#### Configuration
- **Pydantic Settings**
  - Environment variable support
  - YAML configuration files
  - Type-safe config with validation
  - Nested configuration for LLM, retrieval, pipeline
- **Configurable Parameters**
  - LLM model selection
  - Embedding model selection
  - Retrieval top-k
  - Concurrency limits
  - Output directories

#### Utilities
- **Progress Tracking**
  - Rich progress bars
  - Stage-based tracking
  - Success/failure counters
  - ETA calculation
- **Report Generation**
  - Markdown reports with formatted tables
  - JSON reports for programmatic access
  - JSONL for per-instance results
  - Timestamp-based filenames

#### Development Tools
- **Testing Infrastructure**
  - pytest configuration
  - Async test support
  - Fixture library for common test data
  - Mock providers for unit testing
- **Type Safety**
  - Full mypy type coverage
  - Strict mode enabled
  - Type stubs for external libraries
- **Code Quality**
  - Ruff linting and formatting
  - 100-character line limit
  - Import sorting
  - Comprehensive docstrings

### Documentation
- Comprehensive README with examples
- CLI command documentation
- API reference examples
- Configuration guide
- Architecture overview
- Metrics explanation

### Dependencies
- **Core**: typer, rich, pydantic, pydantic-settings
- **LLM**: litellm, anthropic, openai
- **Embeddings**: sentence-transformers, torch
- **Vector DB**: qdrant-client, chromadb
- **Metrics**: ranx, ragas, scikit-learn
- **Data**: datasets, pandas
- **Optional**: mteb, beir (for extended benchmarks)

### Package Metadata
- MIT License
- Python >= 3.11 required
- Hatchling build system
- Entry point: `engram-benchmark`

## [Unreleased]

### Planned Features
- Additional retrieval backends (Pinecone, Weaviate)
- More LLM evaluation providers
- Custom metric plugins
- Distributed evaluation support
- Web dashboard for results visualization
- Benchmark result comparison tools

---

For migration details and technical specifications, see the project documentation.
