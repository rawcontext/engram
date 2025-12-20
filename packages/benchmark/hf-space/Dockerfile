# =============================================================================
# Engram Benchmark - Hugging Face Spaces
# =============================================================================
# GPU-enabled container for running LongMemEval benchmarks with L4 GPU.
# Designed for Hugging Face Spaces Docker deployment.
#
# Usage:
#   1. Push this to HF Spaces (engram/benchmark)
#   2. Select L4 GPU hardware ($0.80/hr)
#   3. Access web UI to trigger benchmark runs
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build dependencies
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build essentials for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy monorepo package files
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

# -----------------------------------------------------------------------------
# Stage 2: Runtime image with CUDA support
# -----------------------------------------------------------------------------
FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04

# Install Node.js 22 LTS and system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    wget \
    jq \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package*.json ./

# Reinstall native modules for linux-x64 platform with CUDA support
RUN npm install --os=linux --cpu=x64 sharp \
    && npm install --os=linux --cpu=x64 onnxruntime-node

# Model cache directory
ENV HF_HOME=/app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache
ENV XDG_CACHE_HOME=/app/.cache

# Create cache directory for models (downloaded on first run)
RUN mkdir -p /app/.cache

# Install Qdrant for local vector search
RUN wget -q https://github.com/qdrant/qdrant/releases/download/v1.16.2/qdrant-x86_64-unknown-linux-gnu.tar.gz \
    && tar xzf qdrant-x86_64-unknown-linux-gnu.tar.gz -C /usr/local/bin \
    && rm qdrant-x86_64-unknown-linux-gnu.tar.gz \
    && mkdir -p /app/qdrant-storage

# Install Redis 7.4+ for FalkorDB (Ubuntu 22.04 has old Redis, install from source)
RUN apt-get update && apt-get install -y \
    libgomp1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/falkordb-data \
    && wget -q https://github.com/redis/redis/archive/refs/tags/7.4.2.tar.gz \
    && tar xzf 7.4.2.tar.gz \
    && cd redis-7.4.2 && make -j$(nproc) && make install \
    && cd .. && rm -rf redis-7.4.2 7.4.2.tar.gz

# Download FalkorDB module (v4.14.10 - latest)
RUN mkdir -p /opt/falkordb \
    && wget -q https://github.com/FalkorDB/FalkorDB/releases/download/v4.14.10/falkordb-x64.so -O /opt/falkordb/falkordb.so \
    && chmod +x /opt/falkordb/falkordb.so

# Copy HF Space runner script
COPY packages/benchmark/hf-space/run.sh /app/run.sh
RUN chmod +x /app/run.sh

# Create directories for data and results
RUN mkdir -p /data /results

# Environment configuration
ENV NODE_ENV=production
ENV BENCHMARK_VERBOSE=true
ENV NODE_OPTIONS="--max-old-space-size=24576"

# GPU mode (onnxruntime-node auto-detects CUDA)
# Using fp32 for compatibility - fp16 models can have issues
ENV EMBEDDER_DEVICE=cuda
ENV EMBEDDER_DTYPE=fp32
ENV QDRANT_URL=http://localhost:6333
ENV FALKORDB_URL=redis://localhost:6379

# HF Spaces requires port 7860
EXPOSE 7860

# Run the benchmark server
CMD ["/app/run.sh"]
