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
RUN npm ci --include=dev

# Copy source code
COPY packages/ packages/
COPY tsconfig.json ./
COPY biome.json ./

# Build/typecheck to verify
RUN npm run typecheck

# -----------------------------------------------------------------------------
# Stage 2: Runtime image with CUDA support
# -----------------------------------------------------------------------------
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04

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
COPY --from=builder /app/tsconfig.json ./

# Create non-root user for security
RUN groupadd -r engram && useradd -r -g engram engram \
    && mkdir -p /data /results /cache \
    && chown -R engram:engram /app /data /results /cache

USER engram

# Environment configuration
ENV NODE_ENV=production
ENV BENCHMARK_VERBOSE=true

# GPU/CUDA detection - auto-selects fp16 on GPU, fp32 on CPU
ENV EMBEDDER_DTYPE=fp16
# Will be set by Cloud Run when GPU is attached
# ENV NVIDIA_VISIBLE_DEVICES=all

# Model cache directory
ENV HF_HOME=/cache
ENV TRANSFORMERS_CACHE=/cache

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
     "--gemini-model", "gemini-3-flash", \
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
     "--embedding-model", "e5-large", \
     "--verbose", \
     "--output", "/results/benchmark-results.jsonl"]
