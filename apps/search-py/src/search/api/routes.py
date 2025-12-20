"""API route handlers for search endpoints."""

import logging

from fastapi import APIRouter, HTTPException, Request, status

from search.api.schemas import HealthResponse, SearchRequest, SearchResponse

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


@router.post("/search", response_model=SearchResponse)
async def search(request: Request, search_request: SearchRequest) -> SearchResponse:
    """Perform vector search with optional reranking.

    This endpoint will be fully implemented in Phase 4.
    Currently returns a placeholder response.

    Args:
        request: FastAPI request object with app state.
        search_request: Search query and parameters.

    Returns:
        Search results with scores and metadata.

    Raises:
        HTTPException: If search fails.
    """
    logger.info(
        f"Search request: query='{search_request.text}', "
        f"limit={search_request.limit}, strategy={search_request.strategy}"
    )

    # Verify Qdrant is available
    qdrant = getattr(request.app.state, "qdrant", None)
    if qdrant is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Search service unavailable: Qdrant not initialized",
        )

    # Check Qdrant health
    try:
        is_healthy = await qdrant.health_check()
        if not is_healthy:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Search service unavailable: Qdrant unhealthy",
            )
    except Exception as e:
        logger.error(f"Qdrant health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Search service unavailable: {str(e)}",
        ) from e

    # Phase 1: Return placeholder response
    # TODO: Implement actual search in Phase 4
    logger.warning("Search endpoint not yet implemented - returning placeholder")

    return SearchResponse(
        results=[],
        total=0,
        took_ms=0,
    )
