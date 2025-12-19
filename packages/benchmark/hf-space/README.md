---
title: Engram Benchmark
emoji: brain
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
suggested_hardware: l4x1
suggested_storage: small
---

# Engram LongMemEval Benchmark

GPU-accelerated benchmark runner for evaluating the Engram memory retrieval system on LongMemEval dataset.

## Hardware

This Space requires **L4 GPU** ($0.80/hr) for optimal performance:
- 24GB VRAM for embedding models (E5-large, fp16)
- CUDA 12.3 with cuDNN 9 for ONNX Runtime

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/start` | POST | Start benchmark run |
| `/status` | GET | Get current status and output |
| `/results` | GET | Download results (when complete) |

## Usage

```bash
# Check health
curl https://engram-benchmark.hf.space/

# Start benchmark
curl -X POST https://engram-benchmark.hf.space/start

# Check status
curl https://engram-benchmark.hf.space/status

# Download results
curl https://engram-benchmark.hf.space/results > results.jsonl
```

## Configuration

Set these secrets in the Space settings:

| Secret | Description |
|--------|-------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key for answer generation |

## Benchmark Features

Full Engram pipeline with all optimizations:

**Retrieval:**
- Dense embeddings (E5-large, 1024d, fp16)
- Sparse embeddings (SPLADE)
- Hybrid search with RRF fusion
- Multi-query expansion
- Session-aware hierarchical retrieval
- Temporal query parsing

**Reranking:**
- Cross-encoder reranking (accurate tier)
- Deep candidate pool (50 docs)

**Reading:**
- Chain-of-Note structured reasoning
- Time-aware query expansion

**Abstention (3-layer):**
- Low retrieval confidence
- NLI answer grounding
- Hedging pattern detection

## Results

Results are saved to `/results/benchmark-results.jsonl` and can be downloaded via the `/results` endpoint.
