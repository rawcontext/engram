# Tuner Service

Hyperparameter optimization for search relevance tuning.

## Overview

The Tuner Service is a FastAPI-based REST API that uses Optuna for Bayesian optimization of search model parameters. It enables automated hyperparameter tuning with visualization support.

## Features

- Bayesian optimization via Optuna
- Optuna Dashboard for visualization
- PostgreSQL persistence for studies
- Configurable samplers and pruners
- CI/CD integration support

## Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/studies` | GET | List optimization studies |
| `/studies` | POST | Create new study |
| `/studies/{id}/trials` | POST | Run optimization trials |
| `/health` | GET | Health check |

**Port:** 8000

## Dependencies

- `fastapi`, `uvicorn` - Async web framework
- `optuna`, `optuna-dashboard` - Bayesian optimization
- `psycopg` - PostgreSQL driver
- `pydantic`, `pydantic-settings` - Validation and config

## Development

```bash
# From this directory
uv run uvicorn main:app --reload

# Or with the provided script
./run.sh
```

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `HOST` | Server host | `0.0.0.0` |
| `PORT` | Server port | `8000` |
| `CORS_ORIGINS` | Allowed CORS origins | `localhost:3000,8080` |
| `DEFAULT_SAMPLER` | Optuna sampler | `tpe` |
| `DEFAULT_PRUNER` | Optuna pruner | `hyperband` |

## Optuna Dashboard

Access the Optuna Dashboard for visualization:

```bash
optuna-dashboard postgresql://user:pass@localhost/optuna
```

## Integration

The Tuner Service works with the `@engram/tuner` package, which provides:
- `TunerClient` for API calls
- Search space builders for Engram parameters
- Trial execution and metric computation
