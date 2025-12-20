"""API route handlers for search endpoints."""

import logging
import time

from fastapi import APIRouter, HTTPException, Request, Response, status

from search.api.schemas import HealthResponse, SearchRequest, SearchResponse, SearchResult
from search.retrieval.types import SearchFilters, SearchQuery, TimeRange
from search.utils.metrics import get_content_type, get_metrics

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request) -> HealthResponse:
    """Check service health and Qdrant connectivity.

    Args:
        request: FastAPI request object with app state.

    Returns:
        Health status including Qdrant connection status.
    """
    qdrant = getattr(request.app.state, "qdrant", None)
    qdrant_connected = False

    if qdrant is not None:
        try:
            qdrant_connected = await qdrant.health_check()
        except Exception as e:
            logger.error(f"Health check error: {e}")
            qdrant_connected = False

    return HealthResponse(
        status="healthy" if qdrant_connected else "degraded",
        version="0.1.0",
        qdrant_connected=qdrant_connected,
    )


@router.get("/ready")
async def readiness_check(request: Request) -> dict[str, str]:
    """Kubernetes readiness probe.

    Args:
        request: FastAPI request object with app state.

    Returns:
        Readiness status.
    """
    qdrant = getattr(request.app.state, "qdrant", None)

    if qdrant is None:
        return {"status": "not_ready", "reason": "qdrant client not initialized"}

    try:
        is_healthy = await qdrant.health_check()
        if is_healthy:
            return {"status": "ready"}
        return {"status": "not_ready", "reason": "qdrant health check failed"}
    except Exception as e:
        return {"status": "not_ready", "reason": str(e)}


@router.get("/metrics")
async def metrics() -> Response:
    """Prometheus metrics endpoint.

    Returns:
        Metrics in Prometheus text exposition format.
    """
    return Response(content=get_metrics(), media_type=get_content_type())


@router.post("/search", response_model=SearchResponse)
async def search(request: Request, search_request: SearchRequest) -> SearchResponse:
    """Perform vector search with optional reranking.

    Executes hybrid search using dense and sparse vectors, optionally applying
    multi-tier reranking for improved relevance.

    Args:
        request: FastAPI request object with app state.
        search_request: Search query and parameters.

    Returns:
        Search results with scores and metadata.

    Raises:
        HTTPException: If search fails.
    """
    start_time = time.time()

    logger.info(
        f"Search request: query='{search_request.text[:50]}...', "
        f"limit={search_request.limit}, strategy={search_request.strategy}, "
        f"rerank={search_request.rerank}"
    )

    # Verify search retriever is available
    search_retriever = getattr(request.app.state, "search_retriever", None)
    if search_retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Search service unavailable: retriever not initialized",
        )

    try:
        # Build search filters
        filters = None
        if search_request.filters:
            time_range = None
            if search_request.filters.time_range:
                time_range = TimeRange(
                    start=search_request.filters.time_range.get("start", 0),
                    end=search_request.filters.time_range.get("end", 0),
                )
            filters = SearchFilters(
                session_id=search_request.filters.session_id,
                type=search_request.filters.type,
                time_range=time_range,
            )

        # Build search query
        query = SearchQuery(
            text=search_request.text,
            limit=search_request.limit,
            threshold=search_request.threshold,
            filters=filters,
            strategy=search_request.strategy,  # type: ignore[arg-type]
            rerank=search_request.rerank,
            rerank_tier=search_request.rerank_tier,  # type: ignore[arg-type]
            rerank_depth=search_request.rerank_depth,
        )

        # Execute search
        results = await search_retriever.search(query)

        # Calculate timing
        took_ms = int((time.time() - start_time) * 1000)

        # Map results to response schema
        search_results = [
            SearchResult(
                id=str(r.id),
                score=r.score,
                rrf_score=r.rrf_score,
                reranker_score=r.reranker_score,
                rerank_tier=r.rerank_tier.value if r.rerank_tier else None,
                payload=r.payload,
                degraded=r.degraded,
            )
            for r in results
        ]

        logger.info(f"Search completed: results={len(search_results)}, took_ms={took_ms}")

        return SearchResponse(
            results=search_results,
            total=len(search_results),
            took_ms=took_ms,
        )

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Search failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        ) from e
