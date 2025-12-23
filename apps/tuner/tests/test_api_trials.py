"""Tests for trials.py - Trial management endpoints."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import optuna
import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from tuner.api.trials import _get_storage, _load_study, _suggest_value, router
from tuner.middleware.auth import ApiKeyContext
from tuner.models import TrialState


@pytest.fixture
def app_with_storage() -> FastAPI:
    """Create test FastAPI app with trials router."""
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

    from tuner.api.trials import tuner_auth

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
        assert "Storage not initialized" in exc_info.value.detail


class TestLoadStudy:
    """Tests for _load_study helper."""

    @pytest.mark.asyncio
    async def test_loads_study_successfully(self) -> None:
        """Test that _load_study loads a study by name."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        with patch("tuner.api.trials.optuna.load_study", return_value=mock_study) as mock_load:
            with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
                mock_thread.return_value = mock_study

                result = await _load_study(mock_storage, "test-study")

                assert result == mock_study
                mock_thread.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_404_when_study_not_found(self) -> None:
        """Test that _load_study raises 404 when study doesn't exist."""
        mock_storage = MagicMock()

        with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
            mock_thread.side_effect = KeyError("Study not found")

            with pytest.raises(Exception) as exc_info:
                await _load_study(mock_storage, "nonexistent")

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
            assert "not found" in exc_info.value.detail


class TestSuggestValue:
    """Tests for _suggest_value helper."""

    def test_suggests_float_value(self) -> None:
        """Test suggesting a float parameter."""
        trial = MagicMock()
        trial.suggest_float.return_value = 0.001

        param = {
            "name": "learning_rate",
            "type": "float",
            "low": 0.0001,
            "high": 0.1,
            "log": True,
        }

        result = _suggest_value(trial, param)

        trial.suggest_float.assert_called_once_with(
            "learning_rate",
            0.0001,
            0.1,
            step=None,
            log=True,
        )
        assert result == 0.001

    def test_suggests_int_value(self) -> None:
        """Test suggesting an int parameter."""
        trial = MagicMock()
        trial.suggest_int.return_value = 64

        param = {
            "name": "batch_size",
            "type": "int",
            "low": 16,
            "high": 256,
            "step": 16,
        }

        result = _suggest_value(trial, param)

        trial.suggest_int.assert_called_once_with(
            "batch_size",
            16,
            256,
            step=16,
            log=False,
        )
        assert result == 64

    def test_suggests_categorical_value(self) -> None:
        """Test suggesting a categorical parameter."""
        trial = MagicMock()
        trial.suggest_categorical.return_value = "adam"

        param = {
            "name": "optimizer",
            "type": "categorical",
            "choices": ["adam", "sgd", "adamw"],
        }

        result = _suggest_value(trial, param)

        trial.suggest_categorical.assert_called_once_with(
            "optimizer", ["adam", "sgd", "adamw"]
        )
        assert result == "adam"

    def test_raises_on_unknown_type(self) -> None:
        """Test that unknown parameter type raises ValueError."""
        trial = MagicMock()
        param = {
            "name": "unknown",
            "type": "invalid",
        }

        with pytest.raises(ValueError, match="Unknown parameter type"):
            _suggest_value(trial, param)


class TestSuggestTrial:
    """Tests for POST /{study_name}/trials/suggest endpoint."""

    @pytest.mark.asyncio
    async def test_suggests_trial_successfully(self, client_with_auth: TestClient) -> None:
        """Test successful trial suggestion."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0

        mock_study.user_attrs = {
            "search_space": [
                {"type": "float", "name": "lr", "low": 0.001, "high": 0.1, "log": False}
            ]
        }

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
                    mock_thread.return_value = mock_trial

                    with patch("tuner.api.trials._suggest_value", return_value=0.05):
                        response = client_with_auth.post(
                            "/v1/studies/test-study/trials/suggest"
                        )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["trial_id"] == 0
        assert data["study_name"] == "test-study"
        assert "params" in data

    @pytest.mark.asyncio
    async def test_fails_without_search_space(self, client_with_auth: TestClient) -> None:
        """Test that suggesting trial fails without search space."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.user_attrs = {}

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock):
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/suggest"
                    )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "search space" in response.json()["detail"].lower()


class TestCompleteTrial:
    """Tests for POST /{study_name}/trials/{trial_id}/complete endpoint."""

    @pytest.mark.asyncio
    async def test_completes_trial_with_single_value(
        self, client_with_auth: TestClient
    ) -> None:
        """Test completing a trial with a single objective value."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0
        mock_trial.state = optuna.trial.TrialState.COMPLETE
        mock_trial.values = [0.95]
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)
        mock_trial.datetime_complete = datetime.now(UTC)
        mock_trial.user_attrs = {}

        mock_study.trials = [mock_trial]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock):
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/0/complete",
                        json={"values": 0.95},
                    )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["trial_id"] == 0
        assert data["state"] == "COMPLETE"

    @pytest.mark.asyncio
    async def test_completes_trial_with_multiple_values(
        self, client_with_auth: TestClient
    ) -> None:
        """Test completing a trial with multiple objective values."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0
        mock_trial.state = optuna.trial.TrialState.COMPLETE
        mock_trial.values = [0.95, 0.90]
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)
        mock_trial.datetime_complete = datetime.now(UTC)
        mock_trial.user_attrs = {}

        mock_study.trials = [mock_trial]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock):
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/0/complete",
                        json={"values": [0.95, 0.90]},
                    )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["values"] == [0.95, 0.90]

    @pytest.mark.asyncio
    async def test_completes_trial_with_intermediate_values(
        self, client_with_auth: TestClient
    ) -> None:
        """Test completing a trial with intermediate values for pruning."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0
        mock_trial.state = optuna.trial.TrialState.COMPLETE
        mock_trial.values = [0.95]
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)
        mock_trial.datetime_complete = datetime.now(UTC)
        mock_trial.user_attrs = {}
        mock_trial.report = MagicMock()

        mock_study.trials = [mock_trial]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/0/complete",
                        json={
                            "values": 0.95,
                            "intermediate_values": {0: 0.5, 1: 0.7, 2: 0.9},
                        },
                    )

        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.asyncio
    async def test_completes_trial_with_user_attrs(
        self, client_with_auth: TestClient
    ) -> None:
        """Test completing a trial with custom user attributes."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0
        mock_trial.state = optuna.trial.TrialState.COMPLETE
        mock_trial.values = [0.95]
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)
        mock_trial.datetime_complete = datetime.now(UTC)
        mock_trial.user_attrs = {"recall": 0.92, "precision": 0.98}

        mock_study.trials = [mock_trial]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock):
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/0/complete",
                        json={
                            "values": 0.95,
                            "user_attrs": {"recall": 0.92, "precision": 0.98},
                        },
                    )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["user_attrs"]["recall"] == 0.92

    @pytest.mark.asyncio
    async def test_fails_with_invalid_trial_id(self, client_with_auth: TestClient) -> None:
        """Test that completing a trial with invalid ID fails."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.trials = []

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                response = client_with_auth.post(
                    "/v1/studies/test-study/trials/999/complete",
                    json={"values": 0.95},
                )

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestPruneTrial:
    """Tests for POST /{study_name}/trials/{trial_id}/prune endpoint."""

    @pytest.mark.asyncio
    async def test_prunes_trial_successfully(self, client_with_auth: TestClient) -> None:
        """Test successfully pruning a trial."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_trial = MagicMock()
        mock_trial.number = 0
        mock_trial.state = optuna.trial.TrialState.PRUNED
        mock_trial.values = None
        mock_trial.params = {"lr": 0.01}
        mock_trial.datetime_start = datetime.now(UTC)
        mock_trial.datetime_complete = datetime.now(UTC)
        mock_trial.user_attrs = {}

        mock_study.trials = [mock_trial]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                with patch("tuner.api.trials.asyncio.to_thread", new_callable=AsyncMock):
                    response = client_with_auth.post(
                        "/v1/studies/test-study/trials/0/prune"
                    )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["state"] == "PRUNED"
        assert data["values"] is None

    @pytest.mark.asyncio
    async def test_fails_with_invalid_trial_id(self, client_with_auth: TestClient) -> None:
        """Test that pruning a trial with invalid ID fails."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.trials = []

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                response = client_with_auth.post("/v1/studies/test-study/trials/999/prune")

        assert response.status_code == status.HTTP_404_NOT_FOUND


class TestListTrials:
    """Tests for GET /{study_name}/trials endpoint."""

    @pytest.mark.asyncio
    async def test_lists_all_trials(self, client_with_auth: TestClient) -> None:
        """Test listing all trials."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        mock_trial1 = MagicMock()
        mock_trial1.number = 0
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial1.values = [0.95]
        mock_trial1.params = {"lr": 0.01}
        mock_trial1.datetime_start = datetime.now(UTC)
        mock_trial1.datetime_complete = datetime.now(UTC)
        mock_trial1.user_attrs = {}

        mock_trial2 = MagicMock()
        mock_trial2.number = 1
        mock_trial2.state = optuna.trial.TrialState.RUNNING
        mock_trial2.values = None
        mock_trial2.params = {"lr": 0.001}
        mock_trial2.datetime_start = datetime.now(UTC)
        mock_trial2.datetime_complete = None
        mock_trial2.user_attrs = {}

        mock_study.trials = [mock_trial1, mock_trial2]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/test-study/trials")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 2
        assert data[0]["trial_id"] == 0
        assert data[1]["trial_id"] == 1

    @pytest.mark.asyncio
    async def test_filters_trials_by_state(self, client_with_auth: TestClient) -> None:
        """Test filtering trials by state."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        mock_trial1 = MagicMock()
        mock_trial1.number = 0
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial1.values = [0.95]
        mock_trial1.params = {"lr": 0.01}
        mock_trial1.datetime_start = datetime.now(UTC)
        mock_trial1.datetime_complete = datetime.now(UTC)
        mock_trial1.user_attrs = {}

        mock_trial2 = MagicMock()
        mock_trial2.number = 1
        mock_trial2.state = optuna.trial.TrialState.RUNNING
        mock_trial2.values = None
        mock_trial2.params = {"lr": 0.001}
        mock_trial2.datetime_start = datetime.now(UTC)
        mock_trial2.datetime_complete = None
        mock_trial2.user_attrs = {}

        mock_study.trials = [mock_trial1, mock_trial2]

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                response = client_with_auth.get(
                    "/v1/studies/test-study/trials?state=COMPLETE"
                )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 1
        assert data[0]["state"] == "COMPLETE"

    @pytest.mark.asyncio
    async def test_paginates_trials(self, client_with_auth: TestClient) -> None:
        """Test pagination of trials."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        # Create 10 mock trials
        trials = []
        for i in range(10):
            trial = MagicMock()
            trial.number = i
            trial.state = optuna.trial.TrialState.COMPLETE
            trial.values = [0.9 + i * 0.01]
            trial.params = {"lr": 0.01}
            trial.datetime_start = datetime.now(UTC)
            trial.datetime_complete = datetime.now(UTC)
            trial.user_attrs = {}
            trials.append(trial)

        mock_study.trials = trials

        with patch("tuner.api.trials._get_storage", return_value=mock_storage):
            with patch("tuner.api.trials._load_study", return_value=mock_study):
                response = client_with_auth.get(
                    "/v1/studies/test-study/trials?limit=5&offset=2"
                )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 5
        assert data[0]["trial_id"] == 2
        assert data[4]["trial_id"] == 6
