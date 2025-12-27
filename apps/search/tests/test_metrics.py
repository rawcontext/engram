"""Tests for Prometheus metrics instrumentation."""

import asyncio

import pytest

from src.utils.metrics import (
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

    @pytest.mark.asyncio
    async def test_track_search_decorator_non_list_result(self):
        """Test track_search decorator with non-list result."""

        @track_search(strategy="sparse", rerank_tier="fast")
        async def mock_search_dict(query: str) -> dict:
            await asyncio.sleep(0.01)
            return {"results": [], "count": 0}

        # Get initial success count
        initial_success = SEARCH_REQUESTS.labels(strategy="sparse", status="success")._value._value

        # Execute search with dict result
        result = await mock_search_dict("test query")

        # Verify result
        assert isinstance(result, dict)

        # Verify success counter incremented (but not result count since not a list)
        final_success = SEARCH_REQUESTS.labels(strategy="sparse", status="success")._value._value
        assert final_success > initial_success


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

    @pytest.mark.asyncio
    async def test_track_embedding_decorator_error(self):
        """Test track_embedding decorator error handling."""
        from src.utils.metrics import EMBEDDING_ERRORS

        @track_embedding(embedder_type="text", is_batch=False)
        async def mock_embed_error(text: str) -> list[float]:
            await asyncio.sleep(0.005)
            raise ValueError("Embedding generation failed")

        # Get initial error count
        initial_errors = EMBEDDING_ERRORS.labels(
            embedder_type="text", error_type="ValueError"
        )._value._value

        # Execute embedding and expect error
        with pytest.raises(ValueError, match="Embedding generation failed"):
            await mock_embed_error("test text")

        # Verify error counter incremented
        final_errors = EMBEDDING_ERRORS.labels(
            embedder_type="text", error_type="ValueError"
        )._value._value
        assert final_errors > initial_errors

    @pytest.mark.asyncio
    async def test_track_embedding_batch_no_args(self):
        """Test track_embedding decorator with batch=True but no list arg."""

        @track_embedding(embedder_type="sparse", is_batch=True)
        async def mock_embed_no_args() -> list[list[float]]:
            await asyncio.sleep(0.005)
            return [[0.1] * 100]

        # Execute without args - should not crash
        result = await mock_embed_no_args()
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_track_embedding_batch_non_list_arg(self):
        """Test track_embedding decorator with batch=True but non-list arg."""

        @track_embedding(embedder_type="code", is_batch=True)
        async def mock_embed_non_list(count: int) -> list[list[float]]:
            await asyncio.sleep(0.005)
            return [[0.1] * 100 for _ in range(count)]

        # Execute with non-list arg - should not crash
        result = await mock_embed_non_list(2)
        assert len(result) == 2


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


class TestModelLoadingMetrics:
    """Test model loading metrics."""

    @pytest.mark.asyncio
    async def test_track_model_load_decorator(self):
        """Test track_model_load decorator."""
        from src.utils.metrics import MODELS_LOADED, track_model_load

        @track_model_load(model_type="embedder", model_name="BAAI/bge-large-en-v1.5")
        async def mock_load_model() -> str:
            await asyncio.sleep(0.05)
            return "model_loaded"

        # Get initial count
        initial_count = MODELS_LOADED.labels(model_type="embedder")._value._value

        # Execute model load
        result = await mock_load_model()

        # Verify result
        assert result == "model_loaded"

        # Verify models loaded counter incremented
        final_count = MODELS_LOADED.labels(model_type="embedder")._value._value
        assert final_count > initial_count

        # Verify latency was recorded
        metrics_output = get_metrics().decode("utf-8")
        assert "model_load_latency_seconds" in metrics_output


class TestHelperFunctions:
    """Test helper functions for recording metrics."""

    def test_record_reranker_score_improvement(self):
        """Test recording reranker score improvement."""
        from src.utils.metrics import RERANKER_SCORE_IMPROVEMENT, record_reranker_score_improvement

        # Record positive improvement
        record_reranker_score_improvement(tier="fast", improvement=0.25)

        # Record negative improvement (degradation)
        record_reranker_score_improvement(tier="accurate", improvement=-0.1)

        # Verify metrics were recorded
        metrics = get_metrics().decode("utf-8")
        assert "reranker_score_improvement" in metrics

    def test_record_indexed_document(self):
        """Test recording indexed documents."""
        from src.utils.metrics import INDEXED_DOCUMENTS, record_indexed_document

        initial_success = INDEXED_DOCUMENTS.labels(status="success")._value._value
        initial_error = INDEXED_DOCUMENTS.labels(status="error")._value._value

        # Record success
        record_indexed_document(success=True)
        # Record error
        record_indexed_document(success=False)

        final_success = INDEXED_DOCUMENTS.labels(status="success")._value._value
        final_error = INDEXED_DOCUMENTS.labels(status="error")._value._value

        assert final_success == initial_success + 1
        assert final_error == initial_error + 1

    def test_record_nats_message(self):
        """Test recording NATS message processing."""
        from src.utils.metrics import NATS_MESSAGES_PROCESSED, record_nats_message

        initial_success = NATS_MESSAGES_PROCESSED.labels(
            topic="test.topic", status="success"
        )._value._value
        initial_error = NATS_MESSAGES_PROCESSED.labels(
            topic="test.topic", status="error"
        )._value._value

        # Record success
        record_nats_message(topic="test.topic", success=True)
        # Record error
        record_nats_message(topic="test.topic", success=False)

        final_success = NATS_MESSAGES_PROCESSED.labels(
            topic="test.topic", status="success"
        )._value._value
        final_error = NATS_MESSAGES_PROCESSED.labels(
            topic="test.topic", status="error"
        )._value._value

        assert final_success == initial_success + 1
        assert final_error == initial_error + 1

    def test_set_batch_queue_size(self):
        """Test setting batch queue size."""
        from src.utils.metrics import BATCH_QUEUE_SIZE, set_batch_queue_size

        set_batch_queue_size(size=42)

        # Verify gauge was set
        assert BATCH_QUEUE_SIZE._value._value == 42

        set_batch_queue_size(size=0)
        assert BATCH_QUEUE_SIZE._value._value == 0

    def test_set_nats_consumer_lag(self):
        """Test setting NATS consumer lag."""
        from src.utils.metrics import NATS_CONSUMER_LAG, set_nats_consumer_lag

        set_nats_consumer_lag(topic="events.parsed", partition=0, lag=100)
        set_nats_consumer_lag(topic="events.parsed", partition=1, lag=50)

        # Verify gauges were set
        metrics = get_metrics().decode("utf-8")
        assert "nats_consumer_lag" in metrics
        assert 'topic="events.parsed"' in metrics

    def test_set_qdrant_connections(self):
        """Test setting Qdrant connection count."""
        from src.utils.metrics import QDRANT_CONNECTIONS, set_qdrant_connections

        set_qdrant_connections(count=5)
        assert QDRANT_CONNECTIONS._value._value == 5

        set_qdrant_connections(count=0)
        assert QDRANT_CONNECTIONS._value._value == 0

    def test_set_redis_connections(self):
        """Test setting Redis connection count."""
        from src.utils.metrics import REDIS_CONNECTIONS, set_redis_connections

        set_redis_connections(count=3)
        assert REDIS_CONNECTIONS._value._value == 3

        set_redis_connections(count=0)
        assert REDIS_CONNECTIONS._value._value == 0

    def test_record_qdrant_request(self):
        """Test recording Qdrant requests."""
        from src.utils.metrics import QDRANT_REQUESTS, record_qdrant_request

        initial_success = QDRANT_REQUESTS.labels(
            operation="search", status="success"
        )._value._value
        initial_error = QDRANT_REQUESTS.labels(
            operation="upsert", status="error"
        )._value._value

        # Record successful search
        record_qdrant_request(operation="search", success=True, latency=0.025)
        # Record failed upsert
        record_qdrant_request(operation="upsert", success=False, latency=0.1)

        final_success = QDRANT_REQUESTS.labels(
            operation="search", status="success"
        )._value._value
        final_error = QDRANT_REQUESTS.labels(
            operation="upsert", status="error"
        )._value._value

        assert final_success == initial_success + 1
        assert final_error == initial_error + 1

        # Verify latency was recorded
        metrics = get_metrics().decode("utf-8")
        assert "qdrant_latency_seconds" in metrics

    def test_record_redis_request(self):
        """Test recording Redis requests."""
        from src.utils.metrics import REDIS_REQUESTS, record_redis_request

        initial_success = REDIS_REQUESTS.labels(operation="get", status="success")._value._value
        initial_error = REDIS_REQUESTS.labels(operation="set", status="error")._value._value

        # Record successful get
        record_redis_request(operation="get", success=True, latency=0.001)
        # Record failed set
        record_redis_request(operation="set", success=False, latency=0.005)

        final_success = REDIS_REQUESTS.labels(operation="get", status="success")._value._value
        final_error = REDIS_REQUESTS.labels(operation="set", status="error")._value._value

        assert final_success == initial_success + 1
        assert final_error == initial_error + 1

        # Verify latency was recorded
        metrics = get_metrics().decode("utf-8")
        assert "redis_latency_seconds" in metrics

    def test_set_model_memory_usage(self):
        """Test setting model memory usage."""
        from src.utils.metrics import MODEL_MEMORY_USAGE_BYTES, set_model_memory_usage

        set_model_memory_usage(
            model_type="embedder", model_name="BAAI/bge-large-en-v1.5", bytes_used=1024 * 1024 * 512
        )

        # Verify gauge was set
        metrics = get_metrics().decode("utf-8")
        assert "model_memory_usage_bytes" in metrics

    def test_unload_model(self):
        """Test unloading a model."""
        from src.utils.metrics import MODELS_LOADED, unload_model

        # First ensure model is loaded
        MODELS_LOADED.labels(model_type="reranker").inc()
        initial_count = MODELS_LOADED.labels(model_type="reranker")._value._value

        # Unload model
        unload_model(model_type="reranker")

        final_count = MODELS_LOADED.labels(model_type="reranker")._value._value
        assert final_count == initial_count - 1

    def test_unload_model_when_zero(self):
        """Test unloading a model when count is already zero."""
        from src.utils.metrics import MODELS_LOADED, unload_model

        # Set count to zero
        current = MODELS_LOADED.labels(model_type="test_zero")._value._value
        for _ in range(int(current)):
            MODELS_LOADED.labels(model_type="test_zero").dec()

        # Try to unload when already at zero - should not go negative
        unload_model(model_type="test_zero")

        final_count = MODELS_LOADED.labels(model_type="test_zero")._value._value
        assert final_count == 0


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
