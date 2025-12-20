"""Main search retriever with hybrid search and reranking capabilities.

This module implements the core search retrieval pipeline for Engram, supporting:
- Multiple search strategies (dense, sparse, hybrid)
- Qdrant's built-in Reciprocal Rank Fusion for hybrid search
- Multi-tier reranking with graceful degradation
- Automatic strategy selection via query classification
"""

import asyncio
import logging
from typing import Any

from qdrant_client.http import models

from search.clients.qdrant import QdrantClientWrapper
from search.config import Settings
from search.embedders.factory import EmbedderFactory
from search.rerankers.router import RerankerRouter
from search.retrieval.classifier import QueryClassifier
from search.retrieval.constants import (
    CODE_DENSE_FIELD,
    MIN_SCORE_DENSE,
    MIN_SCORE_HYBRID,
    MIN_SCORE_SPARSE,
    RERANK_TIMEOUT_MS,
    SPARSE_FIELD,
    TEXT_DENSE_FIELD,
)
from search.retrieval.types import SearchQuery, SearchResultItem, SearchStrategy

logger = logging.getLogger(__name__)


class SearchRetriever:
    """Main search retriever with hybrid search and multi-tier reranking.

    Provides the core retrieval pipeline for Engram's search service:
    - Dense vector search using BGE embeddings
    - Sparse vector search using SPLADE embeddings
    - Hybrid search with Qdrant's built-in RRF fusion
    - Multi-tier reranking (fast, accurate, code, ColBERT, LLM)
    - Graceful degradation on reranker failures
    - Automatic strategy selection via query classification

    Attributes:
        qdrant_client: Qdrant client wrapper for vector operations.
        embedder_factory: Factory for creating embedder instances.
        reranker_router: Router for tier-based reranking.
        classifier: Query classifier for automatic strategy selection.
        settings: Application settings.
        collection_name: Qdrant collection name.
    """

    def __init__(
        self,
        qdrant_client: QdrantClientWrapper,
        embedder_factory: EmbedderFactory,
        reranker_router: RerankerRouter,
        settings: Settings,
    ) -> None:
        """Initialize search retriever.

        Args:
            qdrant_client: Qdrant client wrapper.
            embedder_factory: Factory for embedder instances.
            reranker_router: Router for reranking.
            settings: Application settings.
        """
        self.qdrant_client = qdrant_client
        self.embedder_factory = embedder_factory
        self.reranker_router = reranker_router
        self.settings = settings
        self.classifier = QueryClassifier()
        self.collection_name = settings.qdrant_collection

    async def search(self, query: SearchQuery) -> list[SearchResultItem]:
        """Execute search with optional reranking.

        Main entry point for search queries. Handles:
        1. Strategy selection (auto or explicit)
        2. Vector embedding generation
        3. Qdrant search execution (dense/sparse/hybrid)
        4. Optional reranking with timeout and fallback
        5. Result mapping and score assignment

        Args:
            query: Search query with retrieval parameters.

        Returns:
            List of search result items sorted by relevance.
        """
        text = query.text
        limit = query.limit
        threshold = query.threshold
        filters = query.filters
        user_strategy = query.strategy
        rerank = query.rerank
        rerank_tier = query.rerank_tier
        rerank_depth = query.rerank_depth

        # Determine effective limit: oversample if reranking is enabled
        fetch_limit = max(rerank_depth, limit) if rerank else limit

        # Determine strategy using classifier if not provided
        strategy: SearchStrategy | str = user_strategy or SearchStrategy.HYBRID
        if not user_strategy:
            classification = self.classifier.classify(text)
            strategy = classification["strategy"]  # type: ignore

        # Convert string to enum if needed
        if isinstance(strategy, str):
            strategy = SearchStrategy(strategy)

        # Get effective threshold based on strategy
        threshold_map = {
            SearchStrategy.DENSE: MIN_SCORE_DENSE,
            SearchStrategy.SPARSE: MIN_SCORE_SPARSE,
            SearchStrategy.HYBRID: MIN_SCORE_HYBRID,
        }
        effective_threshold = threshold if threshold is not None else threshold_map[strategy]

        # Determine which vector field to use based on type filter
        is_code_search = filters and filters.type == "code"
        vector_name = CODE_DENSE_FIELD if is_code_search else TEXT_DENSE_FIELD

        # Build Qdrant filter
        qdrant_filter = self._build_qdrant_filter(filters)

        # Fetch raw results based on strategy
        if strategy == SearchStrategy.DENSE:
            raw_results = await self._search_dense(
                text=text,
                vector_field=vector_name,
                limit=fetch_limit,
                threshold=effective_threshold,
                qdrant_filter=qdrant_filter,
            )
        elif strategy == SearchStrategy.SPARSE:
            raw_results = await self._search_sparse(
                text=text,
                limit=fetch_limit,
                threshold=effective_threshold,
                qdrant_filter=qdrant_filter,
            )
        elif strategy == SearchStrategy.HYBRID:
            raw_results = await self._search_hybrid(
                text=text,
                vector_field=vector_name,
                limit=fetch_limit,
                qdrant_filter=qdrant_filter,
            )
        else:
            logger.error(f"Unknown search strategy: {strategy}")
            return []

        logger.debug(
            f"Retrieved {len(raw_results)} results for strategy={strategy}, "
            f"fetch_limit={fetch_limit}"
        )

        # Apply reranking if enabled
        if rerank and raw_results:
            return await self._apply_reranking(
                query_text=text,
                raw_results=raw_results,
                limit=limit,
                rerank_tier=rerank_tier,
                strategy=strategy,
            )

        # No reranking - return raw results trimmed to limit
        logger.debug(f"Skipping reranking (rerank={rerank}, results={len(raw_results)})")
        return self._map_raw_results(raw_results[:limit])

    async def _search_dense(
        self,
        text: str,
        vector_field: str,
        limit: int,
        threshold: float,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute dense vector search.

        Uses semantic embeddings (BGE or Nomic) for dense retrieval.

        Args:
            text: Query text.
            vector_field: Vector field name (text_dense or code_dense).
            limit: Number of results to retrieve.
            threshold: Minimum score threshold.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points from Qdrant.
        """
        # Get appropriate embedder based on vector field and generate embedding
        if vector_field == CODE_DENSE_FIELD:
            vector = await self.embedder_factory.get_code_embedder().embed(text, is_query=True)
        else:
            vector = await self.embedder_factory.get_text_embedder().embed(text, is_query=True)

        # Execute Qdrant dense search using query_points
        results = await self.qdrant_client.client.query_points(
            collection_name=self.collection_name,
            query=vector,
            using=vector_field,
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
            score_threshold=threshold,
        )

        return results.points

    async def _search_sparse(
        self,
        text: str,
        limit: int,
        threshold: float,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute sparse vector search.

        Uses SPLADE embeddings for keyword-based retrieval.

        Args:
            text: Query text.
            limit: Number of results to retrieve.
            threshold: Minimum score threshold.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points from Qdrant.
        """
        # Get sparse embedder
        sparse_embedder = self.embedder_factory.get_sparse_embedder()

        # Generate sparse query vector
        sparse_dict = sparse_embedder.embed_sparse(text)

        # Convert to Qdrant sparse vector format
        sparse_vector = models.SparseVector(
            indices=list(sparse_dict.keys()),
            values=list(sparse_dict.values()),
        )

        # Execute Qdrant sparse search using query API
        results = await self.qdrant_client.client.query_points(
            collection_name=self.collection_name,
            query=sparse_vector,
            using=SPARSE_FIELD,
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
            score_threshold=threshold,
        )

        return results.points

    async def _search_hybrid(
        self,
        text: str,
        vector_field: str,
        limit: int,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute hybrid search with RRF fusion.

        Combines dense and sparse search using Qdrant's built-in RRF fusion.

        Args:
            text: Query text.
            vector_field: Dense vector field name (text_dense or code_dense).
            limit: Number of results to retrieve.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points with RRF scores.
        """
        # Generate both vectors in parallel
        if vector_field == CODE_DENSE_FIELD:
            dense_vector, sparse_dict = await asyncio.gather(
                self.embedder_factory.get_code_embedder().embed(text, is_query=True),
                asyncio.to_thread(self.embedder_factory.get_sparse_embedder().embed_sparse, text),
            )
        else:
            dense_vector, sparse_dict = await asyncio.gather(
                self.embedder_factory.get_text_embedder().embed(text, is_query=True),
                asyncio.to_thread(self.embedder_factory.get_sparse_embedder().embed_sparse, text),
            )

        # Convert sparse dict to Qdrant format
        sparse_vector = models.SparseVector(
            indices=list(sparse_dict.keys()),
            values=list(sparse_dict.values()),
        )

        # Execute hybrid search with prefetch + RRF fusion
        results = await self.qdrant_client.client.query_points(
            collection_name=self.collection_name,
            prefetch=[
                models.Prefetch(
                    query=dense_vector,
                    using=vector_field,
                    limit=limit * 2,  # Oversample for fusion
                ),
                models.Prefetch(
                    query=sparse_vector,
                    using=SPARSE_FIELD,
                    limit=limit * 2,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
            # No score threshold with RRF (scores are rank-based)
        )

        return results.points

    async def _apply_reranking(
        self,
        query_text: str,
        raw_results: list[models.ScoredPoint],
        limit: int,
        rerank_tier: str | None,
        strategy: SearchStrategy,
    ) -> list[SearchResultItem]:
        """Apply reranking with timeout and graceful degradation.

        Args:
            query_text: Original query text.
            raw_results: Raw search results from Qdrant.
            limit: Final result limit.
            rerank_tier: Reranker tier to use (auto-selected if None).
            strategy: Search strategy used.

        Returns:
            List of search result items with reranking scores.
        """
        rerank_start_time = asyncio.get_event_loop().time()

        logger.debug(
            f"Starting reranking: strategy={strategy}, "
            f"candidates={len(raw_results)}, tier={rerank_tier}"
        )

        # Extract documents for reranking
        documents = []
        for result in raw_results:
            payload = result.payload or {}
            content = payload.get("content", "")
            documents.append(str(content))

        # Auto-select tier if not specified
        effective_tier = rerank_tier or "fast"

        # Apply reranking with router (handles timeout and fallback)
        try:
            reranked_results, actual_tier, degraded = await self.reranker_router.rerank(
                query=query_text,
                documents=documents,
                tier=effective_tier,  # type: ignore[arg-type]
                top_k=limit,
                timeout_ms=RERANK_TIMEOUT_MS,
                fallback_tier="fast",
            )

            rerank_latency_ms = (asyncio.get_event_loop().time() - rerank_start_time) * 1000

            # Calculate score statistics
            original_scores = [r.score for r in raw_results[:limit]]
            reranked_scores = [r.score for r in reranked_results]

            if original_scores and reranked_scores:
                avg_original = sum(original_scores) / len(original_scores)
                avg_reranked = sum(reranked_scores) / len(reranked_scores)
                score_improvement = avg_reranked - avg_original

                logger.info(
                    f"Reranking completed: strategy={strategy}, "
                    f"candidates={len(raw_results)}, returned={len(reranked_results)}, "
                    f"tier={actual_tier}, degraded={degraded}, "
                    f"latency_ms={rerank_latency_ms:.2f}, "
                    f"avg_original={avg_original:.3f}, "
                    f"avg_reranked={avg_reranked:.3f}, "
                    f"improvement={score_improvement:.3f}"
                )

            # Map reranked results back to original with scores
            result_items = []
            for ranked in reranked_results:
                if ranked.original_index is None or ranked.original_index >= len(raw_results):
                    continue

                original = raw_results[ranked.original_index]
                # Convert UUID to string if necessary
                result_id = original.id if isinstance(original.id, (str, int)) else str(original.id)
                item = SearchResultItem(
                    id=result_id,
                    score=ranked.score,  # Use reranker score as final score
                    rrf_score=original.score,  # Preserve original score
                    reranker_score=ranked.score,
                    rerank_tier=actual_tier,  # type: ignore[arg-type]
                    payload=original.payload or {},
                    degraded=degraded,
                    degraded_reason=f"Reranker tier {actual_tier}" if degraded else None,
                )
                result_items.append(item)

            return result_items

        except Exception as e:
            rerank_latency_ms = (asyncio.get_event_loop().time() - rerank_start_time) * 1000
            error_message = str(e)

            logger.error(
                f"Reranking failed - graceful degradation to original results: "
                f"strategy={strategy}, candidates={len(raw_results)}, "
                f"latency_ms={rerank_latency_ms:.2f}, error={error_message}",
                exc_info=True,
            )

            # Return raw results with degradation flags
            degraded_results = []
            for result in raw_results[:limit]:
                # Convert UUID to string if necessary
                result_id = str(result.id) if not isinstance(result.id, (str, int)) else result.id
                item = SearchResultItem(
                    id=result_id,
                    score=result.score,
                    payload=result.payload or {},
                    degraded=True,
                    degraded_reason=f"Reranker failed: {error_message}",
                )
                degraded_results.append(item)

            return degraded_results

    def _build_qdrant_filter(
        self, filters: Any | None
    ) -> models.Filter | None:  # SearchFilters | None
        """Build Qdrant filter from search filters.

        Args:
            filters: Optional search filters.

        Returns:
            Qdrant filter object or None.
        """
        if not filters:
            return None

        conditions = []

        if hasattr(filters, "session_id") and filters.session_id:
            conditions.append(
                models.FieldCondition(
                    key="session_id",
                    match=models.MatchValue(value=filters.session_id),
                )
            )

        if hasattr(filters, "type") and filters.type:
            conditions.append(
                models.FieldCondition(
                    key="type",
                    match=models.MatchValue(value=filters.type),
                )
            )

        if hasattr(filters, "time_range") and filters.time_range:
            time_range = filters.time_range
            conditions.append(
                models.FieldCondition(
                    key="timestamp",
                    range=models.Range(
                        gte=time_range.start,
                        lte=time_range.end,
                    ),
                )
            )

        if not conditions:
            return None

        return models.Filter(must=conditions)  # type: ignore[arg-type]

    def _map_raw_results(self, results: list[models.ScoredPoint]) -> list[SearchResultItem]:
        """Map raw Qdrant results to SearchResultItem.

        Args:
            results: Raw scored points from Qdrant.

        Returns:
            List of search result items.
        """
        items = []
        for result in results:
            # Convert UUID to string if necessary
            result_id = str(result.id) if not isinstance(result.id, (str, int)) else result.id
            item = SearchResultItem(
                id=result_id,
                score=result.score,
                payload=result.payload or {},
            )
            items.append(item)
        return items
