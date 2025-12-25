"""Tests for analysis.py - Analysis endpoints for study results."""

from unittest.mock import AsyncMock, MagicMock, patch

import optuna
import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from tuner.api.analysis import _get_storage, _load_study, router
from tuner.middleware.auth import ApiKeyContext


@pytest.fixture
def app_with_storage() -> FastAPI:
    """Create test FastAPI app with analysis router."""
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

    from tuner.api.analysis import tuner_auth

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


class TestLoadStudy:
    """Tests for _load_study helper."""

    @pytest.mark.asyncio
    async def test_loads_study_successfully(self) -> None:
        """Test that _load_study loads a study by name."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        with patch("tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
            mock_thread.return_value = mock_study

            result = await _load_study(mock_storage, "test-study")
            assert result == mock_study

    @pytest.mark.asyncio
    async def test_raises_404_when_study_not_found(self) -> None:
        """Test that _load_study raises 404 when study doesn't exist."""
        mock_storage = MagicMock()

        with patch("tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock) as mock_thread:
            mock_thread.side_effect = KeyError("not found")

            with pytest.raises(Exception) as exc_info:
                await _load_study(mock_storage, "nonexistent")

            assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND


class TestGetBestParams:
    """Tests for GET /{study_name}/best endpoint."""

    @pytest.mark.asyncio
    async def test_gets_best_params_single_objective(self, client_with_auth: TestClient) -> None:
        """Test getting best parameters for single-objective study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        mock_trial = MagicMock()
        mock_trial.params = {"lr": 0.01, "batch_size": 64}
        mock_trial.value = 0.95
        mock_trial.number = 5

        mock_study.trials = [MagicMock(), mock_trial]
        mock_study.best_trial = mock_trial

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/test-study/best")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["params"]["lr"] == 0.01
        assert data["value"] == 0.95
        assert data["trial_id"] == 5

    @pytest.mark.asyncio
    async def test_gets_best_params_multi_objective(self, client_with_auth: TestClient) -> None:
        """Test getting best parameters for multi-objective study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = True

        mock_trial = MagicMock()
        mock_trial.params = {"lr": 0.01}
        mock_trial.values = [0.95, 0.10]
        mock_trial.number = 3

        mock_study.trials = [MagicMock()]
        mock_study.best_trials = [mock_trial]

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/multi-obj-study/best")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["value"] == [0.95, 0.10]
        assert data["trial_id"] == 3

    @pytest.mark.asyncio
    async def test_fails_with_no_trials(self, client_with_auth: TestClient) -> None:
        """Test that getting best params fails when no trials exist."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study.trials = []

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/empty-study/best")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "no trials" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_fails_with_no_completed_trials(self, client_with_auth: TestClient) -> None:
        """Test that getting best params fails when no completed trials exist."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False
        mock_study.trials = [MagicMock()]
        mock_study.best_trial.side_effect = ValueError("No completed trials")

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/incomplete-study/best")

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_fails_with_no_pareto_trials(self, client_with_auth: TestClient) -> None:
        """Test that getting best params fails when no Pareto-optimal trials exist."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = True
        mock_study.trials = [MagicMock()]
        mock_study.best_trials = []

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/multi-obj-study/best")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "pareto-optimal" in response.json()["detail"].lower()


class TestGetParetoFront:
    """Tests for GET /{study_name}/pareto endpoint."""

    @pytest.mark.asyncio
    async def test_gets_pareto_front_successfully(self, client_with_auth: TestClient) -> None:
        """Test getting Pareto frontier for multi-objective study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = True

        mock_trial1 = MagicMock()
        mock_trial1.number = 0
        mock_trial1.values = [0.95, 0.10]
        mock_trial1.params = {"lr": 0.01}

        mock_trial2 = MagicMock()
        mock_trial2.number = 1
        mock_trial2.values = [0.90, 0.05]
        mock_trial2.params = {"lr": 0.001}

        mock_study.best_trials = [mock_trial1, mock_trial2]

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/multi-obj-study/pareto")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data) == 2
        assert data[0]["trial_id"] == 0
        assert data[0]["values"] == [0.95, 0.10]
        assert data[1]["trial_id"] == 1
        assert data[1]["values"] == [0.90, 0.05]

    @pytest.mark.asyncio
    async def test_fails_for_single_objective_study(self, client_with_auth: TestClient) -> None:
        """Test that Pareto endpoint fails for single-objective study."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/single-obj-study/pareto")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "multi-objective" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_returns_empty_pareto_front(self, client_with_auth: TestClient) -> None:
        """Test that empty Pareto frontier is returned correctly."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = True
        mock_study.best_trials = []

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/empty-multi-obj/pareto")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data == []


class TestGetParamImportance:
    """Tests for GET /{study_name}/importance endpoint."""

    @pytest.mark.skip(reason="Requires sklearn - integration test")
    @pytest.mark.asyncio
    async def test_gets_importance_with_fanova(self, client_with_auth: TestClient) -> None:
        """Test getting parameter importance using fANOVA."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        # Create multiple completed trials
        mock_trial1 = MagicMock()
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial2 = MagicMock()
        mock_trial2.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial1, mock_trial2]

        importance_result = {"lr": 0.75, "batch_size": 0.25}

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                # Mock asyncio.to_thread since it's what wraps the optuna call
                with patch(
                    "tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock
                ) as mock_to_thread:
                    mock_to_thread.return_value = importance_result

                    response = client_with_auth.get("/v1/studies/test-study/importance")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["importances"]["lr"] == 0.75
        assert data["method"] == "fanova"

    @pytest.mark.skip(reason="Requires sklearn - integration test")
    @pytest.mark.asyncio
    async def test_gets_importance_with_target_idx(self, client_with_auth: TestClient) -> None:
        """Test getting parameter importance for specific objective."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = True

        mock_trial1 = MagicMock()
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial2 = MagicMock()
        mock_trial2.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial1, mock_trial2]

        importance_result = {"lr": 0.60, "batch_size": 0.40}

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                with patch(
                    "tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock
                ) as mock_to_thread:
                    mock_to_thread.return_value = importance_result

                    response = client_with_auth.get(
                        "/v1/studies/multi-obj-study/importance?target_idx=1"
                    )

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["importances"]["lr"] == 0.60

    @pytest.mark.skip(reason="Requires sklearn - integration test")
    @pytest.mark.asyncio
    async def test_falls_back_to_mdi(self, client_with_auth: TestClient) -> None:
        """Test falling back to MDI when fANOVA fails."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        mock_trial1 = MagicMock()
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial2 = MagicMock()
        mock_trial2.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial1, mock_trial2]

        mdi_result = {"lr": 0.80, "batch_size": 0.20}

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                with patch(
                    "tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock
                ) as mock_to_thread:
                    # First call (fANOVA) fails, second call (MDI) succeeds
                    mock_to_thread.side_effect = [
                        Exception("fANOVA failed"),
                        mdi_result,
                    ]

                    response = client_with_auth.get("/v1/studies/test-study/importance")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["method"] == "mean_decrease_impurity"
        assert data["importances"]["lr"] == 0.80

    @pytest.mark.asyncio
    async def test_fails_with_insufficient_trials(self, client_with_auth: TestClient) -> None:
        """Test that importance fails with less than 2 completed trials."""
        mock_storage = MagicMock()
        mock_study = MagicMock()

        mock_trial = MagicMock()
        mock_trial.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial]

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                response = client_with_auth.get("/v1/studies/test-study/importance")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "at least 2" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_fails_when_both_methods_fail(self, client_with_auth: TestClient) -> None:
        """Test that importance fails when both fANOVA and MDI fail."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        mock_trial1 = MagicMock()
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial2 = MagicMock()
        mock_trial2.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial1, mock_trial2]

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                with patch(
                    "tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock
                ) as mock_thread:
                    # Both methods fail
                    mock_thread.side_effect = [
                        Exception("fANOVA failed"),
                        Exception("MDI failed"),
                    ]

                    response = client_with_auth.get("/v1/studies/test-study/importance")

        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    @pytest.mark.skip(reason="Requires sklearn - integration test")
    @pytest.mark.asyncio
    async def test_filters_completed_trials_only(self, client_with_auth: TestClient) -> None:
        """Test that only completed trials are used for importance."""
        mock_storage = MagicMock()
        mock_study = MagicMock()
        mock_study._is_multi_objective.return_value = False

        mock_trial1 = MagicMock()
        mock_trial1.state = optuna.trial.TrialState.COMPLETE
        mock_trial2 = MagicMock()
        mock_trial2.state = optuna.trial.TrialState.RUNNING
        mock_trial3 = MagicMock()
        mock_trial3.state = optuna.trial.TrialState.COMPLETE

        mock_study.trials = [mock_trial1, mock_trial2, mock_trial3]

        importance_result = {"lr": 0.70, "batch_size": 0.30}

        with patch("tuner.api.analysis._get_storage", return_value=mock_storage):
            with patch("tuner.api.analysis._load_study", return_value=mock_study):
                with patch(
                    "tuner.api.analysis.asyncio.to_thread", new_callable=AsyncMock
                ) as mock_to_thread:
                    mock_to_thread.return_value = importance_result

                    response = client_with_auth.get("/v1/studies/test-study/importance")

        # Should succeed because there are 2 completed trials
        assert response.status_code == status.HTTP_200_OK
