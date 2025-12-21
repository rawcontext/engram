"""Session-Aware Retriever for hierarchical two-stage retrieval.

Implements a two-stage retrieval approach:
1. Stage 1: Retrieve top-S sessions based on session summaries
2. Stage 2: Retrieve top-T turns within each matched session
3. Optional reranking of combined results

This approach improves Multi-Session Reasoning (MR) by ensuring
related turns from the same session are retrieved together.

Based on research from:
- LiCoMemory: Hierarchical Retrieval
- SGMem: Sentence Graph Memory

See:
- https://arxiv.org/html/2511.01448 (LiCoMemory)
- https://arxiv.org/html/2509.21212 (SGMem)
"""

import asyncio
import logging
from typing import Any, cast

from pydantic import BaseModel, Field
from qdrant_client.http import models

from src.clients.qdrant import QdrantClientWrapper
from src.config import Settings
from src.embedders.factory import EmbedderFactory
from src.rerankers.router import RerankerRouter

logger = logging.getLogger(__name__)


class SessionRetrieverConfig(BaseModel):
    """Configuration for SessionAwareRetriever.

    Attributes:
            top_sessions: Number of sessions to retrieve in stage 1 (default: 5).
            turns_per_session: Number of turns per session in stage 2 (default: 3).
            final_top_k: Final top-K after reranking (default: 10).
            session_collection: Collection name for session summaries (default: "sessions").
            turn_collection: Collection name for turns (default: "engram_memory").
            session_vector_name: Vector field name for session embeddings (default: "text_dense").
            turn_vector_name: Vector field name for turn embeddings (default: "text_dense").
            session_score_threshold: Minimum score threshold for sessions (default: 0.3).
            parallel_turn_retrieval: Enable parallel turn retrieval (default: True).
    """

    top_sessions: int = Field(default=5, description="Number of sessions to retrieve in stage 1")
    turns_per_session: int = Field(default=3, description="Number of turns per session in stage 2")
    final_top_k: int = Field(default=10, description="Final top-K after reranking")
    session_collection: str = Field(
        default="sessions", description="Collection name for session summaries"
    )
    turn_collection: str = Field(default="engram_memory", description="Collection name for turns")
    session_vector_name: str = Field(
        default="text_dense", description="Vector field name for session embeddings"
    )
    turn_vector_name: str = Field(
        default="text_dense", description="Vector field name for turn embeddings"
    )
    session_score_threshold: float = Field(
        default=0.3, description="Minimum score threshold for sessions"
    )
    parallel_turn_retrieval: bool = Field(
        default=True, description="Enable parallel turn retrieval"
    )


class SessionResult(BaseModel):
    """Result from stage 1 session retrieval.

    Attributes:
            session_id: Session ID.
            summary: Session summary text.
            score: Similarity score.
            topics: Topics associated with session.
            entities: Entities mentioned in session.
    """

    session_id: str = Field(description="Session ID")
    summary: str = Field(description="Session summary text")
    score: float = Field(description="Similarity score")
    topics: list[str] | None = Field(default=None, description="Topics associated with session")
    entities: list[str] | None = Field(default=None, description="Entities mentioned in session")


class SessionAwareSearchResult(BaseModel):
    """Extended search result with session context.

    Attributes:
            id: Result ID (string or integer from Qdrant).
            score: Similarity score from vector search.
            payload: Result payload with content and metadata.
            session_id: Session ID this result belongs to.
            session_summary: Session summary for context.
            session_score: Session-level score from stage 1.
            rrf_score: Reciprocal Rank Fusion score (if applicable).
            reranker_score: Score from reranker model (if applicable).
    """

    id: str | int = Field(description="Result ID")
    score: float = Field(description="Similarity score from vector search")
    payload: dict[str, Any] = Field(description="Result payload with content and metadata")
    session_id: str = Field(description="Session ID this result belongs to")
    session_summary: str | None = Field(default=None, description="Session summary for context")
    session_score: float | None = Field(
        default=None, description="Session-level score from stage 1"
    )
    rrf_score: float | None = Field(
        default=None, description="Reciprocal Rank Fusion score (if applicable)"
    )
    reranker_score: float | None = Field(
        default=None, description="Score from reranker model (if applicable)"
    )


class SessionAwareRetriever:
    """SessionAwareRetriever implements two-stage hierarchical retrieval.

    Stage 1: Session Retrieval
    - Query against session summary embeddings
    - Returns top-S most relevant sessions

    Stage 2: Turn Retrieval
    - For each session from stage 1, query turns filtered by session_id
    - Returns top-T turns per session

    Final: Reranking
    - Combines all turns (S × T)
    - Optionally reranks to final top-K

    Example:
            >>> retriever = SessionAwareRetriever(
            ...     qdrant_client=qdrant_wrapper,
            ...     embedder_factory=factory,
            ...     settings=settings,
            ...     config=SessionRetrieverConfig(
            ...         top_sessions=5,
            ...         turns_per_session=3,
            ...         final_top_k=10,
            ...     ),
            ... )
            >>> results = await retriever.retrieve("What did we discuss about Docker?")
            >>> # Returns up to 10 turns from the 5 most relevant sessions
    """

    def __init__(
        self,
        qdrant_client: QdrantClientWrapper,
        embedder_factory: EmbedderFactory,
        settings: Settings,
        reranker_router: RerankerRouter | None = None,
        config: SessionRetrieverConfig | None = None,
    ) -> None:
        """Initialize SessionAwareRetriever.

        Args:
                qdrant_client: Qdrant client wrapper for vector search.
                embedder_factory: Factory for creating embedder instances.
                settings: Application settings.
                reranker_router: Optional reranker router for result refinement.
                config: Optional session retriever configuration.
        """
        self.qdrant_client = qdrant_client
        self.embedder_factory = embedder_factory
        self.settings = settings
        self.reranker_router = reranker_router
        self.config = config or SessionRetrieverConfig()
        logger.info(
            f"SessionAwareRetriever initialized with config: "
            f"top_sessions={self.config.top_sessions}, "
            f"turns_per_session={self.config.turns_per_session}, "
            f"final_top_k={self.config.final_top_k}"
        )

    async def retrieve(self, query: str) -> list[SessionAwareSearchResult]:
        """Perform two-stage session-aware retrieval.

        Args:
                query: The search query.

        Returns:
                Array of search results with session context.
        """
        import time

        start_time = time.time()

        # Get text embedder for query embedding
        text_embedder = self.embedder_factory.get_text_embedder()

        # Generate query embedding
        query_embedding = await text_embedder.embed(query, is_query=True)

        # Stage 1: Retrieve relevant sessions
        sessions = await self._retrieve_sessions(query_embedding)

        if not sessions:
            latency_ms = (time.time() - start_time) * 1000
            logger.info(
                "No sessions found in stage 1",
                extra={
                    "query": query[:100],
                    "latency_ms": latency_ms,
                },
            )
            return []

        logger.debug(
            "Stage 1 complete - sessions retrieved",
            extra={
                "session_count": len(sessions),
                "top_session_score": sessions[0].score,
            },
        )

        # Stage 2: Retrieve turns within each session
        all_turns = await self._retrieve_turns_from_sessions(query_embedding, sessions)

        if not all_turns:
            latency_ms = (time.time() - start_time) * 1000
            logger.info(
                "No turns found in stage 2",
                extra={
                    "session_count": len(sessions),
                    "latency_ms": latency_ms,
                },
            )
            return []

        logger.debug(
            "Stage 2 complete - turns retrieved",
            extra={
                "turn_count": len(all_turns),
                "sessions_with_turns": len({t.session_id for t in all_turns}),
            },
        )

        # Stage 3: Rerank if enabled and needed
        final_results = all_turns
        if self.reranker_router and len(all_turns) > self.config.final_top_k:
            final_results = await self._rerank_results(query, all_turns)
        else:
            # Sort by score and limit
            final_results = sorted(all_turns, key=lambda x: x.score, reverse=True)[
                : self.config.final_top_k
            ]

        latency_ms = (time.time() - start_time) * 1000
        logger.info(
            "Session-aware retrieval complete",
            extra={
                "query": query[:50],
                "sessions_found": len(sessions),
                "turns_retrieved": len(all_turns),
                "final_results": len(final_results),
                "latency_ms": latency_ms,
            },
        )

        return final_results

    async def _retrieve_sessions(self, query_embedding: list[float]) -> list[SessionResult]:
        """Stage 1: Retrieve relevant sessions based on summary embeddings.

        Args:
                query_embedding: Query embedding vector.

        Returns:
                Array of matched sessions.
        """
        try:
            client = self.qdrant_client.client
            results = await client.search(
                collection_name=self.config.session_collection,
                query_vector=models.NamedVector(
                    name=self.config.session_vector_name,
                    vector=query_embedding,
                ),
                limit=self.config.top_sessions,
                with_payload=True,
                score_threshold=self.config.session_score_threshold,
            )

            return [
                SessionResult(
                    session_id=cast(str, (r.payload or {}).get("session_id", "")),
                    summary=cast(str, (r.payload or {}).get("summary", "")),
                    score=r.score or 0.0,
                    topics=cast(list[str] | None, (r.payload or {}).get("topics")),
                    entities=cast(list[str] | None, (r.payload or {}).get("entities")),
                )
                for r in results
            ]
        except Exception as e:
            logger.error(
                f"Session retrieval failed: {e}",
                exc_info=True,
            )
            return []

    async def _retrieve_turns_from_sessions(
        self, query_embedding: list[float], sessions: list[SessionResult]
    ) -> list[SessionAwareSearchResult]:
        """Stage 2: Retrieve turns within matched sessions.

        Args:
                query_embedding: Query embedding vector.
                sessions: Sessions from stage 1.

        Returns:
                Array of turns with session context.
        """
        if self.config.parallel_turn_retrieval:
            # Parallel retrieval for all sessions
            tasks = [
                self._retrieve_turns_in_session(query_embedding, session) for session in sessions
            ]
            results = await asyncio.gather(*tasks)
            return [turn for session_turns in results for turn in session_turns]

        # Sequential retrieval
        all_turns: list[SessionAwareSearchResult] = []
        for session in sessions:
            turns = await self._retrieve_turns_in_session(query_embedding, session)
            all_turns.extend(turns)
        return all_turns

    async def _retrieve_turns_in_session(
        self, query_embedding: list[float], session: SessionResult
    ) -> list[SessionAwareSearchResult]:
        """Retrieve turns within a single session.

        Args:
                query_embedding: Query embedding vector.
                session: Session to search within.

        Returns:
                Array of turns from this session.
        """
        try:
            client = self.qdrant_client.client
            results = await client.search(
                collection_name=self.config.turn_collection,
                query_vector=models.NamedVector(
                    name=self.config.turn_vector_name,
                    vector=query_embedding,
                ),
                limit=self.config.turns_per_session,
                query_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="session_id",
                            match=models.MatchValue(value=session.session_id),
                        )
                    ]
                ),
                with_payload=True,
            )

            return [
                SessionAwareSearchResult(
                    id=r.id,
                    score=r.score or 0.0,
                    payload=cast(dict[str, Any], r.payload or {}),
                    session_id=session.session_id,
                    session_summary=session.summary,
                    session_score=session.score,
                )
                for r in results
            ]
        except Exception as e:
            logger.warning(
                f"Turn retrieval failed for session {session.session_id}: {e}",
                exc_info=True,
            )
            return []

    async def _rerank_results(
        self, query: str, turns: list[SessionAwareSearchResult]
    ) -> list[SessionAwareSearchResult]:
        """Rerank combined results from all sessions.

        Args:
                query: Original query.
                turns: All turns from stage 2.

        Returns:
                Reranked and limited results.
        """
        if not self.reranker_router:
            return sorted(turns, key=lambda x: x.score, reverse=True)[: self.config.final_top_k]

        try:
            # Extract content for reranking
            documents = [turn.payload.get("content", "") for turn in turns]

            # Rerank (using "fast" tier by default for session retrieval)
            reranked, tier_used, degraded = await self.reranker_router.rerank(
                query=query,
                documents=documents,
                tier="fast",
                top_k=self.config.final_top_k,
            )

            # Map back to original results
            return [
                SessionAwareSearchResult(
                    id=turns[r.original_index].id,
                    score=r.score,
                    payload=turns[r.original_index].payload,
                    session_id=turns[r.original_index].session_id,
                    session_summary=turns[r.original_index].session_summary,
                    session_score=turns[r.original_index].session_score,
                    rrf_score=turns[r.original_index].score,  # Original score becomes rrf_score
                    reranker_score=r.score,
                )
                for r in reranked
            ]
        except Exception as e:
            logger.error(
                f"Reranking failed - returning sorted results: {e}",
                exc_info=True,
            )
            # Fall back to score-sorted results
            return sorted(turns, key=lambda x: x.score, reverse=True)[: self.config.final_top_k]

    def get_config(self) -> SessionRetrieverConfig:
        """Get current configuration.

        Returns:
                Current session retriever configuration.
        """
        return self.config

    def update_config(self, **kwargs: Any) -> None:
        """Update configuration at runtime.

        Args:
                **kwargs: Configuration fields to update.
        """
        # Create new config with updated values
        config_dict = self.config.model_dump()
        config_dict.update(kwargs)
        self.config = SessionRetrieverConfig(**config_dict)
        logger.info(f"Configuration updated: {kwargs}")

    async def preload(self) -> None:
        """Preload the text embedder for faster first retrieval."""
        text_embedder = self.embedder_factory.get_text_embedder()
        await text_embedder.load()
        logger.info("Text embedder preloaded for session-aware retrieval")
