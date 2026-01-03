"""Comprehensive tests for API routes."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.api.router import router
from src.middleware.auth import AuthContext
from src.retrieval.types import RerankerTier

# Mock auth context for authenticated requests (OAuth format)
MOCK_AUTH_CONTEXT = AuthContext(
    id="test-token-id",
    prefix="egm_oauth_abc123...",
    method="oauth",
    type="oauth",
    user_id="test-user",
    org_id="test-org",
    scopes=["memory:read", "memory:write", "query:read"],
    rate_limit_rpm=1000,
)


@pytest.fixture
def mock_qdrant():
    """Create mock Qdrant client."""
    qdrant = MagicMock()
    qdrant.health_check = AsyncMock(return_value=True)
    return qdrant


@pytest.fixture
def mock_search_retriever():
    """Create mock search retriever."""
    retriever = MagicMock()
    retriever.search = AsyncMock(return_value=[])
    retriever.search_turns = AsyncMock(return_value=[])
    return retriever


@pytest.fixture
def mock_embedder_factory():
    """Create mock embedder factory."""
    factory = MagicMock()
    embedder = AsyncMock()
    embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
    factory.get_embedder = AsyncMock(return_value=embedder)
    return factory


@pytest.fixture
def mock_multi_query_retriever():
    """Create mock multi-query retriever."""
    retriever = MagicMock()
    retriever.search = AsyncMock(return_value=[])
    retriever.config = MagicMock()  # Allow config to be set
    return retriever


@pytest.fixture
def mock_session_aware_retriever():
    """Create mock session-aware retriever."""
    retriever = MagicMock()
    retriever.retrieve = AsyncMock(return_value=[])
    retriever.config = MagicMock()  # Allow config to be set
    return retriever


@pytest.fixture
def app_with_mocks(
    mock_qdrant,
    mock_search_retriever,
    mock_embedder_factory,
    mock_multi_query_retriever,
    mock_session_aware_retriever,
):
    """Create FastAPI app with mocked state."""
    app = FastAPI()
    app.include_router(router)

    app.state.qdrant = mock_qdrant
    app.state.search_retriever = mock_search_retriever
    app.state.embedder_factory = mock_embedder_factory
    app.state.multi_query_retriever = mock_multi_query_retriever
    app.state.session_aware_retriever = mock_session_aware_retriever

    return app


@pytest.fixture
async def client(app_with_mocks):
    """Create async test client with mocked authentication."""
    # Mock the auth handler to return a valid OAuth context
    mock_handler = AsyncMock()
    mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

    with patch("src.middleware.auth._auth_handler", mock_handler):
        transport = ASGITransport(app=app_with_mocks)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"},
        ) as ac:
            yield ac


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    async def test_health_healthy(self, client: AsyncClient, mock_qdrant) -> None:
        """Test health endpoint when healthy."""
        mock_qdrant.health_check.return_value = True

        response = await client.get("/v1/search/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["qdrant_connected"] is True
        assert "version" in data

    async def test_health_degraded(self, client: AsyncClient, mock_qdrant) -> None:
        """Test health endpoint when degraded."""
        mock_qdrant.health_check.return_value = False

        response = await client.get("/v1/search/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["qdrant_connected"] is False

    async def test_health_qdrant_error(self, client: AsyncClient, mock_qdrant) -> None:
        """Test health endpoint when Qdrant throws error."""
        mock_qdrant.health_check.side_effect = Exception("Connection error")

        response = await client.get("/v1/search/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["qdrant_connected"] is False

    async def test_health_no_qdrant(self, mock_search_retriever) -> None:
        """Test health endpoint when Qdrant not initialized."""
        app = FastAPI()
        app.include_router(router)
        # No qdrant in state

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/v1/search/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"


class TestReadinessEndpoint:
    """Tests for /ready endpoint."""

    async def test_ready_success(self, client: AsyncClient, mock_qdrant) -> None:
        """Test readiness when ready."""
        mock_qdrant.health_check.return_value = True

        response = await client.get("/v1/search/ready")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"

    async def test_ready_not_healthy(self, client: AsyncClient, mock_qdrant) -> None:
        """Test readiness when not healthy."""
        mock_qdrant.health_check.return_value = False

        response = await client.get("/v1/search/ready")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_ready"

    async def test_ready_qdrant_error(self, client: AsyncClient, mock_qdrant) -> None:
        """Test readiness when Qdrant throws error."""
        mock_qdrant.health_check.side_effect = Exception("Error")

        response = await client.get("/v1/search/ready")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_ready"
        assert "reason" in data

    async def test_ready_no_qdrant(self) -> None:
        """Test readiness when Qdrant not initialized."""
        app = FastAPI()
        app.include_router(router)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/v1/search/ready")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_ready"


class TestMetricsEndpoint:
    """Tests for /metrics endpoint."""

    async def test_metrics(self, client: AsyncClient) -> None:
        """Test metrics endpoint returns prometheus format."""
        response = await client.get("/v1/search/metrics")

        assert response.status_code == 200
        # Should be text/plain prometheus format
        assert "text/plain" in response.headers["content-type"]


class TestSearchEndpoint:
    """Tests for /search endpoint."""

    async def test_search_success(self, client: AsyncClient, mock_search_retriever) -> None:
        """Test successful search."""
        mock_result = MagicMock()
        mock_result.id = "result-1"
        mock_result.score = 0.95
        mock_result.rrf_score = None
        mock_result.reranker_score = None
        mock_result.rerank_tier = None
        mock_result.payload = {"content": "test"}
        mock_result.degraded = False

        mock_search_retriever.search_turns.return_value = [mock_result]

        response = await client.post(
            "/v1/search/query",
            json={"text": "test query", "limit": 10},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert len(data["results"]) == 1
        assert data["results"][0]["id"] == "result-1"
        assert "took_ms" in data

    async def test_search_with_filters(self, client: AsyncClient, mock_search_retriever) -> None:
        """Test search with filters."""
        mock_search_retriever.search_turns.return_value = []

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
                "filters": {
                    "session_id": "session-123",
                    "type": "code",
                    "time_range": {"start": 0, "end": 100},
                },
            },
        )

        assert response.status_code == 200

    async def test_search_with_reranking(self, client: AsyncClient, mock_search_retriever) -> None:
        """Test search with reranking enabled."""
        mock_result = MagicMock()
        mock_result.id = "result-1"
        mock_result.score = 0.95
        mock_result.rrf_score = 0.8
        mock_result.reranker_score = 0.92
        mock_result.rerank_tier = RerankerTier.FAST
        mock_result.payload = {}
        mock_result.degraded = False

        mock_search_retriever.search_turns.return_value = [mock_result]

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
                "rerank": True,
                "rerank_tier": "fast",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["rerank_tier"] == "fast"

    async def test_search_no_retriever(self) -> None:
        """Test search when retriever not initialized."""
        app = FastAPI()
        app.include_router(router)
        app.state.qdrant = MagicMock()

        # Mock auth handler for this test
        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/query",
                    json={"text": "test", "limit": 10},
                )

            assert response.status_code == 503

    async def test_search_error(self, client: AsyncClient, mock_search_retriever) -> None:
        """Test search error handling."""
        mock_search_retriever.search_turns.side_effect = Exception("Search failed")

        response = await client.post(
            "/v1/search/query",
            json={"text": "test query", "limit": 10},
        )

        assert response.status_code == 500
        data = response.json()
        assert "Search failed" in data["detail"]


class TestEmbedEndpoint:
    """Tests for /embed endpoint."""

    async def test_embed_success(self, client: AsyncClient, mock_embedder_factory) -> None:
        """Test successful embedding."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder.return_value = mock_embedder

        response = await client.post(
            "/v1/search/embed",
            json={"text": "test text", "embedder_type": "text"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["embedding"]) == 3
        assert data["dimensions"] == 3
        assert data["embedder_type"] == "text"
        assert "took_ms" in data

    async def test_embed_as_query(self, client: AsyncClient, mock_embedder_factory) -> None:
        """Test embedding as query."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2])
        mock_embedder_factory.get_embedder.return_value = mock_embedder

        response = await client.post(
            "/v1/search/embed",
            json={"text": "test", "embedder_type": "text", "is_query": True},
        )

        assert response.status_code == 200
        mock_embedder.embed.assert_called_with("test", is_query=True)

    async def test_embed_no_factory(self) -> None:
        """Test embed when factory not initialized."""
        app = FastAPI()
        app.include_router(router)

        # Mock auth handler for this test
        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/embed",
                    json={"text": "test", "embedder_type": "text"},
                )

            assert response.status_code == 503

    async def test_embed_error(self, client: AsyncClient, mock_embedder_factory) -> None:
        """Test embed error handling."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(side_effect=Exception("Embed failed"))
        mock_embedder_factory.get_embedder.return_value = mock_embedder

        response = await client.post(
            "/v1/search/embed",
            json={"text": "test", "embedder_type": "text"},
        )

        assert response.status_code == 500


class TestMultiQuerySearchEndpoint:
    """Tests for /search/multi-query endpoint."""

    async def test_multi_query_search_success(
        self, client: AsyncClient, mock_multi_query_retriever
    ) -> None:
        """Test successful multi-query search."""
        mock_result = MagicMock()
        mock_result.id = "result-1"
        mock_result.score = 0.9
        mock_result.rrf_score = 0.85
        mock_result.reranker_score = None
        mock_result.rerank_tier = None
        mock_result.payload = {}
        mock_result.degraded = False

        mock_multi_query_retriever.search.return_value = [mock_result]

        response = await client.post(
            "/v1/search/multi-query",
            json={
                "text": "test query",
                "limit": 10,
                "threshold": 0.5,
                "num_variations": 3,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert "took_ms" in data

    async def test_multi_query_with_strategies(
        self, client: AsyncClient, mock_multi_query_retriever
    ) -> None:
        """Test multi-query with custom strategies."""
        mock_multi_query_retriever.search.return_value = []

        response = await client.post(
            "/v1/search/multi-query",
            json={
                "text": "test query",
                "limit": 10,
                "threshold": 0.5,
                "strategies": ["paraphrase", "keyword"],
                "include_original": True,
                "rrf_k": 60,
            },
        )

        assert response.status_code == 200

    async def test_multi_query_with_filters(
        self, client: AsyncClient, mock_multi_query_retriever
    ) -> None:
        """Test multi-query with filters."""
        mock_multi_query_retriever.search.return_value = []

        response = await client.post(
            "/v1/search/multi-query",
            json={
                "text": "test",
                "limit": 10,
                "threshold": 0.5,
                "filters": {
                    "session_id": "session-1",
                    "time_range": {"start": 0, "end": 100},
                },
            },
        )

        assert response.status_code == 200

    async def test_multi_query_no_retriever(self) -> None:
        """Test multi-query when retriever not initialized."""
        app = FastAPI()
        app.include_router(router)

        # Mock auth handler for this test
        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/multi-query",
                    json={"text": "test", "limit": 10},
                )

            assert response.status_code == 503

    async def test_multi_query_error(self, client: AsyncClient, mock_multi_query_retriever) -> None:
        """Test multi-query error handling."""
        mock_multi_query_retriever.search.side_effect = Exception("Error")

        response = await client.post(
            "/v1/search/multi-query",
            json={"text": "test", "limit": 10},
        )

        assert response.status_code == 500


class TestSessionAwareSearchEndpoint:
    """Tests for /search/session-aware endpoint."""

    async def test_session_aware_success(
        self, client: AsyncClient, mock_session_aware_retriever
    ) -> None:
        """Test successful session-aware search."""
        mock_result = MagicMock()
        mock_result.id = "result-1"
        mock_result.score = 0.9
        mock_result.payload = {"content": "test"}
        mock_result.session_id = "session-123"
        mock_result.session_summary = "Test session"
        mock_result.session_score = 0.85
        mock_result.rrf_score = None
        mock_result.reranker_score = None

        mock_session_aware_retriever.retrieve.return_value = [mock_result]

        response = await client.post(
            "/v1/search/session-aware",
            json={
                "query": "test query",
                "top_sessions": 5,
                "turns_per_session": 10,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["results"][0]["session_id"] == "session-123"
        assert "took_ms" in data

    async def test_session_aware_custom_config(
        self, client: AsyncClient, mock_session_aware_retriever
    ) -> None:
        """Test session-aware with custom configuration."""
        mock_session_aware_retriever.retrieve.return_value = []

        response = await client.post(
            "/v1/search/session-aware",
            json={
                "query": "test",
                "top_sessions": 10,
                "turns_per_session": 10,
                "final_top_k": 50,
            },
        )

        assert response.status_code == 200

    async def test_session_aware_no_retriever(self) -> None:
        """Test session-aware when retriever not initialized."""
        app = FastAPI()
        app.include_router(router)

        # Mock auth handler for this test
        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/session-aware",
                    json={"query": "test"},
                )

            assert response.status_code == 503

    async def test_session_aware_error(
        self, client: AsyncClient, mock_session_aware_retriever
    ) -> None:
        """Test session-aware error handling."""
        mock_session_aware_retriever.retrieve.side_effect = Exception("Error")

        response = await client.post(
            "/v1/search/session-aware",
            json={"query": "test"},
        )

        assert response.status_code == 500


class TestMemoryIndexEndpoint:
    """Tests for /index-memory endpoint."""

    async def test_index_memory_success(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test successful memory indexing."""
        # Mock text embedder
        mock_text_embedder = AsyncMock()
        mock_text_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

        # Mock sparse embedder (BM25)
        mock_sparse_embedder = MagicMock()
        mock_sparse_embedder.embed_sparse = MagicMock(return_value={10: 0.5, 20: 0.3})

        async def get_embedder_mock(embedder_type):
            if embedder_type == "text":
                return mock_text_embedder
            return mock_text_embedder

        mock_embedder_factory.get_embedder = AsyncMock(side_effect=get_embedder_mock)
        mock_embedder_factory.get_sparse_embedder = AsyncMock(return_value=mock_sparse_embedder)

        # Mock Qdrant upsert
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.upsert = AsyncMock()

        response = await client.post(
            "/v1/search/index-memory",
            json={
                "id": "01JGABCDEFGHIJKLMNOPQRSTUV",
                "content": "Test memory content",
                "type": "fact",
                "tags": ["test", "example"],
                "project": "engram",
                "source_session_id": "session-123",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "01JGABCDEFGHIJKLMNOPQRSTUV"
        assert data["indexed"] is True
        assert "took_ms" in data

        # Verify upsert was called
        mock_qdrant.client.upsert.assert_called_once()

    async def test_index_memory_no_sparse_embedder(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test memory indexing without sparse embedder."""
        mock_text_embedder = AsyncMock()
        mock_text_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])

        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_text_embedder)
        # Simulate sparse embedder not available
        mock_embedder_factory.get_sparse_embedder = AsyncMock(
            side_effect=ImportError("Sparse embedder not available")
        )

        mock_qdrant.client = MagicMock()
        mock_qdrant.client.upsert = AsyncMock()

        response = await client.post(
            "/v1/search/index-memory",
            json={
                "id": "01JGABCDEFGHIJKLMNOPQRSTUV",
                "content": "Test memory content",
                "type": "fact",
                "tags": [],
                "project": None,
                "source_session_id": None,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] is True

    async def test_index_memory_no_qdrant(self) -> None:
        """Test index-memory when Qdrant not initialized."""
        app = FastAPI()
        app.include_router(router)
        # No qdrant in state, but have embedder_factory
        app.state.embedder_factory = MagicMock()

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/index-memory",
                    json={
                        "id": "01JGABCDEFGHIJKLMNOPQRSTUV",
                        "content": "Test",
                        "type": "fact",
                        "tags": [],
                        "project": None,
                        "source_session_id": None,
                    },
                )

            assert response.status_code == 503
            assert "Qdrant not initialized" in response.json()["detail"]

    async def test_index_memory_no_embedder_factory(self) -> None:
        """Test index-memory when embedder factory not initialized."""
        app = FastAPI()
        app.include_router(router)
        # Have qdrant but no embedder_factory
        app.state.qdrant = MagicMock()

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/index-memory",
                    json={
                        "id": "01JGABCDEFGHIJKLMNOPQRSTUV",
                        "content": "Test",
                        "type": "fact",
                        "tags": [],
                        "project": None,
                        "source_session_id": None,
                    },
                )

            assert response.status_code == 503
            assert "embedder factory not initialized" in response.json()["detail"]

    async def test_index_memory_error(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test index-memory error handling."""
        mock_text_embedder = AsyncMock()
        mock_text_embedder.embed = AsyncMock(side_effect=Exception("Embedding failed"))
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_text_embedder)

        response = await client.post(
            "/v1/search/index-memory",
            json={
                "id": "01JGABCDEFGHIJKLMNOPQRSTUV",
                "content": "Test",
                "type": "fact",
                "tags": [],
                "project": None,
                "source_session_id": None,
            },
        )

        assert response.status_code == 500
        assert "Memory indexing failed" in response.json()["detail"]


class TestRecreateCollectionEndpoint:
    """Tests for /admin/{collection_name}/recreate endpoint."""

    async def test_recreate_memory_collection_success(
        self, client: AsyncClient, mock_qdrant
    ) -> None:
        """Test successful memory collection recreation."""
        # Mock SchemaManager
        with patch("src.api.routes.SchemaManager") as mock_schema_manager_cls:
            mock_schema_manager = MagicMock()
            mock_schema_manager.delete_collection = AsyncMock(return_value=True)
            mock_schema_manager.create_collection = AsyncMock()
            mock_schema_manager_cls.return_value = mock_schema_manager

            response = await client.post("/v1/search/admin/engram_memory/recreate")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["collection"] == "engram_memory"
            assert data["deleted"] is True
            assert data["created"] is True
            assert "schema" in data

            # Verify schema manager was called
            mock_schema_manager.delete_collection.assert_called_once_with("engram_memory")
            mock_schema_manager.create_collection.assert_called_once()

    async def test_recreate_turns_collection_success(
        self, client: AsyncClient, mock_qdrant
    ) -> None:
        """Test successful turns collection recreation."""
        with patch("src.api.routes.SchemaManager") as mock_schema_manager_cls:
            mock_schema_manager = MagicMock()
            mock_schema_manager.delete_collection = AsyncMock(return_value=False)
            mock_schema_manager.create_collection = AsyncMock()
            mock_schema_manager_cls.return_value = mock_schema_manager

            response = await client.post("/v1/search/admin/engram_turns/recreate")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["collection"] == "engram_turns"
            assert data["deleted"] is False
            assert data["created"] is True

    async def test_recreate_collection_invalid_name(self, client: AsyncClient) -> None:
        """Test recreation with invalid collection name."""
        response = await client.post("/v1/search/admin/invalid_collection/recreate")

        assert response.status_code == 400
        assert "Unknown collection" in response.json()["detail"]

    async def test_recreate_collection_no_qdrant(self) -> None:
        """Test recreation when Qdrant not initialized."""
        app = FastAPI()
        app.include_router(router)

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post("/v1/search/admin/engram_memory/recreate")

            assert response.status_code == 503
            assert "Qdrant not initialized" in response.json()["detail"]

    async def test_recreate_collection_error(self, client: AsyncClient, mock_qdrant) -> None:
        """Test recreation error handling."""
        with patch("src.api.routes.SchemaManager") as mock_schema_manager_cls:
            mock_schema_manager = MagicMock()
            mock_schema_manager.delete_collection = AsyncMock(
                side_effect=Exception("Delete failed")
            )
            mock_schema_manager_cls.return_value = mock_schema_manager

            response = await client.post("/v1/search/admin/engram_memory/recreate")

            assert response.status_code == 500
            assert "Collection recreate failed" in response.json()["detail"]


class TestSearchMemoryCollection:
    """Tests for searching the engram_memory collection directly."""

    async def test_search_memory_collection(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test search against engram_memory collection."""
        # Mock embedder
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        # Mock Qdrant query_points response
        mock_point = MagicMock()
        mock_point.id = "memory-123"
        mock_point.score = 0.95
        mock_point.payload = {"content": "test memory", "type": "fact"}

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = [mock_point]
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
                "collection": "engram_memory",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert len(data["results"]) == 1
        assert data["results"][0]["id"] == "memory-123"
        assert data["results"][0]["score"] == 0.95
        assert data["results"][0]["payload"]["content"] == "test memory"
        assert "took_ms" in data

        # Verify query_points was called with correct params
        mock_qdrant.client.query_points.assert_called_once()
        call_args = mock_qdrant.client.query_points.call_args
        assert call_args.kwargs["collection_name"] == "engram_memory"
        assert call_args.kwargs["limit"] == 10

    async def test_search_other_collection(
        self, client: AsyncClient, mock_search_retriever
    ) -> None:
        """Test search against a non-default collection."""
        mock_search_retriever.search.return_value = []

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
                "collection": "custom_collection",
            },
        )

        assert response.status_code == 200
        # Should call generic search method for unknown collections
        mock_search_retriever.search.assert_called_once()

    async def test_search_default_collection(
        self, client: AsyncClient, mock_search_retriever
    ) -> None:
        """Test search uses engram_turns by default."""
        mock_search_retriever.search_turns.return_value = []

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
            },
        )

        assert response.status_code == 200
        # Should call search_turns for default collection
        mock_search_retriever.search_turns.assert_called_once()


class TestMultiQueryWithTimeRange:
    """Tests for multi-query search with time range filters."""

    async def test_multi_query_with_time_range(
        self, client: AsyncClient, mock_multi_query_retriever
    ) -> None:
        """Test multi-query with time range in filters."""
        mock_multi_query_retriever.search.return_value = []

        response = await client.post(
            "/v1/search/multi-query",
            json={
                "text": "test",
                "limit": 10,
                "threshold": 0.5,
                "filters": {
                    "time_range": {"start": 1000000, "end": 2000000},
                },
            },
        )

        assert response.status_code == 200
        # Verify the query was built with time range
        mock_multi_query_retriever.search.assert_called_once()
        call_args = mock_multi_query_retriever.search.call_args
        query_arg = call_args.args[0]
        assert query_arg.filters is not None
        assert query_arg.filters.time_range is not None
        assert query_arg.filters.time_range.start == 1000000
        assert query_arg.filters.time_range.end == 2000000


class TestMemoryCollectionTypeFiltering:
    """Tests for type filtering in engram_memory collection."""

    async def test_search_memory_with_type_filter(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test that type filter is applied to memory collection search."""
        from qdrant_client.http import models

        # Mock embedder
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        # Mock Qdrant query_points response
        mock_point = MagicMock()
        mock_point.id = "decision-memory-123"
        mock_point.score = 0.95
        mock_point.payload = {"content": "test decision", "type": "decision"}

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = [mock_point]
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "architecture decisions",
                "limit": 10,
                "collection": "engram_memory",
                "filters": {
                    "type": "decision",
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

        # Verify query_points was called with type filter
        mock_qdrant.client.query_points.assert_called_once()
        call_args = mock_qdrant.client.query_points.call_args

        # Check that query_filter was passed with type condition
        query_filter = call_args.kwargs.get("query_filter")
        assert query_filter is not None
        assert isinstance(query_filter, models.Filter)
        assert query_filter.must is not None

        # Find the type filter condition
        type_condition_found = False
        for condition in query_filter.must:
            if isinstance(condition, models.FieldCondition) and condition.key == "type":
                assert condition.match.value == "decision"
                type_condition_found = True

        assert type_condition_found, "Type filter condition not found in query"

    async def test_search_memory_with_vt_end_after_filter(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test that vt_end_after filter is applied to memory collection search."""
        from qdrant_client.http import models

        # Mock embedder
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = []
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        vt_end_timestamp = 1704067200000  # 2024-01-01

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "test query",
                "limit": 10,
                "collection": "engram_memory",
                "filters": {
                    "vt_end_after": vt_end_timestamp,
                },
            },
        )

        assert response.status_code == 200

        # Verify query_points was called with vt_end filter
        mock_qdrant.client.query_points.assert_called_once()
        call_args = mock_qdrant.client.query_points.call_args

        query_filter = call_args.kwargs.get("query_filter")
        assert query_filter is not None

        # Find the vt_end filter condition
        vt_end_condition_found = False
        for condition in query_filter.must:
            if isinstance(condition, models.FieldCondition) and condition.key == "vt_end":
                assert condition.range.gt == vt_end_timestamp
                vt_end_condition_found = True

        assert vt_end_condition_found, "vt_end filter condition not found in query"

    async def test_search_memory_with_all_filters(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test memory collection search with multiple filters combined."""
        from qdrant_client.http import models

        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = []
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/query",
            json={
                "text": "architecture",
                "limit": 10,
                "collection": "engram_memory",
                "filters": {
                    "type": "decision",
                    "project": "engram",
                    "vt_end_after": 1704067200000,
                    "time_range": {"start": 1704000000000, "end": 1705000000000},
                },
            },
        )

        assert response.status_code == 200

        # Verify query was called with all filters
        mock_qdrant.client.query_points.assert_called_once()
        call_args = mock_qdrant.client.query_points.call_args

        query_filter = call_args.kwargs.get("query_filter")
        assert query_filter is not None

        # Count the filter conditions (should have org_id, type, project, vt_end, timestamp)
        condition_keys = set()
        for condition in query_filter.must:
            if isinstance(condition, models.FieldCondition):
                condition_keys.add(condition.key)

        # org_id is always added from auth context
        assert "org_id" in condition_keys, "org_id filter missing"
        assert "type" in condition_keys, "type filter missing"
        assert "vt_end" in condition_keys, "vt_end filter missing"
        assert "project" in condition_keys, "project filter missing"
        assert "timestamp" in condition_keys, "timestamp filter missing"


class TestConflictCandidatesEndpoint:
    """Tests for /conflict-candidates endpoint."""

    async def test_conflict_candidates_success(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test successful conflict candidate search."""
        # Mock embedder
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        # Mock Qdrant query_points response with conflict candidates
        mock_point1 = MagicMock()
        mock_point1.id = "candidate-1"
        mock_point1.score = 0.92
        mock_point1.payload = {
            "node_id": "01JGABCD1111111111111111111",
            "content": "Similar memory content",
            "type": "fact",
            "vt_start": 1704067200000,
        }

        mock_point2 = MagicMock()
        mock_point2.id = "candidate-2"
        mock_point2.score = 0.78
        mock_point2.payload = {
            "node_id": "01JGABCD2222222222222222222",
            "content": "Another similar memory",
            "type": "decision",
            "vt_start": 1704153600000,
        }

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = [mock_point1, mock_point2]
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={
                "content": "Test memory content for deduplication",
                "project": "engram",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["id"] == "01JGABCD1111111111111111111"
        assert data[0]["score"] == 0.92
        assert data[0]["content"] == "Similar memory content"
        assert data[0]["type"] == "fact"
        assert data[1]["id"] == "01JGABCD2222222222222222222"
        assert data[1]["score"] == 0.78

        # Verify query_points was called with correct params
        mock_qdrant.client.query_points.assert_called_once()
        call_args = mock_qdrant.client.query_points.call_args
        assert call_args.kwargs["collection_name"] == "engram_memory"
        assert call_args.kwargs["limit"] == 10
        assert call_args.kwargs["score_threshold"] == 0.65
        assert call_args.kwargs["with_payload"] is True

    async def test_conflict_candidates_no_project_filter(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search without project filter."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = []
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={
                "content": "Test memory content",
                # No project filter
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 0

        # Verify org_id filter is still applied (mandatory)
        call_args = mock_qdrant.client.query_points.call_args
        query_filter = call_args.kwargs.get("query_filter")
        assert query_filter is not None

        # Should only have org_id condition (no project)
        assert len(query_filter.must) == 1
        assert query_filter.must[0].key == "org_id"

    async def test_conflict_candidates_with_project_filter(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search applies project filter correctly."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = []
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={
                "content": "Test memory content",
                "project": "my-project",
            },
        )

        assert response.status_code == 200

        # Verify both org_id and project filters are applied
        call_args = mock_qdrant.client.query_points.call_args
        query_filter = call_args.kwargs.get("query_filter")
        assert query_filter is not None
        assert len(query_filter.must) == 2

        # Find conditions by key
        condition_keys = {c.key for c in query_filter.must}
        assert "org_id" in condition_keys
        assert "project" in condition_keys

        # Verify project value
        for condition in query_filter.must:
            if condition.key == "project":
                assert condition.match.value == "my-project"

    async def test_conflict_candidates_no_embedder_factory(self) -> None:
        """Test conflict search when embedder factory not initialized."""
        app = FastAPI()
        app.include_router(router)
        # Have qdrant but no embedder_factory
        app.state.qdrant = MagicMock()

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/conflict-candidates",
                    json={"content": "Test content"},
                )

            assert response.status_code == 503
            assert "embedder factory not initialized" in response.json()["detail"]

    async def test_conflict_candidates_no_qdrant(self) -> None:
        """Test conflict search when Qdrant not initialized."""
        app = FastAPI()
        app.include_router(router)
        # Have embedder_factory but no qdrant
        app.state.embedder_factory = MagicMock()

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=MOCK_AUTH_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={
                    "Authorization": "Bearer egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"
                },
            ) as client:
                response = await client.post(
                    "/v1/search/conflict-candidates",
                    json={"content": "Test content"},
                )

            assert response.status_code == 503
            assert "Qdrant not initialized" in response.json()["detail"]

    async def test_conflict_candidates_embedding_error(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search handles embedding errors."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(side_effect=Exception("Embedding failed"))
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={"content": "Test content"},
        )

        assert response.status_code == 500
        assert "Conflict candidate search failed" in response.json()["detail"]

    async def test_conflict_candidates_qdrant_error(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search handles Qdrant query errors."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(side_effect=Exception("Qdrant error"))

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={"content": "Test content"},
        )

        assert response.status_code == 500
        assert "Conflict candidate search failed" in response.json()["detail"]

    async def test_conflict_candidates_uses_correct_threshold(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search uses score_threshold=0.65."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = []
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        await client.post(
            "/v1/search/conflict-candidates",
            json={"content": "Test content"},
        )

        # Verify threshold is 0.65 as specified in routes.py
        call_args = mock_qdrant.client.query_points.call_args
        assert call_args.kwargs["score_threshold"] == 0.65

    async def test_conflict_candidates_fallback_to_point_id(
        self, client: AsyncClient, mock_qdrant, mock_embedder_factory
    ) -> None:
        """Test conflict search falls back to point ID when node_id is missing."""
        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
        mock_embedder_factory.get_embedder = AsyncMock(return_value=mock_embedder)

        # Point without node_id in payload
        mock_point = MagicMock()
        mock_point.id = "fallback-uuid"
        mock_point.score = 0.80
        mock_point.payload = {
            "content": "Memory without node_id",
            "type": "context",
            # No node_id
        }

        mock_qdrant_result = MagicMock()
        mock_qdrant_result.points = [mock_point]
        mock_qdrant.client = MagicMock()
        mock_qdrant.client.query_points = AsyncMock(return_value=mock_qdrant_result)

        response = await client.post(
            "/v1/search/conflict-candidates",
            json={"content": "Test content"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        # Should fall back to point.id when node_id is missing
        assert data[0]["id"] == "fallback-uuid"
        assert data[0]["type"] == "context"
        # vt_start defaults to 0 when missing
        assert data[0]["vt_start"] == 0
