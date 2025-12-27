# Tuner

Hyperparameter optimization service for Engram search using Optuna's ask/tell distributed optimization pattern.

## Purpose

FastAPI service providing distributed hyperparameter optimization with PostgreSQL persistence. Workers request trial parameters (ask), evaluate them asynchronously, and report results (tell). Supports single-objective and multi-objective optimization with TPE, Gaussian Process, NSGA-II samplers, and Hyperband/Median pruning.

## Key Features

- **Ask/Tell Pattern**: Distributed optimization with async parameter requests and result reporting
- **Multi-Objective**: Pareto-optimal solutions with NSGA-II sampler
- **Samplers**: TPE (default), Gaussian Process, Random, NSGA-II, Quasi-Monte Carlo
- **Pruning**: Hyperband and Median strategies for early stopping
- **Analysis**: fANOVA parameter importance and Pareto frontier analysis
- **PostgreSQL**: Durable storage with connection pooling
- **API Key Auth**: Optional authentication with scope-based access control

## Quick Start

```bash
# Install dependencies
cd apps/tuner && uv sync

# Start infrastructure (from project root)
bun run infra:up

# Run service (default: http://localhost:6177)
uv run tuner

# Run tests
uv run pytest --cov=src

# Lint and format
uv run ruff check src tests
uv run ruff format src tests
```

## Configuration

Set via environment variables or `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:6183/optuna` | PostgreSQL for Optuna storage |
| `AUTH_DATABASE_URL` | `postgresql://postgres:postgres@localhost:6183/engram` | PostgreSQL for API keys |
| `AUTH_ENABLED` | `true` | Enable API key authentication |
| `HOST` | `0.0.0.0` | Server bind host |
| `PORT` | `6177` | Server bind port |
| `DEFAULT_SAMPLER` | `tpe` | Default sampler (tpe, gp, random, nsgaii, qmc) |
| `DEFAULT_PRUNER` | `hyperband` | Default pruner (hyperband, median, none) |

## API Endpoints

All endpoints prefixed with `/v1/tuner`:

**Health**: `GET /health`, `GET /ready`

**Studies**: `GET /studies`, `POST /studies`, `GET /studies/{name}`, `DELETE /studies/{name}`

**Trials**: `POST /studies/{name}/trials/suggest`, `POST /studies/{name}/trials/{id}/complete`, `POST /studies/{name}/trials/{id}/prune`, `GET /studies/{name}/trials`

**Analysis**: `GET /studies/{name}/best`, `GET /studies/{name}/pareto`, `GET /studies/{name}/importance`

## Search Space Example

```json
{
  "name": "embedding_optimization",
  "direction": "maximize",
  "sampler": "tpe",
  "pruner": "hyperband",
  "search_space": [
    {"type": "float", "name": "alpha", "low": 0.0, "high": 1.0},
    {"type": "int", "name": "top_k", "low": 5, "high": 50, "step": 5},
    {"type": "categorical", "name": "reranker", "choices": ["fast", "accurate", "code"]}
  ]
}
```

## Integration

Works with `@engram/tuner` TypeScript package (`/packages/tuner`) for type-safe client access, search space builders, and trial execution orchestration.

## Optuna Dashboard

Visualize studies and trials:

```bash
uv run optuna-dashboard postgresql://postgres:postgres@localhost:6183/optuna
# Access at http://localhost:6184
```

## Architecture

Part of Engram monorepo. See `/CLAUDE.md` for full system architecture and development standards.
