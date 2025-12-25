# Engram Benchmark

Python package for evaluating AI agent memory systems using the LongMemEval benchmark (ICLR 2025), with extended support for MTEB and BEIR benchmarks.

## What It Does

This package provides a complete evaluation suite for testing memory retrieval systems. It loads conversation datasets, indexes them into vector stores, retrieves relevant contexts for questions, generates answers using LLMs, and computes comprehensive metrics to assess performance across different memory abilities (information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention).

## Key Features

- **LongMemEval Pipeline**: End-to-end evaluation for the ICLR 2025 LongMemEval benchmark across 5 memory abilities
- **Dual Retrieval Backends**: ChromaDB (local, in-memory) or Engram search service (production, hybrid search with reranking)
- **LLM Integration**: 100+ LLM providers via LiteLLM (OpenAI, Anthropic, Google, Ollama, etc.)
- **Comprehensive Metrics**: QA accuracy (exact match or LLM-based), retrieval quality (MRR, NDCG, Recall), abstention detection, latency percentiles, and RAGAS metrics
- **Extended Benchmarks**: MTEB for embedding evaluation, BEIR for retrieval evaluation
- **Async Execution**: Concurrent retrieval and generation with configurable parallelism
- **Rich CLI**: Terminal UI with progress bars, formatted reports (Markdown, JSON, JSONL)

## Installation

### Using uv (recommended)

```bash
cd packages/benchmark
uv venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
uv pip install -e ".[dev]"
```

### Using pip

```bash
pip install engram-benchmark
```

For development:

```bash
pip install -e ".[dev]"
```

For MTEB/BEIR support:

```bash
pip install -e ".[mteb]"
```

## Quick Start

### 1. Validate a Dataset

```bash
engram-benchmark validate data/longmemeval_oracle.json
```

### 2. Run LongMemEval Benchmark

```bash
engram-benchmark run \
  --dataset data/longmemeval_oracle.json \
  --model openai/gpt-4o-mini \
  --embedding-model BAAI/bge-base-en-v1.5 \
  --top-k 10 \
  --limit 50
```

### 3. Run MTEB Benchmark

```bash
engram-benchmark mteb \
  --model BAAI/bge-base-en-v1.5 \
  --tasks Banking77Classification \
  --languages en
```

### 4. Run BEIR Benchmark

```bash
engram-benchmark beir \
  --model BAAI/bge-base-en-v1.5 \
  --datasets nfcorpus \
  --batch-size 128
```

## CLI Commands

### `validate`

Validate a LongMemEval dataset file:

```bash
engram-benchmark validate <dataset>
engram-benchmark validate --variant oracle data/longmemeval_oracle.json
```

**Output**:
- JSON structure validation
- Pydantic field validation
- Dataset statistics by question type and memory ability

### `run`

Run the full LongMemEval benchmark pipeline:

```bash
engram-benchmark run \
  --dataset data/longmemeval_oracle.json \
  --model openai/gpt-4o-mini \
  --embedding-model BAAI/bge-base-en-v1.5 \
  --top-k 10 \
  --concurrency 5 \
  --limit 50 \
  --output-dir ./results
```

**Options**:
- `--dataset, -d`: Path to LongMemEval dataset JSON (default: `./data/longmemeval_oracle.json`)
- `--model, -m`: LLM model for answer generation (default: `openai/gpt-4o-mini`)
- `--embedding-model, -e`: Embedding model (default: `BAAI/bge-base-en-v1.5`)
- `--retriever, -r`: Retriever provider (`chroma` or `engram`, default: `chroma`)
- `--search-url`: Engram search service URL (only for `--retriever=engram`, default: `http://localhost:6176`)
- `--search-strategy`: Search strategy for Engram (`hybrid`, `dense`, `sparse`, default: `hybrid`)
- `--rerank`: Enable reranking for Engram retriever (default: `True`)
- `--rerank-tier`: Reranker tier (`fast`, `accurate`, `code`, `llm`, default: `accurate`)
- `--top-k, -k`: Number of contexts to retrieve (default: 10)
- `--concurrency, -c`: Number of concurrent operations (default: 5)
- `--limit, -n`: Limit number of instances to evaluate
- `--output-dir, -o`: Output directory for results (default: `./results`)
- `--llm-eval`: Use LLM-based evaluation instead of exact match
- `--ragas`: Enable RAGAS metrics (faithfulness, context recall, etc.)

**Output**:
- Markdown report with metrics breakdown
- JSON report with detailed results
- JSONL file with per-instance predictions

### `evaluate`

Evaluate existing predictions against ground truth (offline evaluation):

```bash
engram-benchmark evaluate \
  --predictions results/results_20250120_143022.jsonl \
  --ground-truth data/longmemeval_oracle.json \
  --output results/evaluation_report.json
```

**Options**:
- `--predictions, -p`: Path to predictions JSONL file (required)
- `--ground-truth, -g`: Path to ground truth dataset JSON (required)
- `--llm-eval`: Use LLM-based evaluation instead of exact match
- `--output, -o`: Output file for report (`.json` or `.md`)

**Use Case**: Evaluate predictions generated separately without re-running retrieval and generation.

### `mteb`

Run MTEB (Massive Text Embedding Benchmark) evaluation:

```bash
engram-benchmark mteb \
  --model BAAI/bge-base-en-v1.5 \
  --tasks Banking77Classification,EmotionClassification \
  --languages en \
  --batch-size 32 \
  --device cpu
```

**Options**:
- `--model, -m`: HuggingFace or sentence-transformers model
- `--tasks, -t`: Comma-separated task names (default: `Banking77Classification`)
- `--languages, -l`: Comma-separated language codes (default: `en`)
- `--batch-size, -b`: Batch size for encoding (default: 32)
- `--device, -d`: Device (cpu, cuda, mps, auto) (default: `cpu`)
- `--list-tasks`: List available MTEB tasks
- `--output-dir, -o`: Output directory (default: `./results/mteb`)

### `beir`

Run BEIR (Benchmarking Information Retrieval) evaluation:

```bash
engram-benchmark beir \
  --model BAAI/bge-base-en-v1.5 \
  --datasets nfcorpus,scifact \
  --split test \
  --batch-size 128 \
  --top-k 100
```

**Options**:
- `--model, -m`: Sentence-transformers model
- `--datasets, -d`: Comma-separated dataset names (default: `nfcorpus`)
- `--split, -s`: Dataset split (test or dev) (default: `test`)
- `--batch-size, -b`: Batch size for encoding (default: 128)
- `--top-k, -k`: Number of documents to retrieve (default: 100)
- `--device`: Device (cpu, cuda, mps, auto) (default: `cpu`)
- `--list-datasets`: List available BEIR datasets
- `--output-dir, -o`: Output directory (default: `./results/beir`)

### `version`

Show version information:

```bash
engram-benchmark version
```

## Python API

### Basic Usage

```python
from engram_benchmark.longmemeval.loader import load_dataset, validate_dataset

# Load and validate dataset
dataset = load_dataset("data/longmemeval_oracle.json")
print(f"Loaded {len(dataset)} instances")

# Validate only (returns statistics)
is_valid, stats = validate_dataset("data/longmemeval_oracle.json")
if is_valid:
    print(f"Dataset contains {stats['total']} instances")
```

### Run Full Benchmark

```python
import asyncio
from engram_benchmark.longmemeval.pipeline import BenchmarkPipeline, PipelineConfig
from engram_benchmark.longmemeval.reader import LongMemEvalReader
from engram_benchmark.longmemeval.retriever import ChromaRetriever
from engram_benchmark.providers.embeddings import EmbeddingProvider
from engram_benchmark.providers.llm import LiteLLMProvider

async def main():
    # Initialize embedder and retriever
    embedder = EmbeddingProvider(model_name="BAAI/bge-base-en-v1.5")
    await embedder.load()

    retriever = ChromaRetriever(embedder=embedder)
    await retriever.load()

    # Initialize LLM and reader
    llm = LiteLLMProvider(model="openai/gpt-4o-mini")
    reader = LongMemEvalReader(llm_provider=llm)

    # Configure pipeline
    config = PipelineConfig(
        dataset_path="data/longmemeval_oracle.json",
        output_dir="./results",
        limit=50,
        top_k=10,
        concurrency=5,
        use_llm_eval=False,
    )

    # Run pipeline
    pipeline = BenchmarkPipeline(config, retriever, reader)
    report = await pipeline.run()

    # Print results
    print(f"Overall Accuracy: {report.metrics.overall.accuracy:.1%}")
    print(f"MRR: {report.metrics.retrieval.mrr:.4f}")
    print(f"Retrieval P95: {report.metrics.latency['retrieval_p95_ms']:.2f}ms")

asyncio.run(main())
```

### Using Engram Retriever

```python
from engram_benchmark.longmemeval.retriever import EngramRetriever
from engram_benchmark.providers.engram import EngramSearchClient

# Create Engram search client
search_client = EngramSearchClient(base_url="http://localhost:6176")

# Create retriever with hybrid search and reranking
retriever = EngramRetriever(
    client=search_client,
    strategy="hybrid",
    rerank=True,
    rerank_tier="accurate",
)

# Use in pipeline (same as ChromaRetriever)
pipeline = BenchmarkPipeline(config, retriever, reader)
```

### Custom Retriever

```python
from engram_benchmark.longmemeval.retriever import BaseRetriever, RetrievalResult, RetrievedContext
from engram_benchmark.longmemeval.types import ParsedInstance

class MyRetriever(BaseRetriever):
    async def retrieve(
        self,
        instance: ParsedInstance,
        top_k: int = 10
    ) -> RetrievalResult:
        # Implement custom retrieval logic
        contexts = [
            RetrievedContext(
                content="Retrieved document content",
                score=0.95,
                session_id="session_1",
                turn_index=0,
                has_answer=True,
            )
        ]

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            total_retrieved=len(contexts),
            turn_recall=1.0,
            session_recall=1.0,
        )
```

## Configuration

### Environment Variables

```bash
# LLM API Keys
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# LLM Settings (optional)
export BENCHMARK_LLM_MODEL=openai/gpt-4o-mini
export BENCHMARK_LLM_MAX_TOKENS=1024

# Retrieval Settings (optional)
export BENCHMARK_RETRIEVAL_PROVIDER=chromadb
export BENCHMARK_EMBEDDING_MODEL=BAAI/bge-base-en-v1.5
```

### Config File (YAML)

```yaml
llm:
  model: openai/gpt-4o-mini
  max_tokens: 1024
  temperature: 0.0

retrieval:
  provider: chromadb
  embedding_model: BAAI/bge-base-en-v1.5
  top_k: 10

pipeline:
  concurrency: 5
  granularity: turn
```

Load with:

```python
from engram_benchmark.config import load_config

config = load_config("benchmark.yaml")
```

## Exported APIs

### Top-level Exports

```python
from engram_benchmark import (
    # Data types
    LongMemEvalDataset,
    LongMemEvalInstance,
    MemoryAbility,
    QuestionType,
    Session,
    Turn,
)
```

### LongMemEval Module

```python
from engram_benchmark.longmemeval.loader import (
    load_dataset,          # Load and validate dataset
    validate_dataset,      # Validate without loading
)

from engram_benchmark.longmemeval.pipeline import (
    BenchmarkPipeline,     # End-to-end pipeline orchestrator
    PipelineConfig,        # Pipeline configuration
    PipelineResult,        # Single instance result
    run_benchmark,         # Convenience function
)

from engram_benchmark.longmemeval.retriever import (
    BaseRetriever,         # Retriever interface
    ChromaRetriever,       # In-memory ChromaDB retriever
    EngramRetriever,       # Engram search service retriever
    RetrievalResult,       # Retrieval output
    RetrievedContext,      # Single retrieved context
)

from engram_benchmark.longmemeval.reader import (
    LongMemEvalReader,     # LLM answer generator
    LongMemEvalReaderOutput,  # Reader output
)

from engram_benchmark.longmemeval.types import (
    ParsedInstance,        # Normalized instance
    ParsedSession,         # Normalized session
    ParsedTurn,            # Normalized turn
    EvaluationMetrics,     # Complete metrics
    AbilityMetrics,        # Per-ability metrics
    RetrievalMetrics,      # Retrieval quality metrics
    AbstentionMetrics,     # Abstention metrics
)
```

### Providers

```python
from engram_benchmark.providers.llm import (
    LiteLLMProvider,       # LLM provider (100+ models)
    LLMResponse,           # LLM response with tokens/cost
)

from engram_benchmark.providers.embeddings import (
    EmbeddingProvider,     # Sentence-transformers wrapper
)

from engram_benchmark.providers.engram import (
    EngramSearchClient,    # Engram search API client
)
```

### Metrics

```python
from engram_benchmark.metrics.qa import (
    evaluate_qa,           # QA evaluation
)

from engram_benchmark.metrics.retrieval import (
    compute_retrieval_metrics,  # MRR, NDCG, Recall
)

from engram_benchmark.metrics.abstention import (
    compute_abstention_metrics,  # Precision, Recall, F1
)

from engram_benchmark.metrics.latency import (
    compute_latency_percentiles,  # P50, P95, P99
)

from engram_benchmark.metrics.ragas import (
    evaluate_ragas,        # RAGAS metrics
)
```

### Benchmarks

```python
from engram_benchmark.benchmarks.mteb import (
    MTEBBenchmark,         # MTEB evaluation
    MTEBConfig,            # MTEB configuration
)

from engram_benchmark.benchmarks.beir import (
    BEIRBenchmark,         # BEIR evaluation
    BEIRConfig,            # BEIR configuration
)
```

### Utilities

```python
from engram_benchmark.utils.reporting import (
    BenchmarkReport,       # Report data model
    generate_markdown_report,  # Generate MD report
    generate_json_report,      # Generate JSON report
    print_summary,             # Print report to console
)

from engram_benchmark.utils.progress import (
    ProgressTracker,       # Progress tracking
)
```

## Architecture

```
packages/benchmark/
├── src/engram_benchmark/
│   ├── __init__.py              # Package exports
│   ├── cli.py                   # Typer CLI (validate, run, mteb, beir)
│   ├── config.py                # Pydantic Settings
│   │
│   ├── longmemeval/             # LongMemEval benchmark
│   │   ├── types.py             # Pydantic data models
│   │   ├── loader.py            # Dataset loading/validation
│   │   ├── mapper.py            # Instance → Document mapping
│   │   ├── retriever.py         # Retrieval abstractions (Chroma, Engram)
│   │   ├── reader.py            # LLM answer generation
│   │   ├── pipeline.py          # End-to-end orchestration
│   │   ├── temporal.py          # Temporal reasoning
│   │   ├── abstention.py        # Abstention detection
│   │   └── key_expansion.py     # Chain-of-Note prompting
│   │
│   ├── metrics/                 # Evaluation metrics
│   │   ├── qa.py                # QA accuracy (exact match & LLM-based)
│   │   ├── retrieval.py         # MRR, NDCG, Recall, MAP
│   │   ├── abstention.py        # Precision, Recall, F1
│   │   ├── latency.py           # P50, P90, P95, P99
│   │   └── ragas.py             # RAGAS (faithfulness, relevancy)
│   │
│   ├── providers/               # External service integrations
│   │   ├── llm.py               # LiteLLM provider (100+ models)
│   │   ├── embeddings.py        # sentence-transformers
│   │   ├── engram.py            # Engram search API client
│   │   └── reader.py            # Reader protocol
│   │
│   ├── benchmarks/              # Extended benchmarks
│   │   ├── mteb.py              # MTEB evaluation
│   │   └── beir.py              # BEIR evaluation
│   │
│   └── utils/                   # Utilities
│       ├── progress.py          # Rich progress tracking
│       └── reporting.py         # Report generation (MD, JSON, JSONL)
│
├── tests/                       # Test suite (pytest)
├── examples/                    # Usage examples
└── pyproject.toml               # Package configuration
```

## Data Models

### LongMemEval Types

The package uses Pydantic models for type-safe data handling:

- **`Turn`**: Single conversation turn with `role` (user/assistant), `content`, and optional `has_answer` flag
- **`Session`**: List of `Turn` objects representing a conversation
- **`LongMemEvalInstance`**: Raw dataset instance with question, answer, sessions, and metadata
- **`ParsedInstance`**: Normalized instance with parsed timestamps and typed fields
- **`LongMemEvalDataset`**: List of `LongMemEvalInstance` objects
- **`QuestionType`**: Enum for question types (single-session-user, multi-session, etc.)
- **`MemoryAbility`**: Literal type for abilities (IE, MR, TR, KU, ABS)

### Question Types → Memory Abilities Mapping

| Question Type | Memory Ability | Description |
|---------------|----------------|-------------|
| `single-session-user` | **IE** | Information Extraction from user messages |
| `single-session-assistant` | **IE** | Information Extraction from assistant messages |
| `single-session-preference` | **IE** | Information Extraction of user preferences |
| `multi-session` | **MR** | Multi-Session Reasoning across conversations |
| `temporal-reasoning` | **TR** | Temporal Reasoning about time-based events |
| `knowledge-update` | **KU** | Knowledge Update (conflicting information) |
| Any type with `_abs` suffix | **ABS** | Abstention (unanswerable questions) |

## Dependencies

### Core Dependencies

- **CLI & UI**: typer, rich, click
- **Config**: pydantic, pydantic-settings, pyyaml
- **LLM**: litellm, anthropic, openai
- **Embeddings**: sentence-transformers, torch
- **Vector DB**: qdrant-client, chromadb
- **Metrics**: ranx, ragas, scikit-learn, numpy
- **Data**: datasets, pandas
- **Temporal**: python-dateutil, dateparser
- **HTTP**: httpx
- **Progress**: tqdm

### Optional Dependencies

- **`mteb`**: Install with `pip install engram-benchmark[mteb]` for MTEB and BEIR benchmarks

### Development Dependencies

- **Testing**: pytest, pytest-asyncio, pytest-cov
- **Linting**: ruff
- **Type Checking**: mypy, type stubs

## Development

### Running Tests

```bash
cd packages/benchmark

# All tests
uv run pytest

# With coverage
uv run pytest --cov=engram_benchmark --cov-report=term-missing

# Specific test file
uv run pytest -v tests/test_loader.py

# With output
uv run pytest -s
```

### Type Checking

```bash
uv run mypy src/engram_benchmark
```

### Linting & Formatting

```bash
# Check
uv run ruff check src tests
uv run ruff format --check src tests

# Auto-fix
uv run ruff check --fix src tests
uv run ruff format src tests
```

### Running All Checks

```bash
uv run ruff check src tests && \
uv run ruff format --check src tests && \
uv run mypy src/engram_benchmark && \
uv run pytest
```

## Examples

See the `examples/` directory for:

- `quick_start.py`: Basic dataset loading and validation
- `longmemeval_evaluation.py`: Complete LongMemEval benchmark
- `custom_retriever.py`: Implementing a custom retriever

## Metrics

The package computes comprehensive evaluation metrics across multiple dimensions:

### QA Metrics

- **Accuracy**: Exact string match (normalized) or LLM-based semantic evaluation
- **Per-ability breakdown**: Separate accuracy for IE, MR, TR, KU, and ABS
- **Total/Correct counts**: Raw numbers for each ability

### Retrieval Metrics

- **MRR (Mean Reciprocal Rank)**: Position of first relevant document (higher is better)
- **NDCG (Normalized Discounted Cumulative Gain)**: Ranking quality @1, @5, @10 (0-1)
- **Recall**: Fraction of relevant documents retrieved @1, @5, @10 (0-1)
- **MAP (Mean Average Precision)**: Average precision across all queries (0-1)
- **Turn Recall**: Percentage of evidence-containing turns retrieved (0-1)
- **Session Recall**: Percentage of evidence sessions retrieved (0-1)

### Abstention Metrics

When questions require abstention (unanswerable questions):

- **Precision**: Correct abstentions / total predicted abstentions
- **Recall**: Correct abstentions / ground truth abstentions
- **F1 Score**: Harmonic mean of precision and recall
- **True/False Positives/Negatives**: Confusion matrix components

### Latency Metrics

Performance timing in milliseconds:

- **Mean**: Average latency across all instances
- **P50 (Median)**: 50th percentile
- **P90**: 90th percentile
- **P95**: 95th percentile
- **P99**: 99th percentile
- Separate tracking for **retrieval** and **reader** stages

### RAGAS Metrics (Optional)

Advanced RAG evaluation when enabled (`--ragas` flag):

- **Faithfulness**: Answer consistency with retrieved contexts (0-1)
- **Answer Relevancy**: Relevance of answer to question (0-1)
- **Context Precision**: Precision of retrieved contexts (0-1)
- **Context Recall**: Recall of retrieved contexts (0-1)

## References

- [LongMemEval Paper](https://github.com/xiaowu0162/LongMemEval) - ICLR 2025
- [Dataset on HuggingFace](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- [MTEB Benchmark](https://github.com/embeddings-benchmark/mteb)
- [BEIR Benchmark](https://github.com/beir-cellar/beir)

## License

MIT
