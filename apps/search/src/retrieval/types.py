"""Core types for the retrieval module.

This module defines the data structures used throughout the retrieval pipeline,
including search queries, results, filters, and configuration enums.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SearchStrategy(str, Enum):
    """Search strategy for retrieval.

    Attributes:
        DENSE: Dense vector search using semantic embeddings.
        SPARSE: Sparse vector search using keyword-based embeddings (SPLADE).
        HYBRID: Combines dense and sparse search with Reciprocal Rank Fusion.
    """

    DENSE = "dense"
    SPARSE = "sparse"
    HYBRID = "hybrid"


class RerankerTier(str, Enum):
    """Reranker tier for result refinement.

    Attributes:
        FAST: FlashRank for low-latency reranking (~10ms).
        ACCURATE: Cross-encoder with BGE for higher quality (~50ms).
        CODE: Specialized cross-encoder for code snippets.
        COLBERT: Late interaction MaxSim reranking (~30ms).
        LLM: Listwise reranking with LLMs (~500ms, rate-limited).
    """

    FAST = "fast"
    ACCURATE = "accurate"
    CODE = "code"
    COLBERT = "colbert"
    LLM = "llm"


class QueryComplexity(str, Enum):
    """Query complexity classification.

    Used to determine optimal search strategy and reranker tier.

    Attributes:
        SIMPLE: Simple keyword or short phrase queries.
        MODERATE: Multi-clause queries or moderate semantic complexity.
        COMPLEX: Complex multi-part queries requiring advanced reasoning.
    """

    SIMPLE = "simple"
    MODERATE = "moderate"
    COMPLEX = "complex"


class TimeRange(BaseModel):
    """Time range filter for search results.

    Attributes:
        start: Start timestamp (Unix epoch in milliseconds).
        end: End timestamp (Unix epoch in milliseconds).
    """

    start: int = Field(description="Start timestamp (Unix epoch in milliseconds)")
    end: int = Field(description="End timestamp (Unix epoch in milliseconds)")


class SearchFilters(BaseModel):
    """Search filter parameters for narrowing results.

    Attributes:
        org_id: Organization ID for tenant isolation (required).
        session_id: Filter by session ID.
        type: Filter by memory type (e.g., thought, code, doc).
        time_range: Filter by time range.
        vt_end_after: Filter by valid time end (memories where vt_end > timestamp).
    """

    org_id: str = Field(description="Organization ID for tenant isolation")
    session_id: str | None = Field(default=None, description="Filter by session ID")
    type: str | None = Field(default=None, description="Filter by memory type (thought, code, doc)")
    time_range: TimeRange | None = Field(default=None, description="Filter by time range")
    vt_end_after: int | None = Field(
        default=None,
        description="Filter by valid time end (memories where vt_end > timestamp in ms)",
    )


class SearchQuery(BaseModel):
    """Search query with retrieval parameters.

    Attributes:
        text: Query text.
        limit: Maximum number of results to return.
        threshold: Minimum similarity score threshold.
        filters: Optional search filters.
        strategy: Search strategy (dense, sparse, hybrid).
        rerank: Whether to apply reranking.
        rerank_tier: Reranker tier to use.
        rerank_depth: Number of results to rerank before filtering to limit.
    """

    text: str = Field(description="Search query text")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    threshold: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum similarity score threshold"
    )
    filters: SearchFilters | None = Field(default=None, description="Optional search filters")
    strategy: SearchStrategy | None = Field(
        default=None, description="Search strategy (auto-selected if None)"
    )
    rerank: bool = Field(default=True, description="Whether to apply reranking")
    rerank_tier: RerankerTier | None = Field(
        default=None, description="Reranker tier (auto-selected if None)"
    )
    rerank_depth: int = Field(default=30, ge=1, le=100, description="Number of results to rerank")


class SearchResultItem(BaseModel):
    """Individual search result item.

    Attributes:
        id: Result ID (string or integer from Qdrant).
        score: Base similarity score from vector search.
        rrf_score: Reciprocal Rank Fusion score (for hybrid search).
        reranker_score: Score from reranker model.
        rerank_tier: Reranker tier used for this result.
        payload: Result payload with content and metadata.
        degraded: Whether result is from degraded/fallback mode.
        degraded_reason: Reason for degradation if applicable.
    """

    id: str | int = Field(description="Result ID")
    score: float = Field(description="Similarity score from vector search")
    rrf_score: float | None = Field(
        default=None, description="Reciprocal Rank Fusion score (hybrid search)"
    )
    reranker_score: float | None = Field(default=None, description="Score from reranker")
    rerank_tier: RerankerTier | None = Field(
        default=None, description="Reranker tier used for this result"
    )
    payload: dict[str, Any] = Field(description="Result payload with content and metadata")
    degraded: bool = Field(
        default=False, description="Whether result is from degraded/fallback mode"
    )
    degraded_reason: str | None = Field(
        default=None, description="Reason for degradation if applicable"
    )
