"""API route handlers for search endpoints."""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from src.api.schemas import (
    ConflictCandidateRequest,
    ConflictCandidateResponse,
    EmbedRequest,
    EmbedResponse,
    HealthResponse,
    MemoryIndexRequest,
    MemoryIndexResponse,
    MultiQueryRequest,
    SearchRequest,
    SearchResponse,
    SearchResult,
    SessionAwareRequest,
    SessionAwareResponse,
    SessionAwareResult,
)
from src.config import get_settings
from src.middleware.auth import ApiKeyContext, optional_scope
from src.retrieval.multi_query import MultiQueryConfig
from src.retrieval.session import SessionRetrieverConfig
from src.retrieval.types import RerankerTier, SearchFilters, SearchQuery, SearchStrategy, TimeRange
from src.services.schema_manager import SchemaManager, get_memory_collection_schema
from src.utils.metrics import get_content_type, get_metrics

logger = logging.getLogger(__name__)

# Auth dependency for search operations (requires memory:read scope when auth enabled)
search_auth = Depends(optional_scope("memory:read", "search:read"))

# Auth dependency for index operations (requires memory:write scope when auth enabled)
index_auth = Depends(optional_scope("memory:write", "search:write"))

# Auth dependency for admin operations
admin_auth = Depends(optional_scope("admin", "memory:write"))

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


@router.post("/query", response_model=SearchResponse)
async def search(
    request: Request,
    search_request: SearchRequest,
    api_key: ApiKeyContext = search_auth,
) -> SearchResponse:
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
        f"rerank={search_request.rerank}, key={api_key.prefix}"
    )

    # Verify search retriever is available
    search_retriever = getattr(request.app.state, "search_retriever", None)
    if search_retriever is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Search service unavailable: retriever not initialized",
        )

    try:
        # Build search filters - ALWAYS include org_id for tenant isolation
        time_range = None
        if search_request.filters and search_request.filters.time_range:
            time_range = TimeRange(
                start=search_request.filters.time_range.get("start", 0),
                end=search_request.filters.time_range.get("end", 0),
            )

        # CRITICAL: org_id is mandatory for all queries (tenant isolation)
        filters = SearchFilters(
            org_id=api_key.org_id,  # Injected from authenticated user's token
            session_id=search_request.filters.session_id if search_request.filters else None,
            type=search_request.filters.type if search_request.filters else None,
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

        # Execute search - use turns collection by default
        collection = search_request.collection or "engram_turns"
        if collection == "engram_turns":
            results = await search_retriever.search_turns(query)
        elif collection == "engram_memory":
            # Direct Qdrant search for memory collection with proper filtering
            from qdrant_client.http import models

            embedder_factory = getattr(request.app.state, "embedder_factory", None)
            qdrant = getattr(request.app.state, "qdrant", None)
            text_embedder = await embedder_factory.get_embedder("text")
            query_vector = await text_embedder.embed(search_request.text, is_query=True)

            # Build filter conditions - ALWAYS include org_id for tenant isolation
            conditions: list[models.Condition] = [
                models.FieldCondition(
                    key="org_id",
                    match=models.MatchValue(value=api_key.org_id),
                )
            ]

            # Add type filter if specified
            if filters.type:
                conditions.append(
                    models.FieldCondition(
                        key="type",
                        match=models.MatchValue(value=filters.type),
                    )
                )

            # Add session_id filter if specified
            if filters.session_id:
                conditions.append(
                    models.FieldCondition(
                        key="source_session_id",
                        match=models.MatchValue(value=filters.session_id),
                    )
                )

            qdrant_filter = models.Filter(must=conditions)

            qdrant_results = await qdrant.client.query_points(
                collection_name="engram_memory",
                query=query_vector,
                using="text_dense",
                query_filter=qdrant_filter,
                limit=search_request.limit,
                score_threshold=search_request.threshold,
            )

            results = [
                SearchResult(
                    id=str(p.id),
                    score=p.score,
                    rrf_score=None,
                    reranker_score=None,
                    rerank_tier=None,
                    payload=p.payload or {},
                    degraded=False,
                )
                for p in qdrant_results.points
            ]
            took_ms = int((time.time() - start_time) * 1000)
            return SearchResponse(results=results, total=len(results), took_ms=took_ms)
        else:
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
async def embed(
    request: Request,
    embed_request: EmbedRequest,
    api_key: ApiKeyContext = search_auth,
) -> EmbedResponse:
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
        f"type={embed_request.embedder_type}, is_query={embed_request.is_query}, "
        f"key={api_key.prefix}"
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


@router.post("/multi-query", response_model=SearchResponse)
async def multi_query_search(
    request: Request,
    multi_query_request: MultiQueryRequest,
    api_key: ApiKeyContext = search_auth,
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
        f"limit={multi_query_request.limit}, num_variations={multi_query_request.num_variations}, "
        f"key={api_key.prefix}"
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

        # Build search filters - ALWAYS include org_id for tenant isolation
        time_range = None
        if multi_query_request.filters and multi_query_request.filters.time_range:
            time_range = TimeRange(
                start=multi_query_request.filters.time_range.get("start", 0),
                end=multi_query_request.filters.time_range.get("end", 0),
            )

        # CRITICAL: org_id is mandatory for all queries (tenant isolation)
        filters = SearchFilters(
            org_id=api_key.org_id,  # Injected from authenticated user's token
            session_id=multi_query_request.filters.session_id
            if multi_query_request.filters
            else None,
            type=multi_query_request.filters.type if multi_query_request.filters else None,
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


@router.post("/session-aware", response_model=SessionAwareResponse)
async def session_aware_search(
    request: Request,
    session_request: SessionAwareRequest,
    api_key: ApiKeyContext = search_auth,
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
        f"turns_per_session={session_request.turns_per_session}, "
        f"key={api_key.prefix}"
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

        # Execute session-aware retrieval with org_id for tenant isolation
        # TODO: Update SessionAwareRetriever to accept org_id filter
        # For now, use api_key.org_id when retriever supports it
        results = await session_aware_retriever.retrieve(
            session_request.query,
            org_id=api_key.org_id,
        )

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


@router.post("/index-memory", response_model=MemoryIndexResponse)
async def index_memory(
    request: Request,
    memory_request: MemoryIndexRequest,
    api_key: ApiKeyContext = index_auth,
) -> MemoryIndexResponse:
    """Index a memory node for semantic search.

    Embeds the memory content and stores it in Qdrant for later retrieval
    via the recall endpoint.

    Args:
        request: FastAPI request object with app state.
        memory_request: Memory to index with content and metadata.

    Returns:
        Indexing result with timing information.

    Raises:
        HTTPException: If indexing fails.
    """
    start_time = time.time()

    logger.info(
        f"Memory index request: id={memory_request.id}, "
        f"type={memory_request.type}, content_len={len(memory_request.content)}, "
        f"key={api_key.prefix}"
    )

    # Verify Qdrant and embedder are available
    qdrant = getattr(request.app.state, "qdrant", None)
    embedder_factory = getattr(request.app.state, "embedder_factory", None)

    if qdrant is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Index service unavailable: Qdrant not initialized",
        )

    if embedder_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Index service unavailable: embedder factory not initialized",
        )

    try:
        import uuid

        from qdrant_client.http.models import PointStruct, SparseVector

        # Convert ULID to UUID for Qdrant compatibility
        # uuid5 creates a deterministic UUID from the ULID string
        point_uuid = str(uuid.uuid5(uuid.NAMESPACE_OID, memory_request.id))

        # Get embedders
        text_embedder = await embedder_factory.get_embedder("text")

        # Get sparse embedder (BM25 for huggingface backend, SPLADE for local)
        sparse_embedder = None
        try:
            sparse_embedder = await embedder_factory.get_sparse_embedder()
        except ImportError as e:
            logger.warning(f"Sparse embedder unavailable: {e}")

        # Generate embeddings
        dense_embedding = await text_embedder.embed(memory_request.content, is_query=False)

        # Build vectors dict - use text_dense/text_sparse to match search retriever
        vectors: dict = {
            "text_dense": dense_embedding,
        }

        # Add sparse embedding if available
        if sparse_embedder is not None:
            sparse_dict = sparse_embedder.embed_sparse(memory_request.content)
            if sparse_dict:
                # embed_sparse returns {token_id: weight}, convert to indices/values
                indices = list(sparse_dict.keys())
                values = list(sparse_dict.values())
                vectors["text_sparse"] = SparseVector(
                    indices=indices,
                    values=values,
                )

        # Build payload - include original ULID as node_id for reference
        # CRITICAL: org_id is mandatory for tenant isolation in vector search
        payload = {
            "content": memory_request.content,
            "type": memory_request.type,
            "tags": memory_request.tags,
            "project": memory_request.project,
            "source_session_id": memory_request.source_session_id,
            "node_id": memory_request.id,  # Original ULID for graph lookups
            "org_id": api_key.org_id,  # Tenant isolation - required for all queries
        }

        # Upsert to Qdrant - use UUID for point ID
        point = PointStruct(
            id=point_uuid,
            vector=vectors,
            payload=payload,
        )

        await qdrant.client.upsert(
            collection_name="engram_memory",
            points=[point],
        )

        took_ms = int((time.time() - start_time) * 1000)
        logger.info(f"Memory indexed: id={memory_request.id}, took_ms={took_ms}")

        return MemoryIndexResponse(
            id=memory_request.id,
            indexed=True,
            took_ms=took_ms,
        )

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Memory indexing failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Memory indexing failed: {str(e)}",
        ) from e


@router.post("/conflict-candidates", response_model=list[ConflictCandidateResponse])
async def get_conflict_candidates(
    request: Request,
    conflict_request: ConflictCandidateRequest,
    api_key: ApiKeyContext = search_auth,
) -> list[ConflictCandidateResponse]:
    """Find potential duplicate memories for deduplication.

    Embeds the provided content and searches for similar memories to detect
    potential conflicts before storing a new memory.

    Args:
        request: FastAPI request object with app state.
        conflict_request: Content to check for conflicts and optional project filter.
        api_key: Authenticated API key context with org_id.

    Returns:
        List of top 10 conflict candidates with similarity scores.

    Raises:
        HTTPException: If search fails.
    """
    start_time = time.time()

    logger.info(
        f"Conflict candidate search: content_len={len(conflict_request.content)}, "
        f"project={conflict_request.project}, key={api_key.prefix}"
    )

    # Verify embedder factory and Qdrant are available
    embedder_factory = getattr(request.app.state, "embedder_factory", None)
    qdrant = getattr(request.app.state, "qdrant", None)

    if embedder_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Conflict search unavailable: embedder factory not initialized",
        )

    if qdrant is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Conflict search unavailable: Qdrant not initialized",
        )

    try:
        from qdrant_client.http import models

        # Generate embedding for the content
        text_embedder = await embedder_factory.get_embedder("text")
        query_vector = await text_embedder.embed(conflict_request.content, is_query=True)

        # Build filter conditions - ALWAYS include org_id for tenant isolation
        conditions: list[models.Condition] = [
            models.FieldCondition(
                key="org_id",
                match=models.MatchValue(value=api_key.org_id),
            )
        ]

        # Add optional project filter
        if conflict_request.project:
            conditions.append(
                models.FieldCondition(
                    key="project",
                    match=models.MatchValue(value=conflict_request.project),
                )
            )

        qdrant_filter = models.Filter(must=conditions)

        # Query Qdrant with score_threshold=0.65 to find similar memories
        results = await qdrant.client.query_points(
            collection_name="engram_memory",
            query=query_vector,
            using="text_dense",
            query_filter=qdrant_filter,
            limit=10,
            score_threshold=0.65,
            with_payload=True,
        )

        took_ms = int((time.time() - start_time) * 1000)

        # Map results to response schema
        candidates = [
            ConflictCandidateResponse(
                id=p.payload.get("node_id", str(p.id)),
                content=p.payload.get("content", ""),
                type=p.payload.get("type", "context"),
                score=p.score,
                vt_start=p.payload.get("vt_start", 0),
            )
            for p in results.points
        ]

        logger.info(f"Conflict search completed: candidates={len(candidates)}, took_ms={took_ms}")

        return candidates

    except Exception as e:
        took_ms = int((time.time() - start_time) * 1000)
        logger.error(f"Conflict candidate search failed after {took_ms}ms: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Conflict candidate search failed: {str(e)}",
        ) from e


@router.post("/admin/{collection_name}/recreate")
async def recreate_collection(
    request: Request,
    collection_name: str,
    api_key: ApiKeyContext = admin_auth,
) -> dict:
    """Delete and recreate a collection with the current schema.

    WARNING: This deletes all existing vectors in the collection.

    Args:
        request: FastAPI request object with app state.
        collection_name: Name of the collection to recreate.

    Returns:
        Status of the operation.

    Raises:
        HTTPException: If operation fails.
    """
    logger.warning(
        f"Collection recreate requested: collection={collection_name}, key={api_key.prefix}"
    )

    qdrant = getattr(request.app.state, "qdrant", None)

    if qdrant is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unavailable: Qdrant not initialized",
        )

    settings = get_settings()

    # Only allow known collections
    allowed_collections = {"engram_memory", "engram_turns"}
    if collection_name not in allowed_collections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown collection: {collection_name}. Allowed: {allowed_collections}",
        )

    try:
        schema_manager = SchemaManager(qdrant, settings)

        # Get the appropriate schema
        if collection_name == "engram_memory":
            schema = get_memory_collection_schema(collection_name)
        else:
            from src.services.schema_manager import get_turns_collection_schema

            schema = get_turns_collection_schema(collection_name)

        # Delete existing collection
        deleted = await schema_manager.delete_collection(collection_name)

        # Create with new schema
        await schema_manager.create_collection(schema)

        logger.info(f"Collection recreated: {collection_name}, was_deleted={deleted}")

        return {
            "success": True,
            "collection": collection_name,
            "deleted": deleted,
            "created": True,
            "schema": {
                "dense_vector": schema.dense_vector_name,
                "sparse_vector": schema.sparse_vector_name,
                "colbert_enabled": schema.enable_colbert,
            },
        }

    except Exception as e:
        logger.error(f"Collection recreate failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Collection recreate failed: {str(e)}",
        ) from e
