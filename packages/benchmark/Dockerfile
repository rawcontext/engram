# Engram Benchmark Runner
#
# GPU-enabled container for running LongMemEval benchmarks with SOTA models.
# Uses NVIDIA CUDA runtime for GPU-accelerated embedding inference.
#
# Build:
#   docker build -t gcr.io/PROJECT/engram-benchmark:latest .
#
# Run locally (with GPU):
#   docker run --gpus all -e GEMINI_API_KEY=xxx engram-benchmark
#
# @see https://cloud.google.com/run/docs/configuring/services/gpu-best-practices

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:24-slim AS builder

WORKDIR /app

# Copy workspace configuration
COPY package*.json ./
COPY turbo.json ./
COPY packages/tsconfig ./packages/tsconfig/
COPY packages/benchmark/package*.json ./packages/benchmark/

# Copy all required packages for build
COPY packages/common ./packages/common/
COPY packages/logger ./packages/logger/
COPY packages/storage ./packages/storage/
COPY packages/memory-core ./packages/memory-core/
COPY packages/search-core ./packages/search-core/
COPY packages/benchmark ./packages/benchmark/

# Install dependencies
RUN npm ci --ignore-scripts

# Build TypeScript (if needed)
RUN npm run build --workspace=@engram/benchmark || true

# =============================================================================
# Stage 2: Runtime
# =============================================================================
# Use NVIDIA CUDA base image for GPU support
# Cloud Run provides L4 GPUs with CUDA 12.2 drivers
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04 AS runtime

# Install Node.js 24
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r engram && useradd -r -g engram engram

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package*.json ./

# Set ownership
RUN chown -R engram:engram /app

# Switch to non-root user
USER engram

# Environment defaults
ENV NODE_ENV=production
ENV BENCHMARK_VERBOSE=true

# Default command runs the benchmark CLI
# Override with: --llm gemini --embeddings engram --dataset /data/dataset.jsonl
ENTRYPOINT ["npx", "tsx", "packages/benchmark/src/cli/index.ts"]

# Default arguments (can be overridden)
CMD ["run", "longmemeval", \
     "--dataset", "/data/longmemeval-s.jsonl", \
     "--llm", "gemini", \
     "--embeddings", "engram", \
     "--output", "/results/benchmark-results.jsonl", \
     "--verbose"]
