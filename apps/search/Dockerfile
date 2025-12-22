# syntax=docker/dockerfile:1

# Production Dockerfile for Engram Search Service
FROM python:3.12-slim AS base

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock* README.md ./

# Install dependencies (without dev dependencies)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Copy source code
COPY src/ src/

# Install the project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Production stage - lightweight, uses HuggingFace Inference API
FROM python:3.12-slim

WORKDIR /app

# Copy virtual environment and source from builder
COPY --from=base /app/.venv /app/.venv
COPY --from=base /app/src /app/src

# Add venv to path
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"

# Run as non-root user
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 5002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/v1/health')" || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "5002"]
