# Tuner Service

Hyperparameter optimization service for Engram search using Optuna's ask/tell distributed optimization pattern.

## Overview

The Tuner Service is a FastAPI-based REST API that provides distributed hyperparameter optimization using Optuna with PostgreSQL persistence. It implements Optuna's ask/tell pattern for distributed optimization, allowing multiple workers to request trial parameters, evaluate them asynchronously, and report results back. Supports both single-objective and multi-objective optimization with multiple samplers, pruners, and analysis tools.

## Key Features

- **Ask/Tell Pattern**: Distributed optimization where workers request parameters and report results asynchronously
- **Multi-Objective Optimization**: Support for Pareto-optimal solutions with NSGA-II sampler
- **Multiple Samplers**: TPE (Tree-structured Parzen Estimator), Gaussian Process, Random, NSGA-II, Quasi-Monte Carlo
- **Pruning Strategies**: Hyperband and Median pruning for early stopping of unpromising trials
- **Parameter Importance**: fANOVA and Mean Decrease Impurity analysis
- **PostgreSQL Persistence**: Durable storage with connection pooling for distributed workers
- **Pareto Analysis**: Multi-objective study frontier analysis
- **Health Monitoring**: Health and readiness endpoints for Kubernetes deployments

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with storage connectivity status |
| `/ready` | GET | Kubernetes readiness probe |

### Studies

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/studies` | GET | List all optimization studies |
| `/studies` | POST | Create new study with search space definition |
| `/studies/{study_name}` | GET | Get study details including best trial |
| `/studies/{study_name}` | DELETE | Delete a study |

### Trials (Ask/Tell Pattern)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/studies/{study_name}/trials/suggest` | POST | Get next trial parameters (ask) |
| `/studies/{study_name}/trials/{trial_id}/complete` | POST | Complete trial with results (tell) |
| `/studies/{study_name}/trials/{trial_id}/prune` | POST | Mark trial as pruned (early stopped) |
| `/studies/{study_name}/trials` | GET | List trials with filtering and pagination |

### Analysis

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/studies/{study_name}/best` | GET | Get best parameters (first Pareto-optimal for multi-objective) |
| `/studies/{study_name}/pareto` | GET | Get Pareto frontier for multi-objective studies |
| `/studies/{study_name}/importance` | GET | Calculate parameter importance using fANOVA |

## Running the Service

### Local Development

```bash
# Install dependencies
cd apps/tuner
uv sync

# Run with auto-reload
uv run uvicorn tuner.main:app --reload

# Or using the project script
uv run tuner
```

The service will start on `http://localhost:8000` by default.

### Production

```bash
# Install production dependencies only
uv sync --no-dev

# Run with uvicorn
uv run uvicorn tuner.main:app --host 0.0.0.0 --port 8000
```

### Docker

```bash
# Build production image
docker build -t engram-tuner -f Dockerfile .

# Run container
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/optuna \
  engram-tuner
```

## Configuration

Configuration is managed via environment variables or `.env` file.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | PostgresDsn | `postgresql://postgres:postgres@localhost:5432/optuna` | PostgreSQL connection string |
| `HOST` | str | `0.0.0.0` | Server bind host |
| `PORT` | int | `8000` | Server bind port |
| `DEBUG` | bool | `false` | Enable debug mode and auto-reload |
| `CORS_ORIGINS` | list[str] | `["http://localhost:3000", "http://localhost:8080"]` | Allowed CORS origins (comma-separated or JSON array) |
| `DEFAULT_SAMPLER` | str | `tpe` | Default sampler type for new studies |
| `DEFAULT_PRUNER` | str | `hyperband` | Default pruner type for new studies |

## Search Space Definition

Studies are created with a search space that defines the parameters to optimize:

**Float Parameters:**
```json
{
  "type": "float",
  "name": "learning_rate",
  "low": 0.0001,
  "high": 0.1,
  "log": true
}
```

**Integer Parameters:**
```json
{
  "type": "int",
  "name": "batch_size",
  "low": 16,
  "high": 128,
  "step": 16
}
```

**Categorical Parameters:**
```json
{
  "type": "categorical",
  "name": "optimizer",
  "choices": ["adam", "sgd", "rmsprop"]
}
```

## Samplers

| Sampler | Description | Use Case |
|---------|-------------|----------|
| `tpe` | Tree-structured Parzen Estimator | General-purpose Bayesian optimization (default) |
| `gp` | Gaussian Process | Smooth continuous optimization spaces |
| `random` | Random sampling | Baseline comparison |
| `nsgaii` | NSGA-II genetic algorithm | Multi-objective optimization |
| `qmc` | Quasi-Monte Carlo | Deterministic low-discrepancy sampling |

## Pruners

| Pruner | Description | Use Case |
|--------|-------------|----------|
| `hyperband` | Successive halving with multiple brackets | Fast convergence with early stopping |
| `median` | Median-based pruning | Simple statistical pruning |
| `none` | No pruning | Full evaluation of all trials |

## Dependencies

Core dependencies:

- **fastapi** (>=0.126.0) - Modern async web framework
- **uvicorn[standard]** (>=0.38.0) - ASGI server with performance extras
- **optuna** (>=4.6.0) - Bayesian optimization framework
- **optuna-dashboard** (>=0.20.0) - Web-based visualization dashboard
- **psycopg[binary]** (>=3.3.2) - PostgreSQL adapter with binary protocol
- **pydantic** (>=2.12.5) - Data validation with type hints
- **pydantic-settings** (>=2.12.0) - Settings management from environment

Development dependencies:

- **pytest** (>=9.0.2) - Testing framework
- **pytest-asyncio** (>=1.3.0) - Async test support
- **httpx** (>=0.28.1) - HTTP client for testing
- **ruff** (>=0.14.10) - Fast Python linter and formatter

## Testing

```bash
# Run all tests
cd apps/tuner
uv run pytest

# Run with coverage
uv run pytest --cov=tuner --cov-report=term-missing

# Run specific test file
uv run pytest tests/test_health.py

# Watch mode
uv run pytest --watch
```

## Code Quality

```bash
# Lint and check
uv run ruff check src tests

# Format code
uv run ruff format src tests

# Type checking (via pyright or mypy if configured)
uv run pyright src
```

## Integration

The Tuner Service is designed to work with the `@engram/tuner` TypeScript package, which provides:
- Type-safe client for API calls
- Search space builders for Engram-specific parameters
- Convenience methods for ask/tell optimization loops
- Trial execution orchestration

See `/packages/tuner` for the TypeScript client implementation.

## Optuna Dashboard

For interactive visualization of studies and trials, use the Optuna Dashboard:

```bash
# Install dashboard (included in dependencies)
uv run optuna-dashboard postgresql://postgres:postgres@localhost:5432/optuna
```

Access the dashboard at `http://localhost:8080` to view:
- Optimization history plots
- Parameter importance
- Hyperparameter relationships
- Pareto frontiers (multi-objective)
- Trial details and intermediate values
