"""
Tests for Engram search client.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from engram_benchmark.providers.engram import (
    EngramSearchClient,
    HealthResponse,
    SearchFilters,
    SearchResponse,
    SearchResult,
)


@pytest.fixture
def mock_health_response() -> dict[str, bool | str]:
    """Mock health response."""
    return {
        "status": "healthy",
        "version": "0.1.0",
        "qdrant_connected": True,
    }


@pytest.fixture
def mock_search_response() -> dict[str, list[dict[str, str | float | dict[str, str]]] | int]:
    """Mock search response."""
    return {
        "results": [
            {
                "id": "result_1",
                "score": 0.95,
                "rrf_score": 0.92,
                "reranker_score": 0.98,
                "rerank_tier": "accurate",
                "payload": {
                    "content": "Paris is the capital of France.",
                    "session_id": "session_001",
                    "turn_index": 5,
                    "has_answer": True,
                },
                "degraded": False,
            },
            {
                "id": "result_2",
                "score": 0.87,
                "rrf_score": None,
                "reranker_score": None,
                "rerank_tier": None,
                "payload": {
                    "content": "France is in Europe.",
                    "session_id": "session_001",
                    "turn_index": 3,
                    "has_answer": False,
                },
                "degraded": False,
            },
        ],
        "total": 2,
        "took_ms": 125,
    }


class TestEngramSearchClient:
    """Tests for EngramSearchClient."""

    def test_initialization(self) -> None:
        """Test client initialization."""
        client = EngramSearchClient(base_url="http://localhost:5002", timeout=60.0)

        assert client.base_url == "http://localhost:5002"
        assert client.timeout == 60.0

    def test_base_url_trailing_slash_stripped(self) -> None:
        """Test that trailing slash is removed from base URL."""
        client = EngramSearchClient(base_url="http://localhost:5002/")

        assert client.base_url == "http://localhost:5002"

    @pytest.mark.asyncio
    async def test_health_check(self, mock_health_response: dict[str, bool | str]) -> None:
        """Test health check endpoint."""
        client = EngramSearchClient()

        with patch.object(client._client, "get", new_callable=AsyncMock) as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_health_response
            mock_get.return_value = mock_response

            health = await client.health()

            assert isinstance(health, HealthResponse)
            assert health.status == "healthy"
            assert health.version == "0.1.0"
            assert health.qdrant_connected is True

            mock_get.assert_called_once_with("/health")
            mock_response.raise_for_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_ready_check(self) -> None:
        """Test readiness check endpoint."""
        client = EngramSearchClient()

        with patch.object(client._client, "get", new_callable=AsyncMock) as mock_get:
            mock_response = MagicMock()
            mock_response.json.return_value = {"status": "ready"}
            mock_get.return_value = mock_response

            ready = await client.ready()

            assert ready == {"status": "ready"}

            mock_get.assert_called_once_with("/ready")
            mock_response.raise_for_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_basic(
        self, mock_search_response: dict[str, list[dict[str, str | float | dict[str, str]]] | int]
    ) -> None:
        """Test basic search request."""
        client = EngramSearchClient()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_search_response
            mock_post.return_value = mock_response

            response = await client.search(text="What is the capital of France?", limit=5)

            assert isinstance(response, SearchResponse)
            assert len(response.results) == 2
            assert response.total == 2
            assert response.took_ms == 125

            # Verify first result
            result = response.results[0]
            assert isinstance(result, SearchResult)
            assert result.id == "result_1"
            assert result.score == 0.95
            assert result.reranker_score == 0.98
            assert result.payload["content"] == "Paris is the capital of France."

            # Verify API call
            mock_post.assert_called_once()
            call_args = mock_post.call_args
            assert call_args[0][0] == "/search"
            assert "json" in call_args[1]

            request_data = call_args[1]["json"]
            assert request_data["text"] == "What is the capital of France?"
            assert request_data["limit"] == 5

    @pytest.mark.asyncio
    async def test_search_with_filters(
        self, mock_search_response: dict[str, list[dict[str, str | float | dict[str, str]]] | int]
    ) -> None:
        """Test search with filters."""
        client = EngramSearchClient()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_search_response
            mock_post.return_value = mock_response

            filters = SearchFilters(
                session_id="session_001",
                type="thought",
                time_range={"start": 1000, "end": 2000},
            )

            await client.search(text="test query", filters=filters)

            call_args = mock_post.call_args
            request_data = call_args[1]["json"]

            assert "filters" in request_data
            assert request_data["filters"]["session_id"] == "session_001"
            assert request_data["filters"]["type"] == "thought"

    @pytest.mark.asyncio
    async def test_search_with_reranking(
        self, mock_search_response: dict[str, list[dict[str, str | float | dict[str, str]]] | int]
    ) -> None:
        """Test search with reranking enabled."""
        client = EngramSearchClient()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_search_response
            mock_post.return_value = mock_response

            await client.search(
                text="test query",
                strategy="hybrid",
                rerank=True,
                rerank_tier="accurate",
                rerank_depth=50,
            )

            call_args = mock_post.call_args
            request_data = call_args[1]["json"]

            assert request_data["strategy"] == "hybrid"
            assert request_data["rerank"] is True
            assert request_data["rerank_tier"] == "accurate"
            assert request_data["rerank_depth"] == 50

    @pytest.mark.asyncio
    async def test_search_error_handling(self) -> None:
        """Test that search raises HTTPError on API errors."""
        client = EngramSearchClient()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Internal Server Error",
                request=MagicMock(),
                response=MagicMock(status_code=500),
            )
            mock_post.return_value = mock_response

            with pytest.raises(httpx.HTTPStatusError):
                await client.search(text="test")

    @pytest.mark.asyncio
    async def test_close(self) -> None:
        """Test client closure."""
        client = EngramSearchClient()

        with patch.object(client._client, "aclose", new_callable=AsyncMock) as mock_close:
            await client.close()

            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_context_manager(self, mock_health_response: dict[str, bool | str]) -> None:
        """Test async context manager."""
        with patch("httpx.AsyncClient") as mock_async_client:
            mock_client_instance = AsyncMock()
            mock_async_client.return_value = mock_client_instance

            mock_response = MagicMock()
            mock_response.json.return_value = mock_health_response
            mock_client_instance.get.return_value = mock_response

            async with EngramSearchClient() as client:
                await client.health()

            # Verify close was called
            mock_client_instance.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_excludes_none_values(
        self, mock_search_response: dict[str, list[dict[str, str | float | dict[str, str]]] | int]
    ) -> None:
        """Test that None values are excluded from request payload."""
        client = EngramSearchClient()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_response = MagicMock()
            mock_response.json.return_value = mock_search_response
            mock_post.return_value = mock_response

            # Call with default values (many will be None)
            await client.search(text="test query")

            call_args = mock_post.call_args
            request_data = call_args[1]["json"]

            # None values should be excluded
            assert "strategy" not in request_data
            assert "filters" not in request_data
            assert "rerank_tier" not in request_data

            # Non-None values should be present
            assert "text" in request_data
            assert "limit" in request_data
            assert "rerank" in request_data
