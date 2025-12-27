# Engram Benchmark

LongMemEval evaluation suite (ICLR 2025) for AI agent memory systems with MTEB and BEIR benchmark support.

## Purpose

Evaluates memory retrieval systems by loading conversation datasets, indexing them into vector stores, retrieving relevant contexts, generating LLM answers, and computing comprehensive metrics across 5 memory abilities: Information Extraction (IE), Multi-Session Reasoning (MR), Temporal Reasoning (TR), Knowledge Updates (KU), and Abstention (ABS).

## Key Features

- **LongMemEval Pipeline**: End-to-end evaluation across 5 memory abilities
- **Dual Retrieval**: ChromaDB (local) or Engram search service (hybrid search with reranking)
- **100+ LLMs**: LiteLLM integration (OpenAI, Anthropic, Google, Ollama, etc.)
- **Comprehensive Metrics**: QA accuracy, retrieval quality (MRR, NDCG, Recall), abstention, latency, RAGAS
- **Extended Benchmarks**: MTEB (embedding) and BEIR (retrieval) evaluation
- **Async Execution**: Concurrent operations with configurable parallelism

## Installation

```bash
cd packages/benchmark && uv sync && source .venv/bin/activate
```

For MTEB/BEIR: `uv pip install -e ".[mteb]"`

## Usage

```bash
# Validate dataset
engram-benchmark validate data/longmemeval_oracle.json

# Run LongMemEval with ChromaDB (local)
engram-benchmark run \
  --dataset data/longmemeval_oracle.json \
  --model openai/gpt-4o-mini \
  --embedding-model BAAI/bge-base-en-v1.5 \
  --top-k 10 --limit 50

# Run with Engram retriever (production, hybrid search + reranking)
engram-benchmark run --retriever engram --search-strategy hybrid --rerank

# Run MTEB benchmark
engram-benchmark mteb --model BAAI/bge-base-en-v1.5 --tasks Banking77Classification

# Run BEIR benchmark
engram-benchmark beir --model BAAI/bge-base-en-v1.5 --datasets nfcorpus
```

## Development

```bash
# Run tests
uv run pytest --cov=engram_benchmark

# Lint and format
uv run ruff check src tests
uv run ruff format src tests

# Type check
uv run mypy src/engram_benchmark
```

## Architecture

**Pipeline**: Dataset → Indexing (ChromaDB/Engram) → Retrieval (top-k) → LLM Generation → Evaluation

**Core Modules**:
- `longmemeval/`: Pipeline orchestration, retrieval, reader, temporal reasoning
- `metrics/`: QA, retrieval (MRR, NDCG, Recall), abstention, latency, RAGAS
- `providers/`: LiteLLM (100+ models), embeddings (sentence-transformers), Engram API
- `benchmarks/`: MTEB and BEIR evaluation

**Key Metrics**:
- QA: Exact match or LLM-based accuracy per memory ability (IE, MR, TR, KU, ABS)
- Retrieval: MRR, NDCG@k, Recall@k, MAP, turn/session recall
- Abstention: Precision, Recall, F1 for unanswerable questions
- Latency: P50/P90/P95/P99 for retrieval and generation

See `examples/` for usage patterns and `pyproject.toml` for full dependency list.

## References

- [LongMemEval (ICLR 2025)](https://github.com/xiaowu0162/LongMemEval)
- [HuggingFace Dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- [MTEB](https://github.com/embeddings-benchmark/mteb)
- [BEIR](https://github.com/beir-cellar/beir)
