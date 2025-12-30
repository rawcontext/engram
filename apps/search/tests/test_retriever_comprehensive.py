"""Comprehensive tests for the SearchRetriever class.

This test suite provides comprehensive coverage of SearchRetriever functionality:
- All search strategies (dense, sparse, hybrid)
- Turn-level search methods
- Reranking with various tiers
- Aggregation and deduplication
- Error handling and fallback scenarios
- Filter handling
- Strategy auto-selection
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http import models

from src.config import Settings
from src.retrieval import (
    SearchQuery,
    SearchRetriever,
    SearchStrategy,
)
from src.retrieval.types import SearchFilters, SearchResultItem, TimeRange


@pytest.fixture
def mock_settings() -> Settings:
    """Create mock settings for testing."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_collection="test_collection",
        embedder_device="cpu",
        search_min_score_dense=0.5,
        search_min_score_sparse=0.4,
        search_min_score_hybrid=0.3,
        reranker_timeout_ms=5000,
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


@pytest.fixture
def test_filters() -> SearchFilters:
    """Create test filters with required org_id."""
    return SearchFilters(org_id="test-org-123")


def create_mock_point(point_id: str | int, score: float, payload: dict[str, Any]) -> MagicMock:
    """Helper to create a mock Qdrant ScoredPoint."""
    point = MagicMock()
    point.id = point_id
    point.score = score
    point.payload = payload
    return point


class TestSearchRetrieverDense:
    """Test dense search strategy."""

    @pytest.mark.asyncio
    async def test_search_dense_basic(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test basic dense search."""
        mock_result = create_mock_point(
            "test-id-1", 0.95, {"content": "test content", "session_id": "session-1"}
        )

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test query",
            limit=10,
            strategy=SearchStrategy.DENSE,
            rerank=False,
            filters=test_filters,
        )
        results = await retriever.search(query)

        assert len(results) == 1
        assert results[0].id == "test-id-1"
        assert results[0].score == 0.95
        mock_qdrant_client.client.query_points.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_dense_code_filter(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test dense search with code type filter uses code embedder."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="function definition",
            limit=10,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(org_id="test-org-123", type="code"),
            rerank=False,
        )
        await retriever.search(query)

        # Verify code embedder was used
        mock_embedder_factory.get_code_embedder.assert_called_once()
        # Verify text embedder was NOT used
        mock_embedder_factory.get_text_embedder.assert_not_called()

    @pytest.mark.asyncio
    async def test_search_dense_threshold(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test dense search applies custom threshold."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        custom_threshold = 0.8
        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.DENSE,
            threshold=custom_threshold,
            rerank=False,
            filters=test_filters,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        assert call_args.kwargs["score_threshold"] == custom_threshold


class TestSearchRetrieverSparse:
    """Test sparse search strategy."""

    @pytest.mark.asyncio
    async def test_search_sparse_basic(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test basic sparse search."""
        mock_result = create_mock_point("test-id-2", 0.8, {"content": "sparse result"})

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="exact keyword search",
            limit=5,
            strategy=SearchStrategy.SPARSE,
            rerank=False,
            filters=test_filters,
        )
        results = await retriever.search(query)

        assert len(results) == 1
        assert results[0].id == "test-id-2"

    @pytest.mark.asyncio
    async def test_search_sparse_vector_format(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test sparse search creates correct Qdrant SparseVector format."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Set up sparse embedder to return known indices/values
        sparse_embedder = await mock_embedder_factory.get_sparse_embedder()
        sparse_embedder.embed_sparse.return_value = {5: 0.9, 15: 0.7, 25: 0.5}

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.SPARSE,
            rerank=False,
            filters=test_filters,
        )
        await retriever.search(query)

        # Verify query_points was called with SparseVector
        call_args = mock_qdrant_client.client.query_points.call_args
        query_param = call_args.kwargs["query"]
        assert isinstance(query_param, models.SparseVector)
        assert query_param.indices == [5, 15, 25]
        assert query_param.values == [0.9, 0.7, 0.5]


class TestSearchRetrieverHybrid:
    """Test hybrid search strategy."""

    @pytest.mark.asyncio
    async def test_search_hybrid_basic(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test hybrid search with RRF fusion."""
        mock_result = create_mock_point("test-id-3", 0.85, {"content": "hybrid result"})

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="semantic and keyword search",
            limit=10,
            strategy=SearchStrategy.HYBRID,
            rerank=False,
            filters=test_filters,
        )
        results = await retriever.search(query)

        # Verify hybrid uses prefetch
        assert len(results) == 1
        call_args = mock_qdrant_client.client.query_points.call_args
        assert call_args.kwargs.get("prefetch") is not None
        assert len(call_args.kwargs["prefetch"]) == 2  # Dense + Sparse

    @pytest.mark.asyncio
    async def test_search_hybrid_rrf_fusion_query(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test hybrid search uses RRF fusion query."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.HYBRID,
            rerank=False,
            filters=test_filters,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        query_param = call_args.kwargs["query"]
        assert isinstance(query_param, models.FusionQuery)
        assert query_param.fusion == models.Fusion.RRF

    @pytest.mark.asyncio
    async def test_search_hybrid_code_filter(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_embedder_factory: MagicMock,
    ) -> None:
        """Test hybrid search with code filter uses code embedder."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="code search",
            limit=10,
            strategy=SearchStrategy.HYBRID,
            filters=SearchFilters(org_id="test-org-123", type="code"),
            rerank=False,
        )
        await retriever.search(query)

        # Verify code embedder was used
        mock_embedder_factory.get_code_embedder.assert_called_once()


class TestSearchRetrieverReranking:
    """Test reranking functionality."""

    @pytest.mark.asyncio
    async def test_search_with_reranking_basic(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test search with reranking enabled."""
        # Setup mock Qdrant response with multiple results
        mock_results = [
            create_mock_point(f"id-{i}", 0.9 - (i * 0.1), {"content": f"content {i}"})
            for i in range(5)
        ]

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

        query = SearchQuery(
            text="test query",
            limit=3,
            rerank=True,
            rerank_tier="fast",
            rerank_depth=10,
            filters=test_filters,
        )
        results = await retriever.search(query)

        mock_reranker_router.rerank.assert_called_once()
        assert len(results) == 3
        assert results[0].score == 0.98
        assert results[0].reranker_score == 0.98
        assert results[0].rerank_tier == "fast"

    @pytest.mark.asyncio
    async def test_search_reranking_oversample(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test that reranking fetches rerank_depth results."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=5,
            rerank=True,
            rerank_depth=20,
            rerank_tier="fast",
            filters=test_filters,
        )
        await retriever.search(query)

        # Verify we fetched rerank_depth results
        call_args = mock_qdrant_client.client.query_points.call_args
        assert call_args.kwargs["limit"] == 20

    @pytest.mark.asyncio
    async def test_search_reranking_timeout(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test reranking timeout parameter is passed."""
        mock_result = create_mock_point("id-1", 0.9, {"content": "test"})
        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        reranked = [MagicMock(original_index=0, score=0.95)]
        mock_reranker_router.rerank = AsyncMock(return_value=(reranked, "fast", False))

        query = SearchQuery(text="test", limit=5, rerank=True, filters=test_filters)
        await retriever.search(query)

        # Verify timeout was passed to reranker
        call_args = mock_reranker_router.rerank.call_args
        assert call_args.kwargs["timeout_ms"] == retriever.settings.reranker_timeout_ms

    @pytest.mark.asyncio
    async def test_search_reranker_auto_tier_selection(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test auto-selection of reranker tier based on query complexity."""
        mock_result = create_mock_point("id-1", 0.9, {"content": "test"})
        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        reranked = [MagicMock(original_index=0, score=0.95)]
        mock_reranker_router.rerank = AsyncMock(return_value=(reranked, "fast", False))

        # Query without explicit tier - should auto-select
        query = SearchQuery(
            text="simple query", limit=5, rerank=True, rerank_tier=None, filters=test_filters
        )
        await retriever.search(query)

        # Verify reranker was called (tier was auto-selected)
        mock_reranker_router.rerank.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_reranker_degraded_flag(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test degraded flag is set when reranker falls back to lower tier."""
        mock_result = create_mock_point("id-1", 0.9, {"content": "test"})
        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Simulate degraded reranking (tier downgrade)
        reranked = [MagicMock(original_index=0, score=0.95)]
        mock_reranker_router.rerank = AsyncMock(
            return_value=(reranked, "fast", True)
        )  # degraded=True

        query = SearchQuery(
            text="test", limit=5, rerank=True, rerank_tier="accurate", filters=test_filters
        )
        results = await retriever.search(query)

        assert results[0].degraded is True

    @pytest.mark.asyncio
    async def test_search_reranker_fallback_on_error(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test graceful degradation when reranker fails."""
        mock_result = create_mock_point("test-id", 0.9, {"content": "test"})

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Make reranker throw an exception
        mock_reranker_router.rerank = AsyncMock(side_effect=Exception("Reranker failed"))

        query = SearchQuery(text="test query", limit=5, rerank=True, filters=test_filters)
        results = await retriever.search(query)

        # Should still get results with degraded flag
        assert len(results) == 1
        assert results[0].degraded is True
        assert "Reranker failed" in (results[0].degraded_reason or "")


class TestSearchRetrieverTurns:
    """Test turn-level search methods."""

    @pytest.mark.asyncio
    async def test_search_turns_dense(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test turn-level dense search."""
        mock_result = create_mock_point("turn-1", 0.9, {"content": "turn content"})
        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test", limit=10, strategy=SearchStrategy.DENSE, rerank=False, filters=test_filters
        )
        results = await retriever.search_turns(query)

        assert len(results) == 1
        assert results[0].id == "turn-1"


class TestSearchRetrieverAggregation:
    """Test result aggregation and deduplication."""

    def test_aggregate_by_session_basic(self, retriever: SearchRetriever) -> None:
        """Test basic session aggregation."""
        results = [
            SearchResultItem(id="1", score=0.95, payload={"session_id": "s1"}),
            SearchResultItem(id="2", score=0.90, payload={"session_id": "s1"}),
            SearchResultItem(id="3", score=0.85, payload={"session_id": "s1"}),
            SearchResultItem(id="4", score=0.80, payload={"session_id": "s1"}),
            SearchResultItem(id="5", score=0.75, payload={"session_id": "s2"}),
        ]

        aggregated = retriever.aggregate_by_session(results, max_per_session=3, min_sessions=2)

        # Should limit s1 to 3 results
        s1_results = [r for r in aggregated if r.payload.get("session_id") == "s1"]
        assert len(s1_results) <= 3

    def test_aggregate_by_session_round_robin(self, retriever: SearchRetriever) -> None:
        """Test round-robin session aggregation for diversity."""
        results = [
            SearchResultItem(id="s1-1", score=0.95, payload={"session_id": "s1"}),
            SearchResultItem(id="s1-2", score=0.90, payload={"session_id": "s1"}),
            SearchResultItem(id="s2-1", score=0.85, payload={"session_id": "s2"}),
            SearchResultItem(id="s2-2", score=0.80, payload={"session_id": "s2"}),
        ]

        aggregated = retriever.aggregate_by_session(results, max_per_session=1, min_sessions=2)

        # Should have results from both sessions
        session_ids = {r.payload.get("session_id") for r in aggregated}
        assert "s1" in session_ids
        assert "s2" in session_ids

    def test_aggregate_by_session_no_session_id(self, retriever: SearchRetriever) -> None:
        """Test aggregation handles results without session_id."""
        results = [
            SearchResultItem(id="1", score=0.95, payload={"session_id": "s1"}),
            SearchResultItem(id="2", score=0.90, payload={}),  # No session_id
        ]

        aggregated = retriever.aggregate_by_session(results)

        # All results should be present
        assert len(aggregated) == 2

    def test_deduplicate_results_by_id(self, retriever: SearchRetriever) -> None:
        """Test deduplication by ID."""
        results = [
            SearchResultItem(id="1", score=0.95, payload={"content": "test"}),
            SearchResultItem(id="1", score=0.80, payload={"content": "test"}),  # Duplicate ID
            SearchResultItem(id="2", score=0.85, payload={"content": "other"}),
        ]

        deduped = retriever.deduplicate_results(results)

        # Should keep only unique IDs
        assert len(deduped) == 2
        ids = {r.id for r in deduped}
        assert ids == {"1", "2"}
        # Should keep highest-scored duplicate
        id1_result = next(r for r in deduped if r.id == "1")
        assert id1_result.score == 0.95

    def test_deduplicate_results_by_content(self, retriever: SearchRetriever) -> None:
        """Test deduplication by content similarity."""
        results = [
            SearchResultItem(id="1", score=0.95, payload={"content": "This is test content"}),
            SearchResultItem(
                id="2", score=0.90, payload={"content": "This is test content"}
            ),  # Same content
            SearchResultItem(id="3", score=0.85, payload={"content": "Different content"}),
        ]

        deduped = retriever.deduplicate_results(results)

        # Should remove content duplicates
        assert len(deduped) == 2

    def test_deduplicate_empty_results(self, retriever: SearchRetriever) -> None:
        """Test deduplication with empty input."""
        deduped = retriever.deduplicate_results([])
        assert len(deduped) == 0


class TestSearchRetrieverFilters:
    """Test filter handling."""

    @pytest.mark.asyncio
    async def test_filter_session_id(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test session_id filter is applied."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(org_id="test-org-123", session_id="session-123"),
            rerank=False,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        qdrant_filter = call_args.kwargs.get("query_filter")
        assert qdrant_filter is not None

    @pytest.mark.asyncio
    async def test_filter_type(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test type filter is applied."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(org_id="test-org-123", type="thought"),
            rerank=False,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        qdrant_filter = call_args.kwargs.get("query_filter")
        assert qdrant_filter is not None

    @pytest.mark.asyncio
    async def test_filter_time_range(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test time_range filter is applied."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(org_id="test-org-123", time_range=TimeRange(start=1000, end=2000)),
            rerank=False,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        qdrant_filter = call_args.kwargs.get("query_filter")
        assert qdrant_filter is not None

    @pytest.mark.asyncio
    async def test_filter_combined(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test multiple filters are combined."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(
            text="test",
            limit=10,
            strategy=SearchStrategy.DENSE,
            filters=SearchFilters(
                org_id="test-org-123",
                session_id="session-123",
                type="code",
                time_range=TimeRange(start=1000, end=2000),
            ),
            rerank=False,
        )
        await retriever.search(query)

        call_args = mock_qdrant_client.client.query_points.call_args
        qdrant_filter = call_args.kwargs.get("query_filter")
        assert qdrant_filter is not None


class TestSearchRetrieverEdgeCases:
    """Test edge cases and error scenarios."""

    @pytest.mark.asyncio
    async def test_search_empty_results(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test search returns empty list when no matches."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(text="nonexistent query", limit=10, rerank=False, filters=test_filters)
        results = await retriever.search(query)

        assert results == []

    @pytest.mark.asyncio
    async def test_search_qdrant_error_handling(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test search handles Qdrant errors gracefully."""
        # Make Qdrant client throw an exception
        mock_qdrant_client.client.query_points = AsyncMock(
            side_effect=RuntimeError("Qdrant connection failed")
        )

        query = SearchQuery(
            text="test", limit=10, strategy=SearchStrategy.DENSE, rerank=False, filters=test_filters
        )

        # Should raise the exception (error handling is at API level)
        with pytest.raises(RuntimeError):
            await retriever.search(query)

    @pytest.mark.asyncio
    async def test_search_uuid_id_conversion(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test UUID IDs are converted to strings."""
        import uuid

        test_uuid = uuid.uuid4()
        mock_result = create_mock_point(test_uuid, 0.9, {"content": "test"})

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        query = SearchQuery(text="test", limit=10, rerank=False, filters=test_filters)
        results = await retriever.search(query)

        # UUID should be converted to string
        assert isinstance(results[0].id, str)
        assert results[0].id == str(test_uuid)

    @pytest.mark.asyncio
    async def test_search_auto_strategy_selection(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
    ) -> None:
        """Test strategy auto-selection when not provided."""
        mock_response = MagicMock()
        mock_response.points = []
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        # Query without explicit strategy - should use classifier
        query = SearchQuery(
            text="how do I implement this feature?",
            limit=5,
            strategy=None,
            rerank=False,
            filters=test_filters,
        )
        await retriever.search(query)

        # Verify search was called (strategy was determined)
        mock_qdrant_client.client.query_points.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_result_score_preservation(
        self,
        retriever: SearchRetriever,
        test_filters: SearchFilters,
        mock_qdrant_client: MagicMock,
        mock_reranker_router: MagicMock,
    ) -> None:
        """Test original and reranker scores are both preserved."""
        original_score = 0.75
        mock_result = create_mock_point("id-1", original_score, {"content": "test"})

        mock_response = MagicMock()
        mock_response.points = [mock_result]
        mock_qdrant_client.client.query_points = AsyncMock(return_value=mock_response)

        reranker_score = 0.92
        reranked = [MagicMock(original_index=0, score=reranker_score)]
        mock_reranker_router.rerank = AsyncMock(return_value=(reranked, "fast", False))

        query = SearchQuery(text="test", limit=5, rerank=True, filters=test_filters)
        results = await retriever.search(query)

        # Both scores should be preserved
        assert results[0].score == reranker_score  # Final score is reranker score
        assert results[0].rrf_score == original_score  # Original score preserved
        assert results[0].reranker_score == reranker_score
