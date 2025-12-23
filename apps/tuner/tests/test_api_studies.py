"""Tests for studies.py - Study management endpoints."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import optuna
import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from tuner.api.studies import _get_storage, router
from tuner.middleware.auth import ApiKeyContext


@pytest.fixture
def app_with_storage() -> FastAPI:
    """Create test FastAPI app with studies router."""
    app = FastAPI()
    app.include_router(router, prefix="/v1/studies")
    app.state.storage = MagicMock()
    return app


@pytest.fixture
def client_with_auth(app_with_storage: FastAPI, mock_api_key_context: ApiKeyContext) -> TestClient:
    """Create test client with mocked auth."""
    # Override the dependency callable inside tuner_auth.dependency
    async def mock_dependency():
        return mock_api_key_context

    from tuner.api.studies import tuner_auth

    # Override the actual callable that Depends wraps
    app_with_storage.dependency_overrides[tuner_auth.dependency] = mock_dependency
    yield TestClient(app_with_storage)
    app_with_storage.dependency_overrides.clear()


class TestGetStorage:
    """Tests for _get_storage helper."""

    def test_returns_storage_when_available(self) -> None:
        """Test that _get_storage returns storage from app state."""
        request = MagicMock()
        mock_storage = MagicMock()
        request.app.state.storage = mock_storage

        result = _get_storage(request)
        assert result == mock_storage

    def test_raises_503_when_storage_missing(self) -> None:
        """Test that _get_storage raises 503 when storage not initialized."""
        request = MagicMock()
        request.app.state.storage = None

        with pytest.raises(Exception) as exc_info:
            _get_storage(request)

        assert exc_info.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


class TestCreateStudy:
    """Tests for POST /studies endpoint."""

    @pytest.mark.asyncio
    async def test_creates_study_successfully(self, client_with_auth: TestClient) -> None:
        """Test creating a new study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "test-study"
        mock_study.trials = []
        mock_study.user_attrs = {}

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch("tuner.api.studies.create_sampler") as mock_sampler:
                with patch("tuner.api.studies.create_pruner") as mock_pruner:
                    with patch(
                        "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
                    ) as mock_thread:
                        mock_thread.side_effect = [mock_study, None, None, None, 123]

                        response = client_with_auth.post(
                            "/v1/studies",
                            json={
                                "name": "test-study",
                                "direction": "maximize",
                                "search_space": [
                                    {
                                        "type": "float",
                                        "name": "lr",
                                        "low": 0.001,
                                        "high": 0.1,
                                    }
                                ],
                                "sampler": "tpe",
                                "pruner": "hyperband",
                            },
                        )

        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["study_name"] == "test-study"
        assert data["study_id"] == 123

    @pytest.mark.asyncio
    async def test_creates_multi_objective_study(
        self, client_with_auth: TestClient
    ) -> None:
        """Test creating a multi-objective study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "multi-obj-study"
        mock_study.trials = []
        mock_study.user_attrs = {}

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch("tuner.api.studies.create_sampler"):
                with patch("tuner.api.studies.create_pruner"):
                    with patch(
                        "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
                    ) as mock_thread:
                        mock_thread.side_effect = [mock_study, None, None, None, 456]

                        response = client_with_auth.post(
                            "/v1/studies",
                            json={
                                "name": "multi-obj-study",
                                "direction": ["maximize", "minimize"],
                                "search_space": [
                                    {
                                        "type": "float",
                                        "name": "lr",
                                        "low": 0.001,
                                        "high": 0.1,
                                    }
                                ],
                                "sampler": "nsgaii",
                                "pruner": "none",
                            },
                        )

        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()
        assert data["direction"] == ["maximize", "minimize"]

    @pytest.mark.asyncio
    async def test_creates_study_with_load_if_exists(
        self, client_with_auth: TestClient
    ) -> None:
        """Test creating a study with load_if_exists=True."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "existing-study"
        mock_study.trials = []
        mock_study.user_attrs = {}

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch("tuner.api.studies.create_sampler"):
                with patch("tuner.api.studies.create_pruner"):
                    with patch(
                        "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
                    ) as mock_thread:
                        mock_thread.side_effect = [mock_study, None, None, None, 789]

                        response = client_with_auth.post(
                            "/v1/studies",
                            json={
                                "name": "existing-study",
                                "direction": "maximize",
                                "search_space": [
                                    {
                                        "type": "int",
                                        "name": "batch_size",
                                        "low": 16,
                                        "high": 128,
                                    }
                                ],
                                "load_if_exists": True,
                            },
                        )

        assert response.status_code == status.HTTP_201_CREATED

    @pytest.mark.asyncio
    async def test_fails_with_duplicate_study(self, client_with_auth: TestClient) -> None:
        """Test that creating a duplicate study fails."""
        mock_storage = MagicMock()

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch("tuner.api.studies.create_sampler"):
                with patch("tuner.api.studies.create_pruner"):
                    with patch(
                        "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
                    ) as mock_thread:
                        mock_thread.side_effect = optuna.exceptions.DuplicatedStudyError(
                            "duplicate"
                        )

                        response = client_with_auth.post(
                            "/v1/studies",
                            json={
                                "name": "duplicate-study",
                                "direction": "maximize",
                                "search_space": [
                                    {"type": "float", "name": "lr", "low": 0.001, "high": 0.1}
                                ],
                                "load_if_exists": False,
                            },
                        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_validates_study_request(self, client_with_auth: TestClient) -> None:
        """Test that study creation validates request data."""
        response = client_with_auth.post(
            "/v1/studies",
            json={
                "name": "",  # Invalid: empty name
                "direction": "maximize",
                "search_space": [],
            },
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


class TestListStudies:
    """Tests for GET /studies endpoint."""

    @pytest.mark.asyncio
    async def test_lists_all_studies(self, client_with_auth: TestClient) -> None:
        """Test listing all studies."""
        mock_storage = MagicMock()

        # Create mock study summaries
        summary1 = MagicMock()
        summary1.study_name = "study-1"
        summary1.directions = [optuna.study.StudyDirection.MAXIMIZE]
        summary1.n_trials = 10
        summary1.datetime_start = datetime.now(UTC)

        summary2 = MagicMock()
        summary2.study_name = "study-2"
        summary2.directions = [optuna.study.StudyDirection.MINIMIZE]
        summary2.n_trials = 5
        summary2.datetime_start = datetime.now(UTC)

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [
                    [summary1, summary2],
                    1,
                    2,
                ]

                response = client_with_auth.get("/v1/studies")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 2
        assert data[0]["study_name"] == "study-1"
        assert data[1]["study_name"] == "study-2"

    @pytest.mark.asyncio
    async def test_lists_empty_studies(self, client_with_auth: TestClient) -> None:
        """Test listing when no studies exist."""
        mock_storage = MagicMock()

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.return_value = []

                response = client_with_auth.get("/v1/studies")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data == []

    @pytest.mark.asyncio
    async def test_lists_multi_objective_studies(
        self, client_with_auth: TestClient
    ) -> None:
        """Test listing multi-objective studies."""
        mock_storage = MagicMock()

        summary = MagicMock()
        summary.study_name = "multi-obj"
        summary.directions = [
            optuna.study.StudyDirection.MAXIMIZE,
            optuna.study.StudyDirection.MINIMIZE,
        ]
        summary.n_trials = 20
        summary.datetime_start = datetime.now(UTC)

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [[summary], 1]

                response = client_with_auth.get("/v1/studies")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 1
        assert data[0]["direction"] == ["maximize", "minimize"]


class TestGetStudy:
    """Tests for GET /studies/{study_name} endpoint."""

    @pytest.mark.asyncio
    async def test_gets_study_successfully(self, client_with_auth: TestClient) -> None:
        """Test getting a study by name."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "test-study"
        mock_study.directions = [optuna.study.StudyDirection.MAXIMIZE]
        mock_study.trials = []
        mock_study.user_attrs = {}
        mock_study._is_multi_objective.return_value = False

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [mock_study, 123]

                response = client_with_auth.get("/v1/studies/test-study")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["study_name"] == "test-study"
        assert data["study_id"] == 123

    @pytest.mark.asyncio
    async def test_gets_study_with_best_trial(self, client_with_auth: TestClient) -> None:
        """Test getting a study with best trial information."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "test-study"
        mock_study.directions = [optuna.study.StudyDirection.MAXIMIZE]
        mock_study._is_multi_objective.return_value = False

        mock_trial = MagicMock()
        mock_trial.value = 0.95
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)

        mock_study.trials = [mock_trial]
        mock_study.best_trial = mock_trial
        mock_study.user_attrs = {}

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [mock_study, 123]

                response = client_with_auth.get("/v1/studies/test-study")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["best_value"] == 0.95
        assert data["best_params"]["lr"] == 0.01

    @pytest.mark.asyncio
    async def test_gets_multi_objective_study_with_best_trials(
        self, client_with_auth: TestClient
    ) -> None:
        """Test getting a multi-objective study with Pareto-optimal trials."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "multi-obj-study"
        mock_study.directions = [
            optuna.study.StudyDirection.MAXIMIZE,
            optuna.study.StudyDirection.MINIMIZE,
        ]
        mock_study._is_multi_objective.return_value = True

        mock_trial = MagicMock()
        mock_trial.values = [0.95, 0.10]
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)

        mock_study.trials = [mock_trial]
        mock_study.best_trial = mock_trial
        mock_study.user_attrs = {}

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [mock_study, 456]

                response = client_with_auth.get("/v1/studies/multi-obj-study")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["best_value"] == [0.95, 0.10]

    @pytest.mark.asyncio
    async def test_gets_study_without_completed_trials(
        self, client_with_auth: TestClient
    ) -> None:
        """Test getting a study with no completed trials."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.study_name = "new-study"
        mock_study.directions = [optuna.study.StudyDirection.MAXIMIZE]
        mock_study.trials = []
        mock_study.user_attrs = {}
        mock_study._is_multi_objective.return_value = False

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [mock_study, 789]

                response = client_with_auth.get("/v1/studies/new-study")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["best_value"] is None
        assert data["best_params"] is None

    @pytest.mark.asyncio
    async def test_fails_with_nonexistent_study(self, client_with_auth: TestClient) -> None:
        """Test that getting a nonexistent study fails."""
        mock_storage = MagicMock()

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = KeyError("not found")

                response = client_with_auth.get("/v1/studies/nonexistent")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "not found" in response.json()["detail"].lower()


class TestDeleteStudy:
    """Tests for DELETE /studies/{study_name} endpoint."""

    @pytest.mark.asyncio
    async def test_deletes_study_successfully(self, client_with_auth: TestClient) -> None:
        """Test deleting a study."""
        mock_storage = MagicMock()

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = [123, None]

                response = client_with_auth.delete("/v1/studies/test-study")

        assert response.status_code == status.HTTP_204_NO_CONTENT

    @pytest.mark.asyncio
    async def test_fails_with_nonexistent_study(self, client_with_auth: TestClient) -> None:
        """Test that deleting a nonexistent study fails."""
        mock_storage = MagicMock()

        with patch("tuner.api.studies._get_storage", return_value=mock_storage):
            with patch(
                "tuner.api.studies.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_thread:
                mock_thread.side_effect = KeyError("not found")

                response = client_with_auth.delete("/v1/studies/nonexistent")

        assert response.status_code == status.HTTP_404_NOT_FOUND
