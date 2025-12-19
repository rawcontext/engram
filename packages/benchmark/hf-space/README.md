---
title: Engram Benchmark
emoji: 🧠
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
suggested_hardware: l4x1
suggested_storage: small
---

# Engram LongMemEval Benchmark

GPU-accelerated benchmark runner for evaluating the Engram memory retrieval system on LongMemEval dataset.

**Full Engram Stack:** FalkorDB (bitemporal graph) + Qdrant (vectors) running in-container.

## Hardware

This Space requires **L4 GPU** ($0.80/hr) for optimal performance:
- 24GB VRAM for embedding models (E5-large, fp16)
- CUDA 12.3 with cuDNN 9 for ONNX Runtime

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check (shows FalkorDB + Qdrant status) |
| `/ingest` | POST | Ingest dataset into FalkorDB + Qdrant |
| `/start` | POST | Start benchmark (requires ingest first) |
| `/status` | GET | Get current status and output |
| `/results` | GET | Download results (when complete) |

## Usage

```bash
# Check health
curl https://engram-benchmark.hf.space/

# Step 1: Ingest data into FalkorDB (graph) + Qdrant (vectors)
curl -X POST https://engram-benchmark.hf.space/ingest

# Wait for ingest to complete...
curl https://engram-benchmark.hf.space/status

# Step 2: Run benchmark with full Engram pipeline
curl -X POST https://engram-benchmark.hf.space/start

# Check status
curl https://engram-benchmark.hf.space/status

# Step 3: Download results
curl https://engram-benchmark.hf.space/results > results.jsonl
```

## Architecture

The benchmark runs the **full Engram stack**:

```
LongMemEval Dataset
       ↓
  FalkorDB (bitemporal graph)
  - Session nodes with timestamps
  - Turn nodes with content
  - Memory nodes for retrieval
       ↓
  Qdrant (vector index)
  - E5-large embeddings (fp16)
  - Hybrid search (dense + sparse)
       ↓
  Engram Retrieval Pipeline
  - Graph traversal + vector search
  - Session-aware hierarchical retrieval
  - Temporal query parsing
       ↓
  Gemini (answer generation)
       ↓
  Results
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
