"""Prometheus metrics instrumentation for the search service.

This module provides comprehensive metrics tracking for:
- Search latency and throughput
- Reranker usage, costs, and performance
- Embedding generation times and cache hit rates
- Request patterns and error rates
- Infrastructure health (Qdrant, Redis, NATS)
"""

import functools
import time
from collections.abc import Awaitable, Callable
from typing import Any, ParamSpec, TypeVar

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, Info, generate_latest

# Service information
SERVICE_INFO = Info("search_service", "Search service information")
SERVICE_INFO.info(
    {
        "version": "0.1.0",
        "service": "engram-search",
        "component": "vector-search",
    }
)

# ==================== Request Metrics ====================

SEARCH_LATENCY = Histogram(
    "search_request_latency_seconds",
    "Search request latency in seconds",
    ["strategy", "rerank_tier"],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

SEARCH_REQUESTS = Counter(
    "search_requests_total",
    "Total search requests",
    ["strategy", "status"],
)

SEARCH_RESULTS = Histogram(
    "search_results_count",
    "Number of results returned per search",
    ["strategy"],
    buckets=[0, 1, 5, 10, 25, 50, 100],
)

# ==================== Reranker Metrics ====================

RERANKER_REQUESTS = Counter(
    "reranker_requests_total",
    "Total reranker requests",
    ["tier", "status"],
)

RERANKER_LATENCY = Histogram(
    "reranker_latency_seconds",
    "Reranker latency in seconds",
    ["tier"],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

RERANKER_COST_CENTS = Counter(
    "reranker_cost_cents_total",
    "Total reranker cost in cents",
    ["tier"],
)

RERANKER_DEGRADED = Counter(
    "reranker_degraded_total",
    "Total reranker degradations (timeouts, fallbacks)",
    ["tier", "reason"],
)

RERANKER_SCORE_IMPROVEMENT = Histogram(
    "reranker_score_improvement",
    "Score improvement after reranking",
    ["tier"],
    buckets=[-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5, 1.0],
)

# ==================== Embedding Metrics ====================

EMBEDDING_LATENCY = Histogram(
    "embedding_latency_seconds",
    "Embedding generation latency in seconds",
    ["embedder_type", "is_batch"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
)

EMBEDDING_CACHE_HITS = Counter(
    "embedding_cache_hits_total",
    "Total embedding cache hits",
    ["embedder_type"],
)

EMBEDDING_CACHE_MISSES = Counter(
    "embedding_cache_misses_total",
    "Total embedding cache misses",
    ["embedder_type"],
)

EMBEDDING_BATCH_SIZE = Histogram(
    "embedding_batch_size",
    "Size of embedding batches",
    ["embedder_type"],
    buckets=[1, 5, 10, 25, 50, 100, 250],
)

EMBEDDING_ERRORS = Counter(
    "embedding_errors_total",
    "Total embedding generation errors",
    ["embedder_type", "error_type"],
)

# ==================== Indexing Metrics ====================

INDEXED_DOCUMENTS = Counter(
    "indexed_documents_total",
    "Total documents indexed",
    ["status"],
)

INDEXING_LATENCY = Histogram(
    "indexing_latency_seconds",
    "Document indexing latency in seconds",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)

BATCH_QUEUE_SIZE = Gauge(
    "batch_queue_size",
    "Current batch queue size",
)

NATS_CONSUMER_LAG = Gauge(
    "nats_consumer_lag",
    "NATS consumer lag by topic and partition",
    ["topic", "partition"],
)

NATS_MESSAGES_PROCESSED = Counter(
    "nats_messages_processed_total",
    "Total NATS messages processed",
    ["topic", "status"],
)

# ==================== Connection Metrics ====================

QDRANT_CONNECTIONS = Gauge(
    "qdrant_connections_active",
    "Active Qdrant connections",
)

REDIS_CONNECTIONS = Gauge(
    "redis_connections_active",
    "Active Redis connections",
)

QDRANT_REQUESTS = Counter(
    "qdrant_requests_total",
    "Total Qdrant requests",
    ["operation", "status"],
)

QDRANT_LATENCY = Histogram(
    "qdrant_latency_seconds",
    "Qdrant operation latency in seconds",
    ["operation"],
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
)

REDIS_REQUESTS = Counter(
    "redis_requests_total",
    "Total Redis requests",
    ["operation", "status"],
)

REDIS_LATENCY = Histogram(
    "redis_latency_seconds",
    "Redis operation latency in seconds",
    ["operation"],
    buckets=[0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05],
)

# ==================== Model Loading Metrics ====================

MODEL_LOAD_LATENCY = Histogram(
    "model_load_latency_seconds",
    "Model loading latency in seconds",
    ["model_type", "model_name"],
    buckets=[1, 5, 10, 30, 60, 120, 300],
)

MODELS_LOADED = Gauge(
    "models_loaded",
    "Number of models currently loaded in memory",
    ["model_type"],
)

MODEL_MEMORY_USAGE_BYTES = Gauge(
    "model_memory_usage_bytes",
    "Estimated memory usage by loaded models in bytes",
    ["model_type", "model_name"],
)


# ==================== Decorator Utilities ====================

P = ParamSpec("P")
T = TypeVar("T")


def track_search(strategy: str, rerank_tier: str | None = None) -> Callable[..., Any]:
    """Decorator to track search metrics.

    Tracks request latency, result counts, and success/failure rates.

    Args:
            strategy: Search strategy (dense, sparse, hybrid).
            rerank_tier: Optional reranker tier used.

    Returns:
            Decorated function.

    Example:
            @track_search(strategy="hybrid", rerank_tier="fast")
            async def search(query: str) -> list[Result]:
                    ...
    """

    def decorator(func: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            tier = rerank_tier or "none"
            start_time = time.perf_counter()

            try:
                result = await func(*args, **kwargs)
                SEARCH_REQUESTS.labels(strategy=strategy, status="success").inc()

                # Track result count if result is a list
                if isinstance(result, list):
                    SEARCH_RESULTS.labels(strategy=strategy).observe(len(result))

                return result

            except Exception:
                SEARCH_REQUESTS.labels(strategy=strategy, status="error").inc()
                raise

            finally:
                duration = time.perf_counter() - start_time
                SEARCH_LATENCY.labels(strategy=strategy, rerank_tier=tier).observe(duration)

        return wrapper

    return decorator


def track_embedding(embedder_type: str, is_batch: bool = False) -> Callable[..., Any]:
    """Decorator to track embedding metrics.

    Tracks embedding generation latency and batch sizes.

    Args:
            embedder_type: Type of embedder (text, code, sparse).
            is_batch: Whether this is a batch operation.

    Returns:
            Decorated function.

    Example:
            @track_embedding(embedder_type="text", is_batch=True)
            async def embed_batch(texts: list[str]) -> list[list[float]]:
                    ...
    """

    def decorator(func: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            start_time = time.perf_counter()

            # Track batch size if is_batch and first arg is a list
            if is_batch and args and isinstance(args[0], list):
                EMBEDDING_BATCH_SIZE.labels(embedder_type=embedder_type).observe(len(args[0]))

            try:
                result = await func(*args, **kwargs)
                return result

            except Exception as e:
                error_type = type(e).__name__
                EMBEDDING_ERRORS.labels(embedder_type=embedder_type, error_type=error_type).inc()
                raise

            finally:
                duration = time.perf_counter() - start_time
                EMBEDDING_LATENCY.labels(
                    embedder_type=embedder_type,
                    is_batch=str(is_batch).lower(),
                ).observe(duration)

        return wrapper

    return decorator


def track_reranker(tier: str) -> Callable[..., Any]:
    """Decorator to track reranker metrics.

    Tracks reranker latency, success rates, and costs.

    Args:
            tier: Reranker tier (fast, accurate, code, colbert, llm).

    Returns:
            Decorated function.

    Example:
            @track_reranker(tier="fast")
            async def rerank(query: str, docs: list[str]) -> list[Result]:
                    ...
    """

    def decorator(func: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            start_time = time.perf_counter()

            try:
                result = await func(*args, **kwargs)
                RERANKER_REQUESTS.labels(tier=tier, status="success").inc()
                return result

            except Exception:
                RERANKER_REQUESTS.labels(tier=tier, status="error").inc()
                raise

            finally:
                duration = time.perf_counter() - start_time
                RERANKER_LATENCY.labels(tier=tier).observe(duration)

        return wrapper

    return decorator


def track_model_load(model_type: str, model_name: str) -> Callable[..., Any]:
    """Decorator to track model loading metrics.

    Args:
            model_type: Type of model (embedder, reranker).
            model_name: Name of the model being loaded.

    Returns:
            Decorated function.

    Example:
            @track_model_load(model_type="embedder", model_name="BAAI/bge-large-en-v1.5")
            async def load_model() -> None:
                    ...
    """

    def decorator(func: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            start_time = time.perf_counter()

            try:
                result = await func(*args, **kwargs)
                MODELS_LOADED.labels(model_type=model_type).inc()
                return result

            finally:
                duration = time.perf_counter() - start_time
                MODEL_LOAD_LATENCY.labels(model_type=model_type, model_name=model_name).observe(
                    duration
                )

        return wrapper

    return decorator


# ==================== Helper Functions ====================


def record_embedding_cache_hit(embedder_type: str) -> None:
    """Record an embedding cache hit.

    Args:
            embedder_type: Type of embedder (text, code, sparse).
    """
    EMBEDDING_CACHE_HITS.labels(embedder_type=embedder_type).inc()


def record_embedding_cache_miss(embedder_type: str) -> None:
    """Record an embedding cache miss.

    Args:
            embedder_type: Type of embedder (text, code, sparse).
    """
    EMBEDDING_CACHE_MISSES.labels(embedder_type=embedder_type).inc()


def record_reranker_cost(tier: str, cost_cents: float) -> None:
    """Record reranker cost.

    Args:
            tier: Reranker tier.
            cost_cents: Cost in cents.
    """
    RERANKER_COST_CENTS.labels(tier=tier).inc(cost_cents)


def record_reranker_degradation(tier: str, reason: str) -> None:
    """Record a reranker degradation event.

    Args:
            tier: Reranker tier that degraded.
            reason: Reason for degradation (timeout, error, rate_limit).
    """
    RERANKER_DEGRADED.labels(tier=tier, reason=reason).inc()


def record_reranker_score_improvement(tier: str, improvement: float) -> None:
    """Record score improvement from reranking.

    Args:
            tier: Reranker tier.
            improvement: Average score improvement (can be negative).
    """
    RERANKER_SCORE_IMPROVEMENT.labels(tier=tier).observe(improvement)


def record_indexed_document(success: bool) -> None:
    """Record a document indexing operation.

    Args:
            success: Whether indexing succeeded.
    """
    status = "success" if success else "error"
    INDEXED_DOCUMENTS.labels(status=status).inc()


def record_nats_message(topic: str, success: bool) -> None:
    """Record a NATS message processing event.

    Args:
            topic: NATS topic.
            success: Whether processing succeeded.
    """
    status = "success" if success else "error"
    NATS_MESSAGES_PROCESSED.labels(topic=topic, status=status).inc()


def set_batch_queue_size(size: int) -> None:
    """Set the current batch queue size.

    Args:
            size: Current queue size.
    """
    BATCH_QUEUE_SIZE.set(size)


def set_nats_consumer_lag(topic: str, partition: int, lag: int) -> None:
    """Set NATS consumer lag for a topic/partition.

    Args:
            topic: NATS topic.
            partition: Partition number.
            lag: Current lag.
    """
    NATS_CONSUMER_LAG.labels(topic=topic, partition=str(partition)).set(lag)


def set_qdrant_connections(count: int) -> None:
    """Set active Qdrant connection count.

    Args:
            count: Number of active connections.
    """
    QDRANT_CONNECTIONS.set(count)


def set_redis_connections(count: int) -> None:
    """Set active Redis connection count.

    Args:
            count: Number of active connections.
    """
    REDIS_CONNECTIONS.set(count)


def record_qdrant_request(operation: str, success: bool, latency: float) -> None:
    """Record a Qdrant request.

    Args:
            operation: Operation name (search, upsert, delete, etc.).
            success: Whether the request succeeded.
            latency: Request latency in seconds.
    """
    status = "success" if success else "error"
    QDRANT_REQUESTS.labels(operation=operation, status=status).inc()
    QDRANT_LATENCY.labels(operation=operation).observe(latency)


def record_redis_request(operation: str, success: bool, latency: float) -> None:
    """Record a Redis request.

    Args:
            operation: Operation name (get, set, delete, etc.).
            success: Whether the request succeeded.
            latency: Request latency in seconds.
    """
    status = "success" if success else "error"
    REDIS_REQUESTS.labels(operation=operation, status=status).inc()
    REDIS_LATENCY.labels(operation=operation).observe(latency)


def set_model_memory_usage(model_type: str, model_name: str, bytes_used: int) -> None:
    """Set estimated model memory usage.

    Args:
            model_type: Type of model (embedder, reranker).
            model_name: Name of the model.
            bytes_used: Estimated memory usage in bytes.
    """
    MODEL_MEMORY_USAGE_BYTES.labels(model_type=model_type, model_name=model_name).set(bytes_used)


def unload_model(model_type: str) -> None:
    """Record a model being unloaded.

    Args:
            model_type: Type of model (embedder, reranker).
    """
    current = MODELS_LOADED.labels(model_type=model_type)._value._value
    if current > 0:
        MODELS_LOADED.labels(model_type=model_type).dec()


# ==================== Metrics Endpoint ====================


def get_metrics() -> bytes:
    """Get Prometheus metrics as bytes for /metrics endpoint.

    Returns:
            Metrics in Prometheus text exposition format.
    """
    return generate_latest()


def get_content_type() -> str:
    """Get content type for metrics response.

    Returns:
            Content type string for Prometheus metrics.
    """
    return CONTENT_TYPE_LATEST
