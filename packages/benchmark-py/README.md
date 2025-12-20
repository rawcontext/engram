# Engram Benchmark

LongMemEval benchmark suite for evaluating the Engram memory system.

## Status: Phase 1 Complete

This package implements Phase 1 (Foundation) of the Python benchmark migration:

- ✅ Pydantic models for LongMemEval types
- ✅ Dataset loader with validation
- ✅ Typer CLI with Rich progress
- ✅ Configuration models with Pydantic Settings
- ✅ Test infrastructure with pytest

## Installation

Using uv (recommended):

```bash
cd packages/benchmark-py
uv venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
uv pip install -e ".[dev]"
```

Using pip:

```bash
cd packages/benchmark-py
pip install -e ".[dev]"
```

## Quick Start

### Validate a Dataset

```bash
engram-benchmark validate data/longmemeval_oracle.json
```

Or using Python module:

```bash
python -m engram_benchmark validate data/longmemeval_oracle.json
```

### Programmatic Usage

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

## CLI Commands

### `validate`

Validate a LongMemEval dataset file:

```bash
engram-benchmark validate <dataset>
engram-benchmark validate --variant oracle data/longmemeval_oracle.json
```

Shows:
- JSON structure validation
- Pydantic field validation
- Dataset statistics by question type and memory ability

### `run` (placeholder)

Will run the full benchmark pipeline (Phase 5):

```bash
engram-benchmark run --dataset data/longmemeval_oracle.json --limit 50
```

### `evaluate` (placeholder)

Will evaluate predictions against ground truth (Phase 4):

```bash
engram-benchmark evaluate --predictions results.jsonl --ground-truth data/longmemeval_oracle.json
```

### `version`

Show version information:

```bash
engram-benchmark version
```

## Development

### Running Tests

```bash
pytest
pytest --cov=engram_benchmark  # with coverage
pytest -v tests/test_loader.py  # specific test file
```

### Type Checking

```bash
mypy src/engram_benchmark
```

### Linting

```bash
ruff check src tests
ruff format src tests  # auto-format
```

### Running All Checks

```bash
# From packages/benchmark-py
ruff check src tests && \
ruff format --check src tests && \
mypy src/engram_benchmark && \
pytest
```

## Architecture

```
packages/benchmark-py/
├── src/engram_benchmark/
│   ├── __init__.py           # Package exports
│   ├── __main__.py           # CLI entry: python -m engram_benchmark
│   ├── cli.py                # Typer CLI commands
│   ├── config.py             # Pydantic Settings configuration
│   └── longmemeval/
│       ├── __init__.py       # LongMemEval exports
│       ├── types.py          # Pydantic models
│       └── loader.py         # Dataset loading and validation
└── tests/
    ├── conftest.py           # Pytest fixtures
    ├── test_types.py         # Type model tests
    └── test_loader.py        # Loader tests
```

## Data Models

### Core Types

- `Turn`: Single conversation turn (user or assistant)
- `Session`: List of turns representing a conversation
- `LongMemEvalInstance`: Single evaluation instance
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

## Configuration

Configuration uses Pydantic Settings with environment variable support:

```bash
# LLM Settings
export BENCHMARK_LLM_MODEL=anthropic/claude-sonnet-4-20250514
export BENCHMARK_LLM_MAX_TOKENS=1024

# Retrieval Settings
export BENCHMARK_RETRIEVAL_PROVIDER=engram
export BENCHMARK_RETRIEVAL_SEARCH_URL=http://localhost:5002

# API Keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

Or use a config file (Phase 2+):

```python
from engram_benchmark.config import load_config

config = load_config("benchmark.yaml")
```

## Next Phases

- **Phase 2**: LLM Integration (LiteLLM, Chain-of-Note)
- **Phase 3**: Retrieval (Sentence-transformers, Qdrant, Engram)
- **Phase 4**: Evaluation Metrics (ranx, RAGAS)
- **Phase 5**: Pipeline (End-to-end orchestration)
- **Phase 6**: Extended Benchmarks (MTEB, BEIR)

## References

- [LongMemEval Paper](https://github.com/xiaowu0162/LongMemEval) - ICLR 2025
- [Dataset on HuggingFace](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- [Migration Plan](../../docs/plans/benchmark-python-migration.md)
