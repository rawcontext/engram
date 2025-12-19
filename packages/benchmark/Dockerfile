# =============================================================================
# Engram Benchmark Container
# =============================================================================
# GPU-enabled container for running LongMemEval benchmarks with all Engram
# features enabled. Uses NVIDIA L4 GPU in Cloud Run.
#
# Build:
#   docker build -t engram-benchmark .
#
# Run locally (CPU):
#   docker run --rm engram-benchmark --help
#
# Run with GPU:
#   docker run --rm --gpus all engram-benchmark
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build dependencies
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install build essentials for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy package files for dependency installation
COPY package*.json ./
COPY packages/benchmark/package.json packages/benchmark/
COPY packages/search/package.json packages/search/
COPY packages/graph/package.json packages/graph/
COPY packages/storage/package.json packages/storage/
COPY packages/logger/package.json packages/logger/
COPY packages/common/package.json packages/common/
COPY packages/temporal/package.json packages/temporal/

# Install all dependencies
RUN npm install --include=dev

# Copy source code
COPY packages/ packages/
COPY biome.json ./

# Skip typecheck in Docker build (already validated locally)
# The onnxruntime-node types are provided by @huggingface/transformers at runtime

# -----------------------------------------------------------------------------
# Stage 2: Runtime image with CUDA support
# -----------------------------------------------------------------------------
# Using CUDA 12.3.2 with cuDNN 9 for ONNX Runtime GPU support (embedding models, rerankers)
# cuDNN 9 is required by onnxruntime-node; only available with CUDA 12.3.2 on Ubuntu 22.04
FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04

# Install Node.js 24
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package*.json ./

# Reinstall native modules for the runtime platform (needed for cross-platform builds)
# sharp and onnxruntime-node have native bindings that must match the runtime architecture
RUN npm install --os=linux --cpu=x64 sharp

# Model cache directory - set before preloading
ENV HF_HOME=/app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache
ENV XDG_CACHE_HOME=/app/.cache

# Pre-download HuggingFace models at build time to avoid runtime download issues
# Models are cached in /app/.cache and included in the image
# Download q8 quantized models for CPU mode (4x smaller than FP32, fits in 24GB RAM)
RUN mkdir -p /app/.cache && \
    node -e "const { pipeline } = require('@huggingface/transformers'); \
    (async () => { \
      console.log('Pre-downloading embedding models (q8 quantized for CPU)...'); \
      await pipeline('feature-extraction', 'Xenova/multilingual-e5-large', { dtype: 'q8' }); \
      await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' }); \
      console.log('Pre-downloading reranker models...'); \
      await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' }); \
      console.log('Models pre-downloaded successfully'); \
    })().catch(e => { console.error('Model preload failed:', e); process.exit(1); });"

# Create non-root user for security
RUN groupadd -r engram && useradd -r -g engram engram \
    && mkdir -p /data /results \
    && chown -R engram:engram /app /data /results

USER engram

# Environment configuration
ENV NODE_ENV=production
ENV BENCHMARK_VERBOSE=true

# Force CPU mode to avoid ONNX Runtime CUDA memory allocation issues
# The BFC arena in CUDAExecutionProvider allocates 4-10x model size
# which causes OOM even with 24GB VRAM when loading multiple models
# Use q8 quantized models (4x smaller than FP32) to fit in 24GB RAM
ENV EMBEDDER_DEVICE=cpu
ENV EMBEDDER_DTYPE=q8

# Default command runs full benchmark with ALL features enabled
ENTRYPOINT ["npx", "tsx", "packages/benchmark/src/cli/index.ts"]

# =============================================================================
# FULL ENGRAM BENCHMARK - ALL FEATURES ENABLED
# =============================================================================
# This command enables every Engram optimization for maximum retrieval quality:
#
# Retrieval:
#   - Dense embeddings (E5-large, 1024d) - SOTA multilingual
#   - Sparse embeddings (SPLADE)
#   - Hybrid search with RRF fusion
#   - Multi-query expansion (3 variations)
#   - Session-aware hierarchical retrieval
#   - Temporal query parsing (chrono-node)
#
# Reranking:
#   - Cross-encoder reranking (accurate tier)
#   - Deep candidate pool (50 docs)
#
# Reading:
#   - Chain-of-Note structured reasoning
#   - Time-aware query expansion
#
# Abstention (3-layer):
#   - Layer 1: Low retrieval confidence
#   - Layer 2: NLI answer grounding
#   - Layer 3: Hedging pattern detection
#
# Optimization:
#   - Key expansion with fact extraction
#   - Temporal analysis
#
# =============================================================================
CMD ["run", "longmemeval", \
     "--dataset", "/data/longmemeval_oracle.json", \
     "--variant", "oracle", \
     "--embeddings", "engram", \
     "--llm", "gemini", \
     "--gemini-model", "gemini-3-flash-preview", \
     "--top-k", "10", \
     "--hybrid-search", \
     "--rerank", \
     "--rerank-tier", "accurate", \
     "--rerank-depth", "50", \
     "--multi-query", \
     "--multi-query-variations", "3", \
     "--session-aware", \
     "--top-sessions", "5", \
     "--turns-per-session", "3", \
     "--temporal-aware", \
     "--temporal-confidence-threshold", "0.5", \
     "--abstention", \
     "--abstention-threshold", "0.3", \
     "--abstention-hedging", \
     "--abstention-nli", \
     "--abstention-nli-threshold", "0.7", \
     "--key-expansion", \
     "--temporal-analysis", \
     "--chain-of-note", \
     "--time-aware", \
     "--embedding-model", "e5-small", \
     "--verbose", \
     "--output", "/results/benchmark-results.jsonl"]
