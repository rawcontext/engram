"""Comprehensive tests for main application module focusing on consumer lifecycle."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI

from src.main import create_app, lifespan


class TestLifespanWithConsumer:
    """Tests for lifespan context manager with turn consumer."""

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
        with (
            patch("src.main.SchemaManager") as mock_cls,
            patch("src.main.get_turns_collection_schema") as mock_schema,
        ):
            mock_manager = MagicMock()
            mock_manager.ensure_collection = AsyncMock(return_value=True)
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
    def mock_settings_consumer_enabled(self):
        """Create mock settings with consumer enabled."""
        with patch("src.main.get_settings") as mock_fn:
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test_collection"
            settings.embedder_device = "cpu"
            settings.embedder_preload = False
            settings.embedder_backend = "local"
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.search_host = "0.0.0.0"
            settings.search_port = 5002
            settings.cors_origins = ["*"]
            settings.nats_consumer_enabled = True
            settings.nats_url = "nats://localhost:4222"
            settings.nats_consumer_group = "test-group"
            settings.auth_enabled = False
            mock_fn.return_value = settings
            yield settings

    @pytest.fixture
    def mock_settings_consumer_disabled(self):
        """Create mock settings with consumer disabled."""
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
            settings.nats_consumer_enabled = False
            settings.auth_enabled = False
            mock_fn.return_value = settings
            yield settings

    @pytest.fixture
    def mock_nats_client(self):
        """Create mock NATS client."""
        with patch("src.main.NatsClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.close = AsyncMock()
            mock_cls.return_value = mock_client
            yield mock_client

    @pytest.fixture
    def mock_nats_pubsub(self):
        """Create mock NATS pub/sub publisher."""
        with patch("src.main.NatsPubSubPublisher") as mock_cls:
            mock_pubsub = AsyncMock()
            mock_pubsub.connect = AsyncMock()
            mock_pubsub.disconnect = AsyncMock()
            mock_cls.return_value = mock_pubsub
            yield mock_pubsub

    @pytest.fixture
    def mock_turns_indexer(self):
        """Create mock turns indexer."""
        with patch("src.main.TurnsIndexer") as mock_cls:
            mock_indexer = MagicMock()
            mock_cls.return_value = mock_indexer
            yield mock_indexer

    @pytest.fixture
    def mock_turns_consumer(self):
        """Create mock turn finalized consumer."""
        with patch("src.main.TurnFinalizedConsumer") as mock_cls:
            mock_consumer = AsyncMock()
            mock_consumer.start = AsyncMock()
            mock_consumer.stop = AsyncMock()
            mock_cls.return_value = mock_consumer
            yield mock_consumer

    async def test_lifespan_with_consumer_enabled(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_client,
        mock_nats_pubsub,
        mock_turns_indexer,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan with NATS consumer enabled."""
        app = FastAPI()

        async with lifespan(app):
            # Check consumer was initialized
            assert hasattr(app.state, "nats_client")
            assert hasattr(app.state, "nats_pubsub")
            assert hasattr(app.state, "turns_indexer")
            assert hasattr(app.state, "turns_consumer")
            assert hasattr(app.state, "consumer_task")

        # Check cleanup was called
        mock_turns_consumer.stop.assert_called_once()
        mock_nats_pubsub.disconnect.assert_called_once()
        mock_nats_client.close.assert_called_once()

    async def test_lifespan_with_consumer_disabled(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_disabled,
    ) -> None:
        """Test lifespan with NATS consumer disabled."""
        app = FastAPI()

        async with lifespan(app):
            # Consumer should be None
            assert app.state.turns_consumer is None

    async def test_lifespan_consumer_start_failure(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_client,
    ) -> None:
        """Test lifespan handles consumer startup failure gracefully."""
        with patch("src.main.NatsPubSubPublisher") as mock_pubsub_cls:
            mock_pubsub = AsyncMock()
            mock_pubsub.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_pubsub_cls.return_value = mock_pubsub

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                # Consumer should be None due to error
                assert app.state.turns_consumer is None

    async def test_lifespan_consumer_stop_error(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_client,
        mock_nats_pubsub,
        mock_turns_indexer,
    ) -> None:
        """Test lifespan handles consumer stop error gracefully."""
        with patch("src.main.TurnFinalizedConsumer") as mock_consumer_cls:
            mock_consumer = AsyncMock()
            mock_consumer.start = AsyncMock()
            mock_consumer.stop = AsyncMock(side_effect=Exception("Stop failed"))
            mock_consumer_cls.return_value = mock_consumer

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass

    async def test_lifespan_nats_pubsub_disconnect_error(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_client,
        mock_turns_indexer,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan handles NATS pub/sub disconnect error."""
        with patch("src.main.NatsPubSubPublisher") as mock_pubsub_cls:
            mock_pubsub = AsyncMock()
            mock_pubsub.connect = AsyncMock()
            mock_pubsub.disconnect = AsyncMock(side_effect=Exception("Disconnect failed"))
            mock_pubsub_cls.return_value = mock_pubsub

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass

    async def test_lifespan_nats_client_close_error(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_pubsub,
        mock_turns_indexer,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan handles NATS client close error."""
        with patch("src.main.NatsClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.close = AsyncMock(side_effect=Exception("Close failed"))
            mock_client_cls.return_value = mock_client

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass

    async def test_lifespan_consumer_task_cancellation(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_enabled,
        mock_nats_client,
        mock_nats_pubsub,
        mock_turns_indexer,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan cancels consumer task on shutdown."""
        app = FastAPI()

        async with lifespan(app):
            # Consumer task should be running
            assert hasattr(app.state, "consumer_task")
            assert app.state.consumer_task is not None

        # Task should be cancelled
        assert app.state.consumer_task.cancelled() or app.state.consumer_task.done()

    async def test_lifespan_with_huggingface_backend(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_nats_client,
        mock_nats_pubsub,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan disables sparse/colbert for HuggingFace backend."""
        with (
            patch("src.main.get_settings") as mock_settings_fn,
            patch("src.main.TurnsIndexer") as mock_indexer_cls,
        ):
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test_collection"
            settings.embedder_device = "cpu"
            settings.embedder_preload = False
            settings.embedder_backend = "huggingface"  # HF backend
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.search_host = "0.0.0.0"
            settings.search_port = 5002
            settings.cors_origins = ["*"]
            settings.nats_consumer_enabled = True
            settings.nats_url = "nats://localhost:4222"
            settings.nats_consumer_group = "test-group"
            settings.auth_enabled = False
            mock_settings_fn.return_value = settings

            mock_indexer = MagicMock()
            mock_indexer_cls.return_value = mock_indexer

            app = FastAPI()

            async with lifespan(app):
                pass

            # Check TurnsIndexer was created with sparse/colbert disabled
            mock_indexer_cls.assert_called_once()
            call_kwargs = mock_indexer_cls.call_args[1]
            config = call_kwargs["config"]
            assert config.enable_sparse is False
            assert config.enable_colbert is False

    async def test_lifespan_qdrant_unavailable_no_consumer(
        self,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_settings_consumer_enabled,
    ) -> None:
        """Test lifespan doesn't start consumer when Qdrant is unavailable."""
        with patch("src.main.QdrantClientWrapper") as mock_cls:
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock(side_effect=Exception("Connection failed"))
            mock_client.close = AsyncMock()
            mock_cls.return_value = mock_client

            app = FastAPI()

            async with lifespan(app):
                # Qdrant should be None
                assert app.state.qdrant is None
                # Consumer should not be started
                assert app.state.turns_consumer is None

    async def test_lifespan_with_auth_enabled(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_turns_consumer,
    ) -> None:
        """Test lifespan with authentication enabled."""
        with (
            patch("src.main.get_settings") as mock_settings_fn,
            patch("src.main.ApiKeyAuth") as mock_auth_cls,
            patch("src.main.set_auth_handler") as mock_set_auth,
        ):
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
            settings.nats_consumer_enabled = False
            settings.auth_enabled = True
            settings.postgres_url = "postgresql://localhost/test"
            mock_settings_fn.return_value = settings

            mock_auth = AsyncMock()
            mock_auth.connect = AsyncMock()
            mock_auth.disconnect = AsyncMock()
            mock_auth_cls.return_value = mock_auth

            app = FastAPI()

            async with lifespan(app):
                # Auth handler should be initialized
                assert hasattr(app.state, "auth_handler")
                mock_auth.connect.assert_called_once()
                mock_set_auth.assert_called_once_with(mock_auth)

            # Auth handler should be disconnected
            mock_auth.disconnect.assert_called_once()

    async def test_lifespan_auth_connection_failure(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
    ) -> None:
        """Test lifespan raises when auth connection fails."""
        with (
            patch("src.main.get_settings") as mock_settings_fn,
            patch("src.main.ApiKeyAuth") as mock_auth_cls,
        ):
            settings = MagicMock()
            settings.debug = False
            settings.qdrant_url = "http://localhost:6333"
            settings.qdrant_collection = "test_collection"
            settings.embedder_device = "cpu"
            settings.embedder_preload = False
            settings.reranker_llm_model = "gpt-4o-mini"
            settings.search_host = "0.0.0.0"
            settings.search_port = 6176
            settings.cors_origins = ["*"]
            settings.nats_consumer_enabled = False
            settings.auth_enabled = True
            settings.postgres_url = "postgresql://localhost/test"
            mock_settings_fn.return_value = settings

            mock_auth = AsyncMock()
            mock_auth.connect = AsyncMock(side_effect=Exception("Auth failed"))
            mock_auth_cls.return_value = mock_auth

            app = FastAPI()

            # Should raise RuntimeError when auth fails
            with pytest.raises(RuntimeError, match="Auth database connection failed"):
                async with lifespan(app):
                    pass

    async def test_lifespan_auth_disconnect_error(
        self,
        mock_qdrant_client,
        mock_schema_manager,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
    ) -> None:
        """Test lifespan handles auth disconnect error."""
        with (
            patch("src.main.get_settings") as mock_settings_fn,
            patch("src.main.ApiKeyAuth") as mock_auth_cls,
            patch("src.main.set_auth_handler"),
        ):
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
            settings.nats_consumer_enabled = False
            settings.auth_enabled = True
            settings.postgres_url = "postgresql://localhost/test"
            mock_settings_fn.return_value = settings

            mock_auth = AsyncMock()
            mock_auth.connect = AsyncMock()
            mock_auth.disconnect = AsyncMock(side_effect=Exception("Disconnect failed"))
            mock_auth_cls.return_value = mock_auth

            app = FastAPI()

            # Should not raise
            async with lifespan(app):
                pass

    async def test_lifespan_turns_collection_creation(
        self,
        mock_qdrant_client,
        mock_embedder_factory,
        mock_reranker_router,
        mock_search_retriever,
        mock_multi_query_retriever,
        mock_session_retriever,
        mock_settings_consumer_disabled,
    ) -> None:
        """Test lifespan creates turns and memory collections."""
        with (
            patch("src.main.SchemaManager") as mock_manager_cls,
            patch("src.main.get_turns_collection_schema") as mock_turns_schema_fn,
            patch("src.main.get_memory_collection_schema") as mock_memory_schema_fn,
        ):
            mock_manager = MagicMock()
            mock_manager.ensure_collection = AsyncMock(return_value=True)
            mock_manager_cls.return_value = mock_manager

            mock_turns_schema = MagicMock()
            mock_turns_schema_fn.return_value = mock_turns_schema

            mock_memory_schema = MagicMock()
            mock_memory_schema_fn.return_value = mock_memory_schema

            app = FastAPI()

            async with lifespan(app):
                pass

            # Should call ensure_collection for both turns and memory collections
            assert mock_manager.ensure_collection.call_count == 2
            mock_manager.ensure_collection.assert_any_call(mock_turns_schema)
            mock_manager.ensure_collection.assert_any_call(mock_memory_schema)


class TestAppCreation:
    """Additional tests for app creation and configuration."""

    def test_create_app_debug_mode(self) -> None:
        """Test app creation in debug mode."""
        with patch("src.main.get_settings") as mock_settings:
            settings = MagicMock()
            settings.debug = True
            settings.cors_origins = ["*"]
            mock_settings.return_value = settings

            app = create_app()
            assert app.debug is True

    def test_create_app_production_mode(self) -> None:
        """Test app creation in production mode."""
        with patch("src.main.get_settings") as mock_settings:
            settings = MagicMock()
            settings.debug = False
            settings.cors_origins = ["*"]
            mock_settings.return_value = settings

            app = create_app()
            assert app.debug is False

    def test_create_app_cors_configuration(self) -> None:
        """Test CORS middleware configuration."""
        with patch("src.main.get_settings") as mock_settings:
            settings = MagicMock()
            settings.debug = False
            settings.cors_origins = ["http://localhost:3000", "https://example.com"]
            mock_settings.return_value = settings

            app = create_app()

            # CORS middleware should be configured
            middleware_classes = [m.cls.__name__ for m in app.user_middleware]
            assert "CORSMiddleware" in middleware_classes
