# Engram Benchmark

LongMemEval benchmark suite for evaluating AI agent memory systems with support for MTEB and BEIR benchmarks.

## Features

- **LongMemEval Evaluation**: Complete pipeline for evaluating memory systems using the ICLR 2025 LongMemEval benchmark
- **Multiple Metrics**: QA accuracy, retrieval metrics (MRR, NDCG, Recall), abstention detection, and latency tracking
- **Flexible Retrieval**: ChromaDB or Engram API backends with configurable embeddings
- **LLM Integration**: Support for multiple LLM providers via LiteLLM (OpenAI, Anthropic, etc.)
- **MTEB & BEIR**: Extended benchmark support for embedding and retrieval evaluation
- **Async Pipeline**: Concurrent execution with configurable parallelism
- **Rich CLI**: Beautiful terminal UI with progress tracking and detailed reports

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
- `--dataset, -d`: Path to LongMemEval dataset JSON
- `--model, -m`: LLM model for answer generation (default: `openai/gpt-4o-mini`)
- `--embedding-model, -e`: Embedding model (default: `BAAI/bge-base-en-v1.5`)
- `--top-k, -k`: Number of contexts to retrieve (default: 10)
- `--concurrency, -c`: Number of concurrent operations (default: 5)
- `--limit, -n`: Limit number of instances to evaluate
- `--output-dir, -o`: Output directory for results (default: `./results`)
- `--llm-eval`: Use LLM-based evaluation instead of exact match

**Output**:
- Markdown report with metrics breakdown
- JSON report with detailed results
- JSONL file with per-instance predictions

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
from engram_benchmark import load_dataset, validate_dataset

# Load and validate
dataset = load_dataset("data/longmemeval_oracle.json")
print(f"Loaded {len(dataset)} instances")

# Just validate
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
    # Initialize components
    embedder = EmbeddingProvider(model_name="BAAI/bge-base-en-v1.5")
    await embedder.load()

    retriever = ChromaRetriever(embedder=embedder)
    await retriever.load()

    llm = LiteLLMProvider(model="openai/gpt-4o-mini")
    reader = LongMemEvalReader(llm_provider=llm)

    # Create pipeline
    config = PipelineConfig(
        dataset_path="data/longmemeval_oracle.json",
        output_dir="./results",
        limit=50,
        top_k=10,
    )

    pipeline = BenchmarkPipeline(config, retriever, reader)
    report = await pipeline.run()

    print(f"Overall Accuracy: {report.metrics.overall.accuracy:.1%}")
    print(f"MRR@10: {report.metrics.retrieval.mrr_at_10:.4f}")

asyncio.run(main())
```

### Custom Retriever

```python
from engram_benchmark.longmemeval.retriever import BaseRetriever, RetrievalResult, RetrievalContext
from engram_benchmark.longmemeval.types import ParsedInstance

class MyRetriever(BaseRetriever):
    async def retrieve(
        self,
        instance: ParsedInstance,
        top_k: int = 10
    ) -> RetrievalResult:
        # Custom retrieval logic
        contexts = [
            RetrievalContext(
                content="Retrieved document content",
                score=0.95,
                metadata={"source": "custom"}
            )
        ]

        return RetrievalResult(
            question_id=instance.question_id,
            contexts=contexts,
            retrieval_time_ms=100.0,
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

## Architecture

```
packages/benchmark/
├── src/engram_benchmark/
│   ├── __init__.py              # Package exports
│   ├── cli.py                   # Typer CLI commands
│   ├── config.py                # Pydantic Settings
│   │
│   ├── longmemeval/             # LongMemEval benchmark
│   │   ├── types.py             # Pydantic data models
│   │   ├── loader.py            # Dataset loading/validation
│   │   ├── mapper.py            # Instance → Document mapping
│   │   ├── retriever.py         # Retrieval abstractions
│   │   ├── reader.py            # LLM answer generation
│   │   ├── pipeline.py          # End-to-end orchestration
│   │   ├── temporal.py          # Temporal reasoning
│   │   ├── abstention.py        # Abstention detection
│   │   └── key_expansion.py     # Chain-of-Note prompting
│   │
│   ├── metrics/                 # Evaluation metrics
│   │   ├── qa.py                # QA accuracy (exact match & LLM-based)
│   │   ├── retrieval.py         # MRR, NDCG, Recall
│   │   ├── abstention.py        # Precision, Recall, F1
│   │   ├── latency.py           # Timing metrics
│   │   └── ragas.py             # RAGAS metrics
│   │
│   ├── providers/               # External service integrations
│   │   ├── llm.py               # LiteLLM provider
│   │   ├── embeddings.py        # sentence-transformers
│   │   ├── engram.py            # Engram API client
│   │   └── reader.py            # Reader protocol
│   │
│   ├── benchmarks/              # Extended benchmarks
│   │   ├── mteb.py              # MTEB evaluation
│   │   └── beir.py              # BEIR evaluation
│   │
│   └── utils/                   # Utilities
│       ├── progress.py          # Rich progress tracking
│       └── reporting.py         # Report generation
│
├── tests/                       # Test suite
├── examples/                    # Usage examples
└── pyproject.toml              # Package configuration
```

## Data Models

### LongMemEval Types

- `Turn`: Single conversation turn (user or assistant)
- `Session`: List of turns representing a conversation
- `LongMemEvalInstance`: Single evaluation instance with sessions and question
- `LongMemEvalDataset`: List of instances
- `QuestionType`: Enum of question types
- `MemoryAbility`: Literal type for abilities (IE, MR, TR, KU, ABS)

### Question Types → Memory Abilities

| Question Type | Memory Ability | Description |
|---------------|----------------|-------------|
| `single-session-user` | IE | Information Extraction (user messages) |
| `single-session-assistant` | IE | Information Extraction (assistant messages) |
| `single-session-preference` | IE | Information Extraction (preferences) |
| `multi-session` | MR | Multi-Session Reasoning |
| `temporal-reasoning` | TR | Temporal Reasoning |
| `knowledge-update` | KU | Knowledge Update |
| `*_abs` (suffix) | ABS | Abstention (any type with _abs suffix) |

## Development

### Running Tests

```bash
cd packages/benchmark

# All tests
pytest

# With coverage
pytest --cov=engram_benchmark

# Specific test file
pytest -v tests/test_loader.py

# Watch mode
pytest --watch
```

### Type Checking

```bash
mypy src/engram_benchmark
```

### Linting & Formatting

```bash
# Check
ruff check src tests
ruff format --check src tests

# Auto-fix
ruff check --fix src tests
ruff format src tests
```

### Running All Checks

```bash
ruff check src tests && \
ruff format --check src tests && \
mypy src/engram_benchmark && \
pytest
```

## Examples

See the `examples/` directory for:

- `quick_start.py`: Basic dataset loading and validation
- `longmemeval_evaluation.py`: Complete LongMemEval benchmark
- `custom_retriever.py`: Implementing a custom retriever

## Metrics

### QA Metrics

- **Accuracy**: Exact match or LLM-based evaluation
- **Per-ability breakdown**: IE, MR, TR, KU, ABS

### Retrieval Metrics

- **MRR (Mean Reciprocal Rank)**: @1, @5, @10
- **NDCG (Normalized Discounted Cumulative Gain)**: @1, @5, @10
- **Recall**: @1, @5, @10
- **Precision**: @1, @5, @10

### Abstention Metrics

- **Precision**: Correct abstentions / predicted abstentions
- **Recall**: Correct abstentions / ground truth abstentions
- **F1 Score**: Harmonic mean of precision and recall

### Latency Metrics

- **Mean**: Average latency across all instances
- **Median (P50)**: 50th percentile
- **P95**: 95th percentile
- **P99**: 99th percentile

## References

- [LongMemEval Paper](https://github.com/xiaowu0162/LongMemEval) - ICLR 2025
- [Dataset on HuggingFace](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- [MTEB Benchmark](https://github.com/embeddings-benchmark/mteb)
- [BEIR Benchmark](https://github.com/beir-cellar/beir)

## License

MIT
