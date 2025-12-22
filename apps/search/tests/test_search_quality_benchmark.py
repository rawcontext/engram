"""Tests for search quality benchmark."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.config import Settings
from src.evaluation import (
    BenchmarkConfig,
    CollectionComparison,
    SearchQualityBenchmark,
    SearchQualityMetrics,
)


class TestSearchQualityMetrics:
    """Tests for SearchQualityMetrics."""

    def test_default_metrics(self) -> None:
        """Test default metric values."""
        metrics = SearchQualityMetrics()

        assert metrics.avg_retrieval_score == 0.0
        assert metrics.reranking_success_rate == 0.0
        assert metrics.relevant_in_top_5 == 0.0
        assert metrics.query_count == 0

    def test_custom_metrics(self) -> None:
        """Test custom metric values."""
        metrics = SearchQualityMetrics(
            avg_retrieval_score=0.75,
            reranking_success_rate=0.9,
            relevant_in_top_5=4.5,
            document_count=100,
        )

        assert metrics.avg_retrieval_score == 0.75
        assert metrics.reranking_success_rate == 0.9
        assert metrics.relevant_in_top_5 == 4.5
        assert metrics.document_count == 100


class TestCollectionComparison:
    """Tests for CollectionComparison."""

    def test_comparison_creation(self) -> None:
        """Test creating a comparison."""
        fragment = SearchQualityMetrics(
            avg_retrieval_score=0.05,
            reranking_success_rate=0.0,
        )
        turn = SearchQualityMetrics(
            avg_retrieval_score=0.75,
            reranking_success_rate=0.9,
        )

        comparison = CollectionComparison(
            fragment_metrics=fragment,
            turn_metrics=turn,
            score_improvement=14.0,  # 75/5 = 15x improvement
            reranking_improvement=1.0,  # 0% to 90%
        )

        assert comparison.fragment_metrics.avg_retrieval_score == 0.05
        assert comparison.turn_metrics.avg_retrieval_score == 0.75
        assert comparison.score_improvement == 14.0


class TestBenchmarkConfig:
    """Tests for BenchmarkConfig."""

    def test_default_config(self) -> None:
        """Test default configuration values."""
        config = BenchmarkConfig()

        assert config.fragment_collection == "engram_memory"
        assert config.turn_collection == "engram_turns"
        assert len(config.test_queries) > 0
        assert config.limit == 10
        assert config.min_score_threshold == 0.1

    def test_custom_config(self) -> None:
        """Test custom configuration values."""
        config = BenchmarkConfig(
            fragment_collection="custom_fragments",
            turn_collection="custom_turns",
            test_queries=["query1", "query2"],
            limit=20,
        )

        assert config.fragment_collection == "custom_fragments"
        assert config.turn_collection == "custom_turns"
        assert config.test_queries == ["query1", "query2"]
        assert config.limit == 20


class TestSearchQualityBenchmark:
    """Tests for SearchQualityBenchmark."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            qdrant_collection="engram_memory",
            qdrant_turns_collection="engram_turns",
            embedder_device="cpu",
            embedder_preload=False,
        )

    @pytest.fixture
    def mock_qdrant(self) -> MagicMock:
        """Create mock Qdrant client."""
        qdrant = MagicMock()
        qdrant.client = AsyncMock()
        qdrant.client.get_collection = AsyncMock(
            return_value=MagicMock(
                points_count=100,
                vectors_count=100,
                indexed_vectors_count=100,
                status=MagicMock(value="green"),
            )
        )
        return qdrant

    @pytest.fixture
    def mock_embedders(self) -> MagicMock:
        """Create mock embedder factory."""
        embedders = MagicMock()
        text_embedder = MagicMock()
        text_embedder.load = AsyncMock()
        text_embedder.embed = AsyncMock(return_value=[0.1] * 384)
        embedders.get_text_embedder = AsyncMock(return_value=text_embedder)
        return embedders

    @pytest.fixture
    def benchmark(
        self,
        mock_settings: Settings,
        mock_qdrant: MagicMock,
        mock_embedders: MagicMock,
    ) -> SearchQualityBenchmark:
        """Create benchmark instance."""
        config = BenchmarkConfig(test_queries=["test query 1", "test query 2"])
        return SearchQualityBenchmark(
            settings=mock_settings,
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedders,
            config=config,
        )

    @pytest.mark.asyncio
    async def test_get_collection_stats(
        self, benchmark: SearchQualityBenchmark, mock_qdrant: MagicMock
    ) -> None:
        """Test getting collection statistics."""
        stats = await benchmark.get_collection_stats("test_collection")

        assert stats["name"] == "test_collection"
        assert stats["points_count"] == 100

    @pytest.mark.asyncio
    async def test_get_collection_stats_error(
        self, benchmark: SearchQualityBenchmark, mock_qdrant: MagicMock
    ) -> None:
        """Test handling collection stats error."""
        mock_qdrant.client.get_collection = AsyncMock(side_effect=Exception("Collection not found"))

        stats = await benchmark.get_collection_stats("missing_collection")

        assert stats["name"] == "missing_collection"
        assert "error" in stats

    def test_build_summary(self, benchmark: SearchQualityBenchmark) -> None:
        """Test building summary string."""
        fragment = SearchQualityMetrics(
            avg_retrieval_score=0.05,
            reranking_success_rate=0.0,
            relevant_in_top_5=0.5,
            avg_latency_ms=10.0,
            document_count=1000,
        )
        turn = SearchQualityMetrics(
            avg_retrieval_score=0.75,
            reranking_success_rate=0.9,
            relevant_in_top_5=4.5,
            avg_latency_ms=15.0,
            document_count=100,
        )

        summary = benchmark._build_summary(fragment, turn, 14.0, 1.0)

        assert "Fragment Collection" in summary
        assert "Turn Collection" in summary
        assert "0.050" in summary  # Fragment avg score
        assert "0.750" in summary  # Turn avg score
        assert "improved" in summary.lower()


class TestSearchQualityBenchmarkIntegration:
    """Integration tests for SearchQualityBenchmark (mocked)."""

    @pytest.fixture
    def mock_settings(self) -> Settings:
        """Create mock settings."""
        return Settings(
            qdrant_url="http://localhost:6333",
            embedder_device="cpu",
            embedder_preload=False,
        )

    @pytest.fixture
    def mock_retriever_results(self) -> list:
        """Create mock search results."""
        from src.retrieval.types import SearchResultItem

        return [
            SearchResultItem(
                id="doc-1",
                score=0.8,
                payload={"content": "This is test content 1", "type": "turn"},
            ),
            SearchResultItem(
                id="doc-2",
                score=0.6,
                payload={"content": "This is test content 2", "type": "turn"},
            ),
            SearchResultItem(
                id="doc-3",
                score=0.4,
                payload={"content": "This is test content 3", "type": "turn"},
            ),
        ]

    @pytest.mark.asyncio
    async def test_evaluate_collection_with_results(
        self, mock_settings: Settings, mock_retriever_results: list
    ) -> None:
        """Test evaluating a collection with mocked results."""
        mock_qdrant = MagicMock()
        mock_qdrant.client = AsyncMock()
        mock_qdrant.client.get_collection = AsyncMock(return_value=MagicMock(points_count=100))

        mock_embedders = MagicMock()

        config = BenchmarkConfig(
            test_queries=["query 1"],
            min_score_threshold=0.3,
        )
        benchmark = SearchQualityBenchmark(
            settings=mock_settings,
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedders,
            config=config,
        )

        # Mock the retriever
        mock_retriever = MagicMock()
        mock_retriever.search = AsyncMock(return_value=mock_retriever_results)
        mock_retriever.search_turns = AsyncMock(return_value=mock_retriever_results)
        benchmark._retriever = mock_retriever

        metrics = await benchmark.evaluate_collection("engram_memory")

        assert metrics.query_count == 1
        assert metrics.queries_with_results == 1
        assert metrics.total_results == 3
        assert metrics.avg_retrieval_score > 0

    @pytest.mark.asyncio
    async def test_evaluate_collection_no_results(self, mock_settings: Settings) -> None:
        """Test evaluating a collection with no results."""
        mock_qdrant = MagicMock()
        mock_qdrant.client = AsyncMock()
        mock_qdrant.client.get_collection = AsyncMock(return_value=MagicMock(points_count=0))

        mock_embedders = MagicMock()

        config = BenchmarkConfig(test_queries=["query 1"])
        benchmark = SearchQualityBenchmark(
            settings=mock_settings,
            qdrant_client=mock_qdrant,
            embedder_factory=mock_embedders,
            config=config,
        )

        # Mock the retriever to return empty results
        mock_retriever = MagicMock()
        mock_retriever.search = AsyncMock(return_value=[])
        mock_retriever.search_turns = AsyncMock(return_value=[])
        benchmark._retriever = mock_retriever

        metrics = await benchmark.evaluate_collection("empty_collection")

        assert metrics.query_count == 1
        assert metrics.queries_with_results == 0
        assert metrics.avg_retrieval_score == 0.0
