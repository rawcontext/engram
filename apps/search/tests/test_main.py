"""Comprehensive tests for main application module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI

from src.main import create_app, lifespan


class TestCreateApp:
    """Tests for create_app function."""

    def test_creates_fastapi_app(self) -> None:
        """Test that create_app returns a FastAPI instance."""
        app = create_app()
        assert isinstance(app, FastAPI)

    def test_app_has_correct_title(self) -> None:
        """Test app has correct title."""
        app = create_app()
        assert app.title == "Engram Search Service"

    def test_app_has_correct_version(self) -> None:
        """Test app has correct version."""
        app = create_app()
        assert app.version == "0.1.0"

    def test_app_has_router(self) -> None:
        """Test app has API router included."""
        app = create_app()
        # Check that routes exist
        route_paths = [route.path for route in app.routes]
        assert "/health" in route_paths
        assert "/ready" in route_paths
        assert "/metrics" in route_paths
        assert "/search" in route_paths
        assert "/embed" in route_paths

    def test_app_has_cors_middleware(self) -> None:
        """Test app has CORS middleware."""
        app = create_app()
        # Check middleware stack has CORS
        middleware_classes = [m.cls.__name__ for m in app.user_middleware]
        assert "CORSMiddleware" in middleware_classes

    def test_app_has_tracing_middleware(self) -> None:
        """Test app has tracing middleware."""
        app = create_app()
        middleware_classes = [m.cls.__name__ for m in app.user_middleware]
        assert "TracingMiddleware" in middleware_classes


class TestLifespan:
    """Tests for lifespan context manager."""

    @pytest.fixture
    def mock_qdrant_client(self):
        """Create mock Qdrant client."""
        with patch("src.main.QdrantClientWrapper") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.close = AsyncMock()
            mock_client.get_collection_info = AsyncMock(return_value=MagicMock(points_count=100))
            mock_cls.return_value = mock_client
            yield mock_client

    @pytest.fixture
    def mock_schema_manager(self):
        """Create mock schema manager."""
        with patch("src.main.SchemaManager") as mock_cls, patch(
            "src.main.get_turns_collection_schema"
        ) as mock_schema:
            mock_manager = MagicMock()
            mock_manager.ensure_collection = AsyncMock(return_value=False)
            mock_cls.return_value = mock_manager
            mock_schema.return_value = MagicMock()
            yield mock_manager

    @pytest.fixture
    def mock_embedder_factory(self):
        """Create mock embedder factory."""
        with patch("src.main.EmbedderFactory") as mock_cls:
            mock_factory = MagicMock()
            mock_factory.preload_all = AsyncMock()
            mock_factory.unload_all = AsyncMock()
            mock_cls.return_value = mock_factory
            yield mock_factory

    @pytest.fixture
    def mock_reranker_router(self):
        """Create mock reranker router."""
        with patch("src.main.RerankerRouter") as mock_cls:
            mock_router = MagicMock()
            mock_cls.return_value = mock_router
            yield mock_router

    @pytest.fixture
    def mock_search_retriever(self):
        """Create mock search retriever."""
        with patch("src.main.SearchRetriever") as mock_cls:
            mock_retriever = MagicMock()
            mock_cls.return_value = mock_retriever
            yield mock_retriever

    @pytest.fixture
    def mock_multi_query_retriever(self):
        """Create mock multi-query retriever."""
        with patch("src.main.MultiQueryRetriever") as mock_cls:
            mock_retriever = MagicMock()
            mock_cls.return_value = mock_retriever
            yield mock_retriever

    @pytest.fixture
    def mock_session_retriever(self):
        """Create mock session-aware retriever."""
        with patch("src.main.SessionAwareRetriever") as mock_cls:
            mock_retriever = MagicMock()
            mock_cls.return_value = mock_retriever
            yield mock_retriever

    @pytest.fixture
    def mock_settings(self):
        """Create mock settings."""
        with patch("src.main.get_settings") as mock_fn:
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test_collection"
            settings.embedder_device = "cpu"
            settings.embedder_preload = False
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.search_host = "0.0.0.0"
            settings.search_port = 5002
            settings.cors_origins = ["*"]
            mock_fn.return_value = settings
            yield settings

    async def test_lifespan_startup_success(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings,
    ) -> None:
        """Test successful startup."""
        app = FastAPI()

        async with lifespan(app):
            # Check state was set
            assert hasattr(app.state, "qdrant")
            assert hasattr(app.state, "embedder_factory")
            assert hasattr(app.state, "reranker_router")
            assert hasattr(app.state, "search_retriever")
            assert hasattr(app.state, "multi_query_retriever")
            assert hasattr(app.state, "session_aware_retriever")

        # Check cleanup was called
        mock_embedder_factory.unload_all.assert_called_once()
        mock_qdrant_client.close.assert_called_once()

    async def test_lifespan_qdrant_connect_failure(
        self,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_settings,
    ) -> None:
        """Test startup when Qdrant connection fails."""
        with patch("src.main.QdrantClientWrapper") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_client.close = AsyncMock()
            mock_cls.return_value = mock_client

            app = FastAPI()

            async with lifespan(app):
                # Qdrant should be None in degraded mode
                assert app.state.qdrant is None
                # Retrievers should also be None
                assert app.state.search_retriever is None
                assert app.state.multi_query_retriever is None
                assert app.state.session_aware_retriever is None

    async def test_lifespan_collection_not_exists(
        self,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings,
    ) -> None:
        """Test startup when collection doesn't exist."""
        with patch("src.main.QdrantClientWrapper") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.close = AsyncMock()
            mock_client.get_collection_info = AsyncMock(return_value=None)
            mock_cls.return_value = mock_client

            app = FastAPI()

            async with lifespan(app):
                # Should still work, just log warning
                assert app.state.qdrant is mock_client

    async def test_lifespan_preload_models(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
    ) -> None:
        """Test startup with model preloading."""
        with patch("src.main.get_settings") as mock_fn, patch(
            "src.main.EmbedderFactory"
        ) as mock_factory_cls:
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test"
            settings.embedder_device = "cpu"
            settings.embedder_preload = True  # Enable preload
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.cors_origins = ["*"]
            mock_fn.return_value = settings

            mock_factory = MagicMock()
            mock_factory.preload_all = AsyncMock()
            mock_factory.unload_all = AsyncMock()
            mock_factory_cls.return_value = mock_factory

            app = FastAPI()

            async with lifespan(app):
                pass

            mock_factory.preload_all.assert_called_once()

    async def test_lifespan_preload_failure(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
    ) -> None:
        """Test startup when preload fails."""
        with patch("src.main.get_settings") as mock_fn, patch(
            "src.main.EmbedderFactory"
        ) as mock_factory_cls:
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test"
            settings.embedder_device = "cpu"
            settings.embedder_preload = True
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.cors_origins = ["*"]
            mock_fn.return_value = settings

            mock_factory = MagicMock()
            mock_factory.preload_all = AsyncMock(side_effect=Exception("Preload failed"))
            mock_factory.unload_all = AsyncMock()
            mock_factory_cls.return_value = mock_factory

            app = FastAPI()

            # Should not raise, just log warning
            async with lifespan(app):
                pass

    async def test_lifespan_shutdown_embedder_error(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings,
    ) -> None:
        """Test shutdown handles embedder unload error."""
        with patch("src.main.EmbedderFactory") as mock_factory_cls:
            mock_factory = MagicMock()
            mock_factory.preload_all = AsyncMock()
            mock_factory.unload_all = AsyncMock(side_effect=Exception("Unload error"))
            mock_factory_cls.return_value = mock_factory

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass

    async def test_lifespan_shutdown_qdrant_error(
        self,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings,
    ) -> None:
        """Test shutdown handles Qdrant close error."""
        with patch("src.main.QdrantClientWrapper") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.close = AsyncMock(side_effect=Exception("Close error"))
            mock_client.get_collection_info = AsyncMock(return_value=MagicMock())
            mock_cls.return_value = mock_client

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass


class TestRun:
    """Tests for run function."""

    def test_run_calls_uvicorn(self) -> None:
        """Test that run starts uvicorn server."""
        with patch("src.main.uvicorn.run") as mock_run, patch(
            "src.main.get_settings"
        ) as mock_settings:
            settings = MagicMock()
            settings.search_host = "0.0.0.0"
            settings.search_port = 5002
            settings.debug = False
            mock_settings.return_value = settings

            from src.main import run

            run()

            mock_run.assert_called_once_with(
                "search.main:app",
                host="0.0.0.0",
                port=5002,
                reload=False,
                log_level="info",
            )
