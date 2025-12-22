# syntax=docker/dockerfile:1

# Production Dockerfile for Engram Tuner Service
FROM python:3.13-slim AS base

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock README.md ./

# Install dependencies (without dev dependencies)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Copy source code
COPY src/ src/

# Install the project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Production stage
FROM python:3.13-slim

WORKDIR /app

# Run as non-root user
RUN useradd --create-home --shell /bin/bash appuser

# Copy virtual environment and source from builder with proper ownership
COPY --from=base --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=base --chown=appuser:appuser /app/src /app/src

# Add venv to path
ENV PATH="/app/.venv/bin:$PATH"

USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/v1/health')" || exit 1

CMD ["uvicorn", "tuner.main:app", "--host", "0.0.0.0", "--port", "8000"]
