"""Tests for the SearchRetriever class."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.config import Settings
from src.retrieval import (
    SearchQuery,
    SearchRetriever,
    SearchStrategy,
)


@pytest.fixture
def mock_settings() -> Settings:
    """Create mock settings for testing."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_collection="test_collection",
        embedder_device="cpu",
    )


@pytest.fixture
def mock_qdrant_client() -> MagicMock:
    """Create a mock Qdrant client."""
    client = MagicMock()
    client.client = AsyncMock()
    return client


@pytest.fixture
def mock_embedder_factory() -> MagicMock:
    """Create a mock embedder factory."""
    factory = MagicMock()

    # Mock text embedder
    text_embedder = MagicMock()
    text_embedder.embed = AsyncMock(return_value=[0.1] * 768)
    factory.get_text_embedder = AsyncMock(return_value=text_embedder)

    # Mock code embedder
    code_embedder = MagicMock()
    code_embedder.embed = AsyncMock(return_value=[0.2] * 768)
    factory.get_code_embedder = AsyncMock(return_value=code_embedder)

    # Mock sparse embedder (embed_sparse is sync, called via asyncio.to_thread)
    sparse_embedder = MagicMock()
    sparse_embedder.embed_sparse = MagicMock(return_value={1: 0.5, 10: 0.3, 100: 0.2})
    factory.get_sparse_embedder = AsyncMock(return_value=sparse_embedder)

    return factory


@pytest.fixture
def mock_reranker_router() -> MagicMock:
    """Create a mock reranker router."""
    router = MagicMock()
    return router


@pytest.fixture
def retriever(
    mock_qdrant_client: MagicMock,
    mock_embedder_factory: MagicMock,
    mock_reranker_router: MagicMock,
    mock_settings: Settings,
) -> SearchRetriever:
    """Create a SearchRetriever with mocked dependencies."""
    return SearchRetriever(
        qdrant_client=mock_qdrant_client,
        embedder_factory=mock_embedder_factory,
        reranker_router=mock_reranker_router,
        settings=mock_settings,
    )


class TestSearchRetriever:
    """Tests for SearchRetriever."""

    @pytest.mark.asyncio
    async def test_search_dense_strategy(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test dense search strategy."""
        # Setup mock response
        mock_result = MagicMock()
        mock_result.id = "test-id-1"
        mock_result.score = 0.95
        mock_result.payload = {"content": "test content", "session_id": "session-1"}

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Execute search
        query = SearchQuery(
            text="test query",
            limit=10,
            strategy=SearchStrategy.DENSE,
            rerank=False,
        )
        results = await retriever.search(query)

        # Verify
        assert len(results) == 1
        assert results[0].id == "test-id-1"
        assert results[0].score == 0.95
        mock_qdrant_client.client.query_points.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_sparse_strategy(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test sparse search strategy."""
        # Setup mock response
        mock_result = MagicMock()
        mock_result.id = "test-id-2"
        mock_result.score = 0.8
        mock_result.payload = {"content": "sparse result"}

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Execute search
        query = SearchQuery(
            text="exact keyword search",
            limit=5,
            strategy=SearchStrategy.SPARSE,
            rerank=False,
        )
        results = await retriever.search(query)

        # Verify
        assert len(results) == 1
        assert results[0].id == "test-id-2"

    @pytest.mark.asyncio
    async def test_search_hybrid_strategy(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test hybrid search with RRF fusion."""
        # Setup mock response
        mock_result = MagicMock()
        mock_result.id = "test-id-3"
        mock_result.score = 0.85
        mock_result.payload = {"content": "hybrid result"}

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Execute search
        query = SearchQuery(
            text="semantic and keyword search",
            limit=10,
            strategy=SearchStrategy.HYBRID,
            rerank=False,
        )
        results = await retriever.search(query)

        # Verify - hybrid uses prefetch
        assert len(results) == 1
        call_args = mock_qdrant_client.client.query_points.call_args
        assert call_args.kwargs.get("prefetch") is not None

    @pytest.mark.asyncio
    async def test_search_with_reranking(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test search with reranking enabled."""
        # Setup mock Qdrant response with multiple results
        mock_results = []
        for i in range(5):
            result = MagicMock()
            result.id = f"id-{i}"
            result.score = 0.9 - (i * 0.1)
            result.payload = {"content": f"content {i}"}
            mock_results.append(result)

        mock_response = MagicMock()
        mock_response.points = mock_results
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Setup mock reranker response
        reranked_results = [
            MagicMock(original_index=2, score=0.98),
            MagicMock(original_index=0, score=0.95),
            MagicMock(original_index=4, score=0.90),
        ]
        mock_reranker_router.rerank = AsyncMock(return_value=(reranked_results, "fast", False))

        # Execute search
        query = SearchQuery(
            text="test query",
            limit=3,
            rerank=True,
            rerank_tier="fast",
            rerank_depth=10,
        )
        results = await retriever.search(query)

        # Verify reranking was called
        mock_reranker_router.rerank.assert_called_once()
        assert len(results) == 3
        # Verify scores come from reranker
        assert results[0].score == 0.98

    @pytest.mark.asyncio
    async def test_search_auto_strategy_selection(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test that strategy is auto-selected when not provided."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Query without explicit strategy - should use classifier
        query = SearchQuery(
            text="how do I implement this feature?",
            limit=5,
            strategy=None,
            rerank=False,
        )
        await retriever.search(query)

        # Verify search was called (strategy was determined)
        mock_qdrant_client.client.query_points.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_with_filters(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test search with session_id and type filters."""
        from src.retrieval.types import SearchFilters

        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Query with filters
        query = SearchQuery(
            text="test query",
            limit=5,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(
                session_id="session-123",
                type="thought",
            ),
            rerank=False,
        )
        await retriever.search(query)

        # Verify filter was passed
        call_args = mock_qdrant_client.client.query_points.call_args
        assert call_args.kwargs.get("query_filter") is not None

    @pytest.mark.asyncio
    async def test_search_empty_results(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test search returns empty list when no matches."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="nonexistent query",
            limit=10,
            rerank=False,
        )
        results = await retriever.search(query)

        assert results == []

    @pytest.mark.asyncio
    async def test_search_reranker_fallback_on_error(
        self,
        retriever: SearchRetriever,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test graceful degradation when reranker fails."""
        # Setup mock Qdrant response
        mock_result = MagicMock()
        mock_result.id = "test-id"
        mock_result.score = 0.9
        mock_result.payload = {"content": "test"}

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Make reranker throw an exception
        mock_reranker_router.rerank = AsyncMock(side_effect=Exception("Reranker failed"))

        query = SearchQuery(
            text="test query",
            limit=5,
            rerank=True,
        )
        results = await retriever.search(query)

        # Should still get results with degraded flag
        assert len(results) == 1
        assert results[0].degraded is True
        assert "Reranker failed" in (results[0].degraded_reason or "")
