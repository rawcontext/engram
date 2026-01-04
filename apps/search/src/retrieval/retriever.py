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

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.rerankers.router import RerankerRouter
from src.retrieval.classifier import QueryClassifier
from src.retrieval.constants import (
    CODE_DENSE_FIELD,
    SPARSE_FIELD,
    TEXT_DENSE_FIELD,
    TURN_DENSE_FIELD,
    TURN_SPARSE_FIELD,
)
from src.retrieval.types import RerankerTier, SearchQuery, SearchResultItem, SearchStrategy

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
        self.turns_collection_name = settings.qdrant_collection

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
        # Use config default (allows forcing dense when sparse unavailable)
        default_strategy = SearchStrategy(self.settings.search_default_strategy)
        strategy: SearchStrategy | str = user_strategy or default_strategy
        # Only use classifier for auto-selection when default is hybrid
        # This allows forcing dense mode when sparse embeddings are unavailable
        if not user_strategy and default_strategy == SearchStrategy.HYBRID:
            classification = self.classifier.classify(text)
            strategy = classification["strategy"]

        # Convert string to enum if needed
        if isinstance(strategy, str):
            strategy = SearchStrategy(strategy)

        # Get effective threshold based on strategy
        threshold_map = {
            SearchStrategy.DENSE: self.settings.search_min_score_dense,
            SearchStrategy.SPARSE: self.settings.search_min_score_sparse,
            SearchStrategy.HYBRID: self.settings.search_min_score_hybrid,
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
            embedder = await self.embedder_factory.get_code_embedder()
            vector = await embedder.embed(text, is_query=True)
        else:
            embedder = await self.embedder_factory.get_text_embedder()
            vector = await embedder.embed(text, is_query=True)

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
        sparse_embedder = await self.embedder_factory.get_sparse_embedder()

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
            code_embedder = await self.embedder_factory.get_code_embedder()
            sparse_embedder = await self.embedder_factory.get_sparse_embedder()
            dense_vector, sparse_dict = await asyncio.gather(
                code_embedder.embed(text, is_query=True),
                asyncio.to_thread(sparse_embedder.embed_sparse, text),
            )
        else:
            text_embedder = await self.embedder_factory.get_text_embedder()
            sparse_embedder = await self.embedder_factory.get_sparse_embedder()
            dense_vector, sparse_dict = await asyncio.gather(
                text_embedder.embed(text, is_query=True),
                asyncio.to_thread(sparse_embedder.embed_sparse, text),
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

        # Auto-select tier based on query complexity if not specified
        effective_tier = self._select_reranker_tier(query_text, rerank_tier)

        # Apply reranking with router (handles timeout and fallback)
        try:
            reranked_results, actual_tier, degraded = await self.reranker_router.rerank(
                query=query_text,
                documents=documents,
                tier=effective_tier,
                top_k=limit,
                timeout_ms=self.settings.reranker_timeout_ms,
                fallback_tier=RerankerTier.FAST,
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
                    rerank_tier=actual_tier,
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

        CRITICAL: org_id filter is ALWAYS required for tenant isolation.
        This method enforces the security boundary at the retriever level.

        Args:
            filters: Optional search filters (must contain org_id).

        Returns:
            Qdrant filter object or None.

        Raises:
            ValueError: If filters is None or org_id is missing/empty.
        """
        # CRITICAL SECURITY BOUNDARY: org_id is mandatory for all queries
        if not filters:
            raise ValueError(
                "Search filters are required for tenant isolation. "
                "org_id must be provided for all Qdrant queries."
            )

        if not hasattr(filters, "org_id") or not filters.org_id:
            raise ValueError(
                "org_id is required for tenant isolation. "
                "All Qdrant queries must include a valid org_id filter."
            )

        conditions: list[models.Condition] = []

        # ALWAYS apply org_id filter for tenant isolation - this is the security boundary
        conditions.append(
            models.FieldCondition(
                key="org_id",
                match=models.MatchValue(value=filters.org_id),
            )
        )

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
                        gte=time_range["start"],
                        lte=time_range["end"],
                    ),
                )
            )

        if hasattr(filters, "vt_end_after") and filters.vt_end_after is not None:
            conditions.append(
                models.FieldCondition(
                    key="vt_end",
                    range=models.Range(
                        gt=filters.vt_end_after,
                    ),
                )
            )

        return models.Filter(must=conditions)

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

    def _select_reranker_tier(
        self,
        query_text: str,
        explicit_tier: str | None,
    ) -> RerankerTier:
        """Select reranker tier based on query complexity.

        Uses the query classifier to determine optimal tier when not explicitly
        specified. Selection logic:
        - Code queries → CODE tier (specialized cross-encoder)
        - Semantic questions → COLBERT tier (late-interaction for nuanced similarity)
        - Simple queries → FAST tier (low-latency FlashRank)
        - Moderate/Complex → ACCURATE tier (cross-encoder)

        Args:
            query_text: Query text to classify.
            explicit_tier: Explicitly requested tier (used if provided).

        Returns:
            Selected reranker tier.
        """
        # Use explicit tier if provided
        if explicit_tier:
            if isinstance(explicit_tier, RerankerTier):
                return explicit_tier
            return RerankerTier(explicit_tier)

        # Classify query complexity
        classification = self.classifier.classify_complexity(query_text)

        # Code queries get CODE tier for specialized reranking
        if classification.features.has_code:
            logger.debug(
                f"Auto-selected CODE tier: query has code patterns, score={classification.score}"
            )
            return RerankerTier.CODE

        # Semantic questions benefit from ColBERT's late-interaction mechanism
        # ColBERT excels at nuanced semantic similarity via token-level interactions
        if classification.features.is_question and not classification.features.has_quotes:
            logger.debug(
                f"Auto-selected COLBERT tier: semantic question without exact match intent, "
                f"score={classification.score}"
            )
            return RerankerTier.COLBERT

        # Map complexity to tier
        from src.retrieval.types import QueryComplexity

        tier_map = {
            QueryComplexity.SIMPLE: RerankerTier.FAST,
            QueryComplexity.MODERATE: RerankerTier.ACCURATE,
            QueryComplexity.COMPLEX: RerankerTier.ACCURATE,
        }

        selected_tier = tier_map[classification.complexity]

        logger.debug(
            f"Auto-selected {selected_tier.value} tier: "
            f"complexity={classification.complexity.value}, "
            f"score={classification.score}"
        )

        return selected_tier

    async def search_turns(
        self,
        query: SearchQuery,
    ) -> list[SearchResultItem]:
        """Search the engram_turns collection for complete conversation turns.

        This method searches the turn-level collection which contains complete
        user + assistant + reasoning content, providing better semantic context
        for retrieval compared to fragment-level indexing.

        Args:
            query: Search query with retrieval parameters.

        Returns:
            List of search result items sorted by relevance.
        """
        text = query.text
        limit = query.limit
        filters = query.filters
        user_strategy = query.strategy
        rerank = query.rerank
        rerank_tier = query.rerank_tier
        rerank_depth = query.rerank_depth

        # Determine effective limit: oversample if reranking is enabled
        fetch_limit = max(rerank_depth, limit) if rerank else limit

        # Determine strategy using classifier if not provided
        # Use config default (allows forcing dense when sparse unavailable)
        default_strategy = SearchStrategy(self.settings.search_default_strategy)
        strategy: SearchStrategy | str = user_strategy or default_strategy
        # Only use classifier for auto-selection when default is hybrid
        # This allows forcing dense mode when sparse embeddings are unavailable
        if not user_strategy and default_strategy == SearchStrategy.HYBRID:
            classification = self.classifier.classify(text)
            strategy = classification["strategy"]

        # Convert string to enum if needed
        if isinstance(strategy, str):
            strategy = SearchStrategy(strategy)

        # Build Qdrant filter
        qdrant_filter = self._build_qdrant_filter(filters)

        # Fetch results from turns collection
        try:
            if strategy == SearchStrategy.DENSE:
                raw_results = await self._search_turns_dense(
                    text=text,
                    limit=fetch_limit,
                    qdrant_filter=qdrant_filter,
                )
            elif strategy == SearchStrategy.SPARSE:
                raw_results = await self._search_turns_sparse(
                    text=text,
                    limit=fetch_limit,
                    qdrant_filter=qdrant_filter,
                )
            else:  # HYBRID
                raw_results = await self._search_turns_hybrid(
                    text=text,
                    limit=fetch_limit,
                    qdrant_filter=qdrant_filter,
                )

            logger.debug(
                f"Retrieved {len(raw_results)} turn results for strategy={strategy}, "
                f"fetch_limit={fetch_limit}"
            )

        except Exception as e:
            logger.error(f"Turn search failed: {e}")
            raise

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
        return self._map_raw_results(raw_results[:limit])

    async def _search_turns_dense(
        self,
        text: str,
        limit: int,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute dense vector search on turns collection.

        Args:
            text: Query text.
            limit: Number of results to retrieve.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points from Qdrant.
        """
        embedder = await self.embedder_factory.get_text_embedder()
        vector = await embedder.embed(text, is_query=True)

        results = await self.qdrant_client.client.query_points(
            collection_name=self.turns_collection_name,
            query=vector,
            using=TURN_DENSE_FIELD,
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
            score_threshold=self.settings.search_min_score_dense,
        )

        return results.points

    async def _search_turns_sparse(
        self,
        text: str,
        limit: int,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute sparse vector search on turns collection.

        Args:
            text: Query text.
            limit: Number of results to retrieve.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points from Qdrant.
        """
        sparse_embedder = await self.embedder_factory.get_sparse_embedder()
        sparse_dict = sparse_embedder.embed_sparse(text)

        sparse_vector = models.SparseVector(
            indices=list(sparse_dict.keys()),
            values=list(sparse_dict.values()),
        )

        results = await self.qdrant_client.client.query_points(
            collection_name=self.turns_collection_name,
            query=sparse_vector,
            using=TURN_SPARSE_FIELD,
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
            score_threshold=self.settings.search_min_score_sparse,
        )

        return results.points

    async def _search_turns_hybrid(
        self,
        text: str,
        limit: int,
        qdrant_filter: models.Filter | None,
    ) -> list[models.ScoredPoint]:
        """Execute hybrid search on turns collection with RRF fusion.

        Args:
            text: Query text.
            limit: Number of results to retrieve.
            qdrant_filter: Optional Qdrant filter.

        Returns:
            List of scored points with RRF scores.
        """
        # Generate both vectors in parallel
        text_embedder = await self.embedder_factory.get_text_embedder()
        sparse_embedder = await self.embedder_factory.get_sparse_embedder()
        dense_vector, sparse_dict = await asyncio.gather(
            text_embedder.embed(text, is_query=True),
            asyncio.to_thread(sparse_embedder.embed_sparse, text),
        )

        sparse_vector = models.SparseVector(
            indices=list(sparse_dict.keys()),
            values=list(sparse_dict.values()),
        )

        # Execute hybrid search with prefetch + RRF fusion
        results = await self.qdrant_client.client.query_points(
            collection_name=self.turns_collection_name,
            prefetch=[
                models.Prefetch(
                    query=dense_vector,
                    using=TURN_DENSE_FIELD,
                    limit=limit * 2,
                ),
                models.Prefetch(
                    query=sparse_vector,
                    using=TURN_SPARSE_FIELD,
                    limit=limit * 2,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
        )

        return results.points

    def aggregate_by_session(
        self,
        results: list[SearchResultItem],
        max_per_session: int = 3,
        min_sessions: int = 2,
    ) -> list[SearchResultItem]:
        """Aggregate search results to limit dominance by single session.

        Prevents a single session from dominating results by limiting the
        number of results per session while ensuring diversity.

        Args:
            results: List of search results to aggregate.
            max_per_session: Maximum results per session (default: 3).
            min_sessions: Minimum number of sessions to include (default: 2).

        Returns:
            Aggregated results with per-session limits applied.
        """
        if not results:
            return []

        # Group results by session
        session_results: dict[str, list[SearchResultItem]] = {}
        no_session_results: list[SearchResultItem] = []

        for result in results:
            session_id = result.payload.get("session_id")
            if session_id:
                if session_id not in session_results:
                    session_results[session_id] = []
                session_results[session_id].append(result)
            else:
                no_session_results.append(result)

        # Sort each session's results by score
        for session_id in session_results:
            session_results[session_id].sort(key=lambda r: r.score, reverse=True)

        # Calculate per-session limit (allow more if few sessions)
        num_sessions = len(session_results)
        effective_limit = max_per_session * 2 if num_sessions < min_sessions else max_per_session

        # Build aggregated results
        aggregated: list[SearchResultItem] = []

        # Round-robin collection to ensure session diversity
        session_ids = list(session_results.keys())
        indices: dict[str, int] = dict.fromkeys(session_ids, 0)

        # Collect results round-robin until all sessions exhausted up to their limit
        while True:
            added_any = False
            for session_id in session_ids:
                idx = indices[session_id]
                if idx < min(len(session_results[session_id]), effective_limit):
                    aggregated.append(session_results[session_id][idx])
                    indices[session_id] += 1
                    added_any = True
            if not added_any:
                break

        # Add results without session_id at the end
        aggregated.extend(no_session_results)

        # Sort final results by score
        aggregated.sort(key=lambda r: r.score, reverse=True)

        logger.debug(
            f"Aggregated {len(results)} results to {len(aggregated)} "
            f"(sessions: {num_sessions}, max_per_session: {effective_limit})"
        )

        return aggregated

    def deduplicate_results(
        self,
        results: list[SearchResultItem],
    ) -> list[SearchResultItem]:
        """Deduplicate search results by ID and content.

        Removes duplicate results based on ID and content similarity to ensure
        diversity in returned results.

        Args:
            results: List of search results to deduplicate.

        Returns:
            Deduplicated results preserving highest-scored version of duplicates.
        """
        if not results:
            return []

        # Sort by score descending to keep highest-scored duplicates
        sorted_results = sorted(results, key=lambda r: r.score, reverse=True)

        seen_ids: set[str | int] = set()
        seen_content_hashes: set[str] = set()
        deduplicated: list[SearchResultItem] = []

        for result in sorted_results:
            # Skip if we've seen this ID
            if result.id in seen_ids:
                continue

            # Generate a simple hash of content for deduplication
            content = result.payload.get("content", "")
            if isinstance(content, str):
                # Simple hash: first 100 chars + length
                content_hash = f"{content[:100].strip().lower()}_{len(content)}"

                # Skip if we've seen similar content
                if content_hash in seen_content_hashes:
                    continue

                seen_content_hashes.add(content_hash)

            seen_ids.add(result.id)
            deduplicated.append(result)

        logger.debug(f"Deduplicated {len(results)} results to {len(deduplicated)}")

        return deduplicated
