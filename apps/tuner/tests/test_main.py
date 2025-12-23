"""Tests for main.py - FastAPI application entry point."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from tuner.main import app, create_app, lifespan, run


class TestCreateApp:
    """Tests for create_app factory function."""

    def test_creates_fastapi_app(self) -> None:
        """Test that create_app returns a configured FastAPI instance."""
        app = create_app()

        assert app.title == "Engram Tuner Service"
        assert app.description == "Hyperparameter optimization service for Engram search using Optuna"
        assert app.version == "0.1.0"

    @patch("tuner.main.get_settings")
    def test_respects_debug_setting(self, mock_settings: MagicMock) -> None:
        """Test that debug setting is applied."""
        mock_settings.return_value.debug = True
        mock_settings.return_value.cors_origins = ["*"]

        app = create_app()
        assert app.debug is True

    @patch("tuner.main.get_settings")
    def test_includes_api_router(self, mock_settings: MagicMock) -> None:
        """Test that API router is included."""
        mock_settings.return_value.cors_origins = ["*"]
        app = create_app()

        # Check that routes are registered
        route_paths = [route.path for route in app.routes]
        assert "/v1/health" in route_paths


class TestLifespan:
    """Tests for application lifespan manager."""

    @pytest.mark.asyncio
    async def test_lifespan_initializes_storage(self) -> None:
        """Test that lifespan initializes Optuna storage."""
        test_app = create_app()

        with patch("tuner.main.get_storage") as mock_get_storage, patch(
            "tuner.main.get_settings"
        ) as mock_settings:
            mock_settings.return_value.auth_enabled = False
            mock_storage = MagicMock()
            mock_get_storage.return_value = mock_storage

            async with lifespan(test_app):
                assert hasattr(test_app.state, "storage")
                assert test_app.state.storage == mock_storage

    @pytest.mark.asyncio
    async def test_lifespan_handles_storage_failure(self) -> None:
        """Test that lifespan handles storage initialization failure gracefully."""
        test_app = create_app()

        with patch("tuner.main.get_storage") as mock_get_storage, patch(
            "tuner.main.get_settings"
        ) as mock_settings:
            mock_settings.return_value.auth_enabled = False
            mock_get_storage.side_effect = Exception("Connection failed")

            async with lifespan(test_app):
                assert hasattr(test_app.state, "storage")
                assert test_app.state.storage is None

    @pytest.mark.asyncio
    async def test_lifespan_initializes_auth_when_enabled(self) -> None:
        """Test that lifespan initializes auth handler when enabled."""
        test_app = create_app()

        with patch("tuner.main.ApiKeyAuth") as mock_auth_class, patch(
            "tuner.main.get_settings"
        ) as mock_settings, patch("tuner.main.set_auth_handler") as mock_set_auth, patch(
            "tuner.main.get_storage"
        ):
            mock_settings.return_value.auth_enabled = True
            mock_settings.return_value.auth_database_url = "postgresql://test"

            mock_auth_handler = AsyncMock()
            mock_auth_class.return_value = mock_auth_handler

            async with lifespan(test_app):
                mock_auth_handler.connect.assert_awaited_once()
                mock_set_auth.assert_called_once_with(mock_auth_handler)
                assert hasattr(test_app.state, "auth_handler")
                assert test_app.state.auth_handler == mock_auth_handler

            # Check cleanup
            mock_auth_handler.disconnect.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_lifespan_handles_auth_failure(self) -> None:
        """Test that lifespan handles auth initialization failure gracefully."""
        test_app = create_app()

        with patch("tuner.main.ApiKeyAuth") as mock_auth_class, patch(
            "tuner.main.get_settings"
        ) as mock_settings, patch("tuner.main.set_auth_handler"), patch("tuner.main.get_storage"):
            mock_settings.return_value.auth_enabled = True
            mock_settings.return_value.auth_database_url = "postgresql://test"

            mock_auth_handler = AsyncMock()
            mock_auth_handler.connect.side_effect = Exception("Auth failed")
            mock_auth_class.return_value = mock_auth_handler

            async with lifespan(test_app):
                # Should not raise, just log warning
                pass

    @pytest.mark.asyncio
    async def test_lifespan_skips_auth_when_disabled(self) -> None:
        """Test that lifespan skips auth when AUTH_ENABLED=false."""
        test_app = create_app()

        with patch("tuner.main.ApiKeyAuth") as mock_auth_class, patch(
            "tuner.main.get_settings"
        ) as mock_settings, patch("tuner.main.get_storage"):
            mock_settings.return_value.auth_enabled = False

            async with lifespan(test_app):
                mock_auth_class.assert_not_called()
                assert not hasattr(test_app.state, "auth_handler")

    @pytest.mark.asyncio
    async def test_lifespan_closes_auth_on_shutdown(self) -> None:
        """Test that lifespan closes auth handler on shutdown."""
        test_app = create_app()

        with patch("tuner.main.ApiKeyAuth") as mock_auth_class, patch(
            "tuner.main.get_settings"
        ) as mock_settings, patch("tuner.main.set_auth_handler"), patch("tuner.main.get_storage"):
            mock_settings.return_value.auth_enabled = True
            mock_settings.return_value.auth_database_url = "postgresql://test"

            mock_auth_handler = AsyncMock()
            mock_auth_class.return_value = mock_auth_handler

            async with lifespan(test_app):
                pass

            mock_auth_handler.disconnect.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_lifespan_handles_auth_close_error(self) -> None:
        """Test that lifespan handles errors when closing auth handler."""
        test_app = create_app()

        with patch("tuner.main.ApiKeyAuth") as mock_auth_class, patch(
            "tuner.main.get_settings"
        ) as mock_settings, patch("tuner.main.set_auth_handler"), patch("tuner.main.get_storage"):
            mock_settings.return_value.auth_enabled = True
            mock_settings.return_value.auth_database_url = "postgresql://test"

            mock_auth_handler = AsyncMock()
            mock_auth_handler.disconnect.side_effect = Exception("Close failed")
            mock_auth_class.return_value = mock_auth_handler

            async with lifespan(test_app):
                pass
            # Should not raise


class TestAppInstance:
    """Tests for the app instance created at module level."""

    def test_app_is_fastapi_instance(self) -> None:
        """Test that app is a valid FastAPI instance."""
        assert app is not None
        assert app.title == "Engram Tuner Service"


class TestRun:
    """Tests for run() entry point."""

    @patch("tuner.main.uvicorn.run")
    @patch("tuner.main.get_settings")
    def test_run_starts_uvicorn(self, mock_settings: MagicMock, mock_uvicorn: MagicMock) -> None:
        """Test that run() starts uvicorn with correct settings."""
        mock_settings.return_value.host = "0.0.0.0"
        mock_settings.return_value.port = 8000
        mock_settings.return_value.debug = False

        run()

        mock_uvicorn.assert_called_once_with(
            "tuner.main:app",
            host="0.0.0.0",
            port=8000,
            reload=False,
        )

    @patch("tuner.main.uvicorn.run")
    @patch("tuner.main.get_settings")
    def test_run_enables_reload_in_debug(
        self, mock_settings: MagicMock, mock_uvicorn: MagicMock
    ) -> None:
        """Test that run() enables reload when debug=True."""
        mock_settings.return_value.host = "localhost"
        mock_settings.return_value.port = 3000
        mock_settings.return_value.debug = True

        run()

        mock_uvicorn.assert_called_once_with(
            "tuner.main:app",
            host="localhost",
            port=3000,
            reload=True,
        )


class TestIntegration:
    """Integration tests for the full app."""

    def test_health_endpoint_accessible(self) -> None:
        """Test that health endpoint is accessible through the app."""
        with patch("tuner.main.get_storage"):
            client = TestClient(app)
            response = client.get("/v1/health")
            # Should return 503 without storage, but endpoint should be accessible
            assert response.status_code in [200, 503]

    def test_cors_middleware_configured(self) -> None:
        """Test that CORS middleware is properly configured."""
        # Check that user_middleware includes CORS
        found_cors = False
        for middleware_def in app.user_middleware:
            if hasattr(middleware_def, "cls"):
                if "CORS" in middleware_def.cls.__name__:
                    found_cors = True
                    break

        assert found_cors, "CORSMiddleware not configured in app"
