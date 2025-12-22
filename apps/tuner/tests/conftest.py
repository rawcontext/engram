"""Test fixtures for tuner tests."""

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tuner.api.health import router as health_router


@pytest.fixture
def mock_storage() -> MagicMock:
    """Create a mock Optuna storage."""
    storage = MagicMock()
    storage.get_all_studies.return_value = []
    return storage


@pytest.fixture
def app(mock_storage: MagicMock) -> FastAPI:
    """Create a test FastAPI app with health router."""
    app = FastAPI()
    app.include_router(health_router)
    app.state.storage = mock_storage
    return app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def sample_float_param() -> dict[str, Any]:
    """Sample float parameter definition."""
    return {
        "type": "float",
        "name": "learning_rate",
        "low": 1e-5,
        "high": 1e-1,
        "log": True,
    }


@pytest.fixture
def sample_int_param() -> dict[str, Any]:
    """Sample int parameter definition."""
    return {
        "type": "int",
        "name": "batch_size",
        "low": 16,
        "high": 256,
        "step": 16,
    }


@pytest.fixture
def sample_categorical_param() -> dict[str, Any]:
    """Sample categorical parameter definition."""
    return {
        "type": "categorical",
        "name": "optimizer",
        "choices": ["adam", "sgd", "adamw"],
    }


@pytest.fixture
def sample_search_space(
    sample_float_param: dict[str, Any],
    sample_int_param: dict[str, Any],
    sample_categorical_param: dict[str, Any],
) -> list[dict[str, Any]]:
    """Sample search space with multiple parameter types."""
    return [sample_float_param, sample_int_param, sample_categorical_param]
