"""Tests for health check endpoints."""

from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    def test_health_check_healthy(self, client: TestClient) -> None:
        """Test health check returns healthy when storage is connected."""
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "0.1.0"
        assert data["storage_connected"] is True

    def test_health_check_degraded_when_storage_fails(
        self, app: FastAPI, mock_storage: MagicMock
    ) -> None:
        """Test health check returns degraded when storage fails."""
        mock_storage.get_all_studies.side_effect = Exception("Connection failed")
        client = TestClient(app)

        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "degraded"
        assert data["storage_connected"] is False

    def test_health_check_degraded_when_no_storage(self) -> None:
        """Test health check returns degraded when storage not initialized."""
        from tuner.api.health import router as health_router

        app = FastAPI()
        app.include_router(health_router)
        # No storage set on app.state
        client = TestClient(app)

        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "degraded"
        assert data["storage_connected"] is False


class TestReadinessEndpoint:
    """Tests for /ready endpoint."""

    def test_readiness_ready(self, client: TestClient) -> None:
        """Test readiness returns ready when storage is available."""
        response = client.get("/ready")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ready"

    def test_readiness_not_ready_when_storage_fails(
        self, app: FastAPI, mock_storage: MagicMock
    ) -> None:
        """Test readiness returns not_ready when storage fails."""
        mock_storage.get_all_studies.side_effect = Exception("Database offline")
        client = TestClient(app)

        response = client.get("/ready")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "not_ready"
        assert "Database offline" in data["reason"]

    def test_readiness_not_ready_when_no_storage(self) -> None:
        """Test readiness returns not_ready when storage not initialized."""
        from tuner.api.health import router as health_router

        app = FastAPI()
        app.include_router(health_router)
        # No storage set on app.state
        client = TestClient(app)

        response = client.get("/ready")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "not_ready"
        assert "not initialized" in data["reason"]


class TestHealthModels:
    """Tests for health response models."""

    def test_health_response_schema(self, client: TestClient) -> None:
        """Test health response follows expected schema."""
        response = client.get("/health")
        data = response.json()

        # Verify all expected fields are present
        assert "status" in data
        assert "version" in data
        assert "storage_connected" in data

        # Verify types
        assert isinstance(data["status"], str)
        assert isinstance(data["version"], str)
        assert isinstance(data["storage_connected"], bool)

    def test_ready_response_schema(self, client: TestClient) -> None:
        """Test ready response follows expected schema."""
        response = client.get("/ready")
        data = response.json()

        assert "status" in data
        assert isinstance(data["status"], str)
