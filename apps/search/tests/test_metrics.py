"""Tests for Prometheus metrics instrumentation."""

import asyncio

import pytest

from search.utils.metrics import (
    EMBEDDING_CACHE_HITS,
    EMBEDDING_CACHE_MISSES,
    RERANKER_COST_CENTS,
    RERANKER_DEGRADED,
    RERANKER_REQUESTS,
    SEARCH_REQUESTS,
    get_content_type,
    get_metrics,
    record_embedding_cache_hit,
    record_embedding_cache_miss,
    record_reranker_cost,
    record_reranker_degradation,
    track_embedding,
    track_reranker,
    track_search,
)


class TestMetricsEndpoint:
    """Test metrics endpoint functions."""

    def test_get_metrics_returns_bytes(self):
        """Test that get_metrics returns bytes."""
        metrics = get_metrics()
        assert isinstance(metrics, bytes)
        assert len(metrics) > 0

    def test_get_content_type(self):
        """Test content type is correct."""
        content_type = get_content_type()
        assert isinstance(content_type, str)
        assert "text/plain" in content_type or "openmetrics" in content_type.lower()

    def test_metrics_contain_service_info(self):
        """Test that metrics contain service information."""
        metrics = get_metrics().decode("utf-8")
        assert "search_service_info" in metrics


class TestSearchMetrics:
    """Test search-related metrics."""

    @pytest.mark.asyncio
    async def test_track_search_decorator_success(self):
        """Test track_search decorator with successful search."""

        @track_search(strategy="hybrid", rerank_tier="fast")
        async def mock_search(query: str) -> list[dict]:
            await asyncio.sleep(0.01)
            return [{"id": 1}, {"id": 2}]

        # Get initial counts
        initial_success = SEARCH_REQUESTS.labels(strategy="hybrid", status="success")._value._value

        # Execute search
        results = await mock_search("test query")

        # Verify results
        assert len(results) == 2

        # Verify metrics incremented
        final_success = SEARCH_REQUESTS.labels(strategy="hybrid", status="success")._value._value
        assert final_success > initial_success

    @pytest.mark.asyncio
    async def test_track_search_decorator_error(self):
        """Test track_search decorator with failed search."""

        @track_search(strategy="dense", rerank_tier=None)
        async def mock_search_error(query: str) -> list[dict]:
            await asyncio.sleep(0.01)
            raise ValueError("Search failed")

        # Get initial error count
        initial_errors = SEARCH_REQUESTS.labels(strategy="dense", status="error")._value._value

        # Execute search and expect error
        with pytest.raises(ValueError, match="Search failed"):
            await mock_search_error("test query")

        # Verify error counter incremented
        final_errors = SEARCH_REQUESTS.labels(strategy="dense", status="error")._value._value
        assert final_errors > initial_errors


class TestEmbeddingMetrics:
    """Test embedding-related metrics."""

    def test_record_cache_hit(self):
        """Test recording embedding cache hit."""
        initial = EMBEDDING_CACHE_HITS.labels(embedder_type="text")._value._value

        record_embedding_cache_hit(embedder_type="text")

        final = EMBEDDING_CACHE_HITS.labels(embedder_type="text")._value._value
        assert final == initial + 1

    def test_record_cache_miss(self):
        """Test recording embedding cache miss."""
        initial = EMBEDDING_CACHE_MISSES.labels(embedder_type="code")._value._value

        record_embedding_cache_miss(embedder_type="code")

        final = EMBEDDING_CACHE_MISSES.labels(embedder_type="code")._value._value
        assert final == initial + 1

    @pytest.mark.asyncio
    async def test_track_embedding_decorator(self):
        """Test track_embedding decorator."""

        @track_embedding(embedder_type="sparse", is_batch=False)
        async def mock_embed(text: str) -> list[float]:
            await asyncio.sleep(0.005)
            return [0.1] * 100

        # Execute embedding
        result = await mock_embed("test text")

        # Verify result
        assert len(result) == 100

        # Verify latency was recorded (check metrics output contains the label)
        metrics_output = get_metrics().decode("utf-8")
        assert "embedding_latency_seconds" in metrics_output
        assert 'embedder_type="sparse"' in metrics_output

    @pytest.mark.asyncio
    async def test_track_embedding_decorator_batch(self):
        """Test track_embedding decorator for batch operations."""

        @track_embedding(embedder_type="text", is_batch=True)
        async def mock_embed_batch(texts: list[str]) -> list[list[float]]:
            await asyncio.sleep(0.01)
            return [[0.1] * 100 for _ in texts]

        # Execute batch embedding
        texts = ["text1", "text2", "text3"]
        results = await mock_embed_batch(texts)

        # Verify results
        assert len(results) == 3

        # Verify batch size was recorded
        metrics_output = get_metrics().decode("utf-8")
        assert "embedding_latency_seconds" in metrics_output
        assert 'embedder_type="text"' in metrics_output


class TestRerankerMetrics:
    """Test reranker-related metrics."""

    def test_record_reranker_cost(self):
        """Test recording reranker cost."""
        initial = RERANKER_COST_CENTS.labels(tier="llm")._value._value

        record_reranker_cost(tier="llm", cost_cents=5.5)

        final = RERANKER_COST_CENTS.labels(tier="llm")._value._value
        assert final == initial + 5.5

    def test_record_reranker_degradation(self):
        """Test recording reranker degradation."""
        initial = RERANKER_DEGRADED.labels(tier="accurate", reason="timeout")._value._value

        record_reranker_degradation(tier="accurate", reason="timeout")

        final = RERANKER_DEGRADED.labels(tier="accurate", reason="timeout")._value._value
        assert final == initial + 1

    @pytest.mark.asyncio
    async def test_track_reranker_decorator_success(self):
        """Test track_reranker decorator with success."""

        @track_reranker(tier="fast")
        async def mock_rerank(query: str, docs: list[str]) -> list[dict]:
            await asyncio.sleep(0.01)
            return [{"text": doc, "score": 0.9} for doc in docs]

        # Get initial counts
        initial_success = RERANKER_REQUESTS.labels(tier="fast", status="success")._value._value

        # Execute reranking
        results = await mock_rerank("query", ["doc1", "doc2"])

        # Verify results
        assert len(results) == 2

        # Verify success counter incremented
        final_success = RERANKER_REQUESTS.labels(tier="fast", status="success")._value._value
        assert final_success > initial_success

        # Verify latency was recorded
        metrics_output = get_metrics().decode("utf-8")
        assert "reranker_latency_seconds" in metrics_output
        assert 'tier="fast"' in metrics_output

    @pytest.mark.asyncio
    async def test_track_reranker_decorator_error(self):
        """Test track_reranker decorator with error."""

        @track_reranker(tier="colbert")
        async def mock_rerank_error(query: str, docs: list[str]) -> list[dict]:
            await asyncio.sleep(0.01)
            raise RuntimeError("Reranking failed")

        # Get initial error count
        initial_errors = RERANKER_REQUESTS.labels(tier="colbert", status="error")._value._value

        # Execute reranking and expect error
        with pytest.raises(RuntimeError, match="Reranking failed"):
            await mock_rerank_error("query", ["doc1"])

        # Verify error counter incremented
        final_errors = RERANKER_REQUESTS.labels(tier="colbert", status="error")._value._value
        assert final_errors > initial_errors


class TestMetricsFormat:
    """Test metrics output format."""

    def test_metrics_prometheus_format(self):
        """Test that metrics are in Prometheus format."""
        metrics = get_metrics().decode("utf-8")

        # Check for Prometheus format markers
        assert "# HELP" in metrics
        assert "# TYPE" in metrics

        # Check for some key metrics
        assert "search_requests_total" in metrics
        assert "embedding_cache_hits_total" in metrics
        assert "reranker_latency_seconds" in metrics

    def test_metrics_include_labels(self):
        """Test that metrics include proper labels."""
        # Record some metrics with labels
        record_embedding_cache_hit(embedder_type="test_embedder")
        record_reranker_cost(tier="test_tier", cost_cents=1.0)

        metrics = get_metrics().decode("utf-8")

        # Check labels are present
        assert 'embedder_type="test_embedder"' in metrics
        assert 'tier="test_tier"' in metrics


class TestMetricsIntegration:
    """Integration tests for metrics."""

    @pytest.mark.asyncio
    async def test_full_search_pipeline_metrics(self):
        """Test metrics for a full search pipeline."""

        # Simulate embedding
        @track_embedding(embedder_type="text", is_batch=False)
        async def embed(text: str) -> list[float]:
            await asyncio.sleep(0.005)
            return [0.1] * 768

        # Simulate search
        @track_search(strategy="hybrid", rerank_tier="accurate")
        async def search(query: str) -> list[dict]:
            # Generate embedding (result used for vector search)
            _ = await embed(query)

            # Simulate search results
            await asyncio.sleep(0.01)
            return [{"id": i, "score": 0.9 - i * 0.1} for i in range(5)]

        # Simulate reranking
        @track_reranker(tier="accurate")
        async def rerank(query: str, results: list[dict]) -> list[dict]:
            await asyncio.sleep(0.02)
            return sorted(results, key=lambda x: -x["score"])

        # Execute pipeline
        query = "test query"
        results = await search(query)
        reranked = await rerank(query, results)

        # Verify results
        assert len(reranked) == 5

        # Verify all metrics were recorded
        metrics = get_metrics().decode("utf-8")
        assert "embedding_latency_seconds" in metrics
        assert "search_request_latency_seconds" in metrics
        assert "reranker_latency_seconds" in metrics
