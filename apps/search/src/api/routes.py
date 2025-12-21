"""API route handlers for search endpoints."""

import logging
import time

from fastapi import APIRouter, HTTPException, Request, Response, status

from src.api.schemas import (
    EmbedRequest,
    EmbedResponse,
    HealthResponse,
    MultiQueryRequest,
    SearchRequest,
    SearchResponse,
    SearchResult,
    SessionAwareRequest,
    SessionAwareResponse,
    SessionAwareResult,
)
from src.retrieval.multi_query import MultiQueryConfig
from src.retrieval.session import SessionRetrieverConfig
from src.retrieval.types import RerankerTier, SearchFilters, SearchQuery, SearchStrategy, TimeRange
from src.utils.metrics import get_content_type, get_metrics

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

        # Convert string strategy/tier to enums if provided
        strategy = SearchStrategy(search_request.strategy) if search_request.strategy else None
        rerank_tier = (
            RerankerTier(search_request.rerank_tier) if search_request.rerank_tier else None
        )

        # Build search query
        query = SearchQuery(
            text=search_request.text,
            limit=search_request.limit,
            threshold=search_request.threshold,
            filters=filters,
            strategy=strategy,
            rerank=search_request.rerank,
            rerank_tier=rerank_tier,
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


@router.post("/embed", response_model=EmbedResponse)
async def embed(request: Request, embed_request: EmbedRequest) -> EmbedResponse:
    """Generate embedding for text.

    Produces dense vector embeddings using the specified embedder type.
    Useful for semantic similarity comparison and tool selection.

    Args:
        request: FastAPI request object with app state.
        embed_request: Embedding request with text and embedder type.

    Returns:
        Dense embedding vector with metadata.

    Raises:
        HTTPException: If embedding generation fails.
    """
    start_time = time.time()

    logger.info(
        f"Embed request: text='{embed_request.text[:50]}...', "
        f"type={embed_request.embedder_type}, is_query={embed_request.is_query}"
    )

    # Verify embedder factory is available
    embedder_factory = getattr(request.app.state, "embedder_factory", None)
    if embedder_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embedding service unavailable: embedder factory not initialized",
        )

    try:
        # Get embedder from factory
        embedder = await embedder_factory.get_embedder(embed_request.embedder_type)

        # Generate embedding
        embedding = await embedder.embed(embed_request.text, is_query=embed_request.is_query)

        # Calculate timing
        took_ms = int((time.time() - start_time) * 1000)

        logger.info(
            f"Embedding completed: dimensions={len(embedding)}, took_ms={took_ms}, "
            f"type={embed_request.embedder_type}"
        )

        return EmbedResponse(
            embedding=embedding,
            dimensions=len(embedding),
            embedder_type=embed_request.embedder_type,
            took_ms=took_ms,
        )

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Embedding failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Embedding failed: {str(e)}",
        ) from e


@router.post("/search/multi-query", response_model=SearchResponse)
async def multi_query_search(
    request: Request, multi_query_request: MultiQueryRequest
) -> SearchResponse:
    """Perform multi-query search with LLM-based query expansion and RRF fusion.

    Uses diverse multi-query rewriting (DMQR-RAG) to generate query variations
    and fuses results using Reciprocal Rank Fusion for improved retrieval.

    Args:
        request: FastAPI request object with app state.
        multi_query_request: Multi-query search parameters.

    Returns:
        Search results fused from multiple query variations.

    Raises:
        HTTPException: If search fails.
    """
    start_time = time.time()

    logger.info(
        f"Multi-query search request: query='{multi_query_request.text[:50]}...', "
        f"limit={multi_query_request.limit}, num_variations={multi_query_request.num_variations}"
    )

    # Verify multi-query retriever is available
    multi_query_retriever = getattr(request.app.state, "multi_query_retriever", None)
    if multi_query_retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Multi-query search unavailable: retriever not initialized",
        )

    try:
        # Update config if different from defaults
        multi_query_retriever.config = MultiQueryConfig(
            num_variations=multi_query_request.num_variations,
            strategies=multi_query_request.strategies,
            include_original=multi_query_request.include_original,
            rrf_k=multi_query_request.rrf_k,
        )

        # Build search filters
        filters = None
        if multi_query_request.filters:
            time_range = None
            if multi_query_request.filters.time_range:
                time_range = TimeRange(
                    start=multi_query_request.filters.time_range.get("start", 0),
                    end=multi_query_request.filters.time_range.get("end", 0),
                )
            filters = SearchFilters(
                session_id=multi_query_request.filters.session_id,
                type=multi_query_request.filters.type,
                time_range=time_range,
            )

        # Convert string strategy/tier to enums if provided
        strategy = (
            SearchStrategy(multi_query_request.strategy) if multi_query_request.strategy else None
        )
        rerank_tier = (
            RerankerTier(multi_query_request.rerank_tier)
            if multi_query_request.rerank_tier
            else None
        )

        # Build search query
        query = SearchQuery(
            text=multi_query_request.text,
            limit=multi_query_request.limit,
            threshold=multi_query_request.threshold,
            filters=filters,
            strategy=strategy,
            rerank=multi_query_request.rerank,
            rerank_tier=rerank_tier,
            rerank_depth=multi_query_request.rerank_depth,
        )

        # Execute multi-query search
        results = await multi_query_retriever.search(query)

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

        logger.info(
            f"Multi-query search completed: results={len(search_results)}, took_ms={took_ms}"
        )

        return SearchResponse(
            results=search_results,
            total=len(search_results),
            took_ms=took_ms,
        )

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Multi-query search failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Multi-query search failed: {str(e)}",
        ) from e


@router.post("/search/session-aware", response_model=SessionAwareResponse)
async def session_aware_search(
    request: Request, session_request: SessionAwareRequest
) -> SessionAwareResponse:
    """Perform session-aware hierarchical retrieval.

    Implements two-stage retrieval:
    1. Stage 1: Retrieve top-S sessions based on session summaries
    2. Stage 2: Retrieve top-T turns within each matched session
    3. Optional reranking of combined results

    Args:
        request: FastAPI request object with app state.
        session_request: Session-aware search parameters.

    Returns:
        Search results with session context.

    Raises:
        HTTPException: If search fails.
    """
    start_time = time.time()

    logger.info(
        f"Session-aware search request: query='{session_request.query[:50]}...', "
        f"top_sessions={session_request.top_sessions}, "
        f"turns_per_session={session_request.turns_per_session}"
    )

    # Verify session-aware retriever is available
    session_aware_retriever = getattr(request.app.state, "session_aware_retriever", None)
    if session_aware_retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Session-aware search unavailable: retriever not initialized",
        )

    try:
        # Update config if different from defaults
        session_aware_retriever.config = SessionRetrieverConfig(
            top_sessions=session_request.top_sessions,
            turns_per_session=session_request.turns_per_session,
            final_top_k=session_request.final_top_k,
        )

        # Execute session-aware retrieval
        results = await session_aware_retriever.retrieve(session_request.query)

        # Calculate timing
        took_ms = int((time.time() - start_time) * 1000)

        # Map results to response schema
        session_results = [
            SessionAwareResult(
                id=str(r.id),
                score=r.score,
                payload=r.payload,
                session_id=r.session_id,
                session_summary=r.session_summary,
                session_score=r.session_score,
                rrf_score=r.rrf_score,
                reranker_score=r.reranker_score,
            )
            for r in results
        ]

        logger.info(
            f"Session-aware search completed: results={len(session_results)}, took_ms={took_ms}"
        )

        return SessionAwareResponse(
            results=session_results,
            total=len(session_results),
            took_ms=took_ms,
        )

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Session-aware search failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Session-aware search failed: {str(e)}",
        ) from e
