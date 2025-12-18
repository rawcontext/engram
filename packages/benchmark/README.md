# @engram/benchmark

[![LongMemEval](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ccheney/engram/main/.github/benchmark-history/badge.json)](https://github.com/ccheney/engram/actions/workflows/benchmark.yml)

Benchmark suite for evaluating Engram's memory system against industry-standard benchmarks.

## Supported Benchmarks

### LongMemEval (ICLR 2025)

[LongMemEval](https://github.com/xiaowu0162/LongMemEval) tests 5 core memory abilities:

| Ability | Code | Description |
|:--------|:-----|:------------|
| Information Extraction | IE | Recall specific facts from history |
| Multi-Session Reasoning | MR | Synthesize across sessions |
| Temporal Reasoning | TR | Use timestamps and temporal refs |
| Knowledge Update | KU | Handle contradictory info over time |
| Abstention | ABS | Recognize unanswerable questions |

## Quick Start

### 1. Download the Dataset

```bash
cd packages/benchmark/data

# Oracle dataset (smallest, ~500 questions with evidence only)
curl -L -o longmemeval_oracle.json \
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json"

# Small dataset (~115k tokens, ~40 sessions)
curl -L -o longmemeval_s_cleaned.json \
  "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json"
```

### 2. Validate the Dataset

```bash
npx tsx src/cli/index.ts validate data/longmemeval_oracle.json
```

### 3. Run the Benchmark

```bash
# Quick test with stub providers
npx tsx src/cli/index.ts run longmemeval \
  --dataset data/longmemeval_oracle.json \
  --limit 10 \
  --verbose

# Full run with real providers
npx tsx src/cli/index.ts run longmemeval \
  --dataset data/longmemeval_oracle.json \
  --embeddings e5 \
  --llm anthropic \
  --chain-of-note \
  --key-expansion \
  --temporal-analysis \
  --output results/benchmark.jsonl
```

### 4. Evaluate Results

```bash
npx tsx src/cli/index.ts evaluate \
  --hypothesis results/benchmark.jsonl \
  --ground-truth data/longmemeval_oracle.json \
  --output results/metrics.json
```

## CLI Options

### `run` Command

| Option | Description | Default |
|:-------|:------------|:--------|
| `-d, --dataset <path>` | Path to dataset file | Required |
| `-v, --variant <s\|m\|oracle>` | Dataset variant | `s` |
| `-o, --output <path>` | Output file for results | - |
| `-l, --limit <n>` | Limit number of instances | - |
| `-k, --top-k <n>` | Documents to retrieve | `10` |
| `--retriever <method>` | dense, bm25, hybrid | `dense` |
| `--chain-of-note` | Enable Chain-of-Note | `false` |
| `--key-expansion` | Enable key expansion | `false` |
| `--temporal-analysis` | Enable temporal analysis | `false` |
| `--embeddings <provider>` | stub, qdrant, e5 | `stub` |
| `--llm <provider>` | stub, anthropic, openai, ollama | `stub` |

### `evaluate` Command

| Option | Description |
|:-------|:------------|
| `-h, --hypothesis <path>` | Path to hypothesis JSONL |
| `-g, --ground-truth <path>` | Path to ground truth dataset |
| `-o, --output <path>` | Output file for metrics |
| `--llm-eval` | Use LLM-based evaluation |

## Metrics

### QA Metrics

- **Overall Accuracy**: Percentage of correct answers
- **Per-Ability Accuracy**: Breakdown by IE, MR, TR, KU, ABS

### Retrieval Metrics

- **Recall@K**: Percentage of evidence retrieved at K={1,5,10}
- **NDCG@K**: Normalized Discounted Cumulative Gain
- **MRR**: Mean Reciprocal Rank

### Abstention Metrics

- **Precision**: Correct abstentions / Total abstentions
- **Recall**: Correct abstentions / Questions requiring abstention
- **F1 Score**: Harmonic mean of precision and recall

## Optimizations

Based on [LongMemEval paper](https://arxiv.org/abs/2410.10813) findings:

| Optimization | Improvement | Flag |
|:-------------|:------------|:-----|
| Chain-of-Note | +10 points QA | `--chain-of-note` |
| Key Expansion | +9.4% recall | `--key-expansion` |
| Time-Aware Queries | +7-11% on TR | `--temporal-analysis` |

## CI/CD

The benchmark runs automatically:
- **Weekly**: Sunday at midnight (scheduled)
- **On PR**: When benchmark code changes
- **Manual**: Via workflow dispatch

Results are stored as artifacts and tracked historically.

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Architecture

```
packages/benchmark/
├── src/
│   ├── longmemeval/
│   │   ├── types.ts       # Zod schemas & types
│   │   ├── loader.ts      # Dataset loading
│   │   ├── mapper.ts      # LongMemEval → Engram
│   │   ├── retriever.ts   # Vector retrieval
│   │   ├── reader.ts      # LLM answer generation
│   │   ├── evaluator.ts   # Metrics computation
│   │   ├── pipeline.ts    # Orchestration
│   │   ├── key-expansion.ts   # Fact extraction
│   │   ├── temporal.ts    # Time-aware queries
│   │   └── providers/     # Real provider integrations
│   └── cli/
│       └── commands/      # CLI command handlers
├── tests/                 # Test suites
└── data/                  # Dataset storage
```
