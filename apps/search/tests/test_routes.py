"""Comprehensive tests for API routes."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.api.router import router
from src.middleware.auth import ApiKeyContext
from src.retrieval.types import RerankerTier

# Mock auth context for authenticated requests
MOCK_API_KEY_CONTEXT = ApiKeyContext(
    id="test-key-id",
    prefix="engram_test_abc123...",
    method="api_key",
    type="test",
    user_id="test-user",
    scopes=["memory:read", "memory:write", "search:read"],
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
    # Mock the auth handler to return a valid context
    mock_handler = AsyncMock()
    mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

    with patch("src.middleware.auth._auth_handler", mock_handler):
        transport = ASGITransport(app=app_with_mocks)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
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
        mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
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
        mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
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
        mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
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
        mock_handler.validate = AsyncMock(return_value=MOCK_API_KEY_CONTEXT)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": "Bearer engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
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
