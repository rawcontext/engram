"""Pydantic schemas for API request and response models."""

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(description="Service status: 'healthy' or 'degraded'")
    version: str = Field(description="Service version")
    qdrant_connected: bool = Field(description="Whether Qdrant is connected and responsive")


class SearchFilters(BaseModel):
    """Search filter parameters."""

    session_id: str | None = Field(default=None, description="Filter by session ID")
    type: str | None = Field(default=None, description="Filter by memory type (thought/code/doc)")
    time_range: dict[str, int] | None = Field(
        default=None, description="Time range filter with 'start' and 'end' timestamps"
    )


class SearchRequest(BaseModel):
    """Search request payload."""

    text: str = Field(description="Search query text")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    threshold: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum similarity score threshold"
    )
    filters: SearchFilters | None = Field(default=None, description="Optional search filters")
    strategy: str | None = Field(
        default=None, description="Search strategy: 'hybrid', 'dense', or 'sparse'"
    )
    rerank: bool = Field(default=False, description="Whether to apply reranking")
    rerank_tier: str | None = Field(
        default=None, description="Reranking tier: 'fast', 'accurate', 'code', or 'llm'"
    )
    rerank_depth: int = Field(default=30, ge=1, le=100, description="Number of results to rerank")
    collection: str | None = Field(
        default=None,
        description="Collection name (default: 'engram_turns')",
    )


class SearchResult(BaseModel):
    """Individual search result."""

    id: str = Field(description="Result ID")
    score: float = Field(description="Similarity score")
    rrf_score: float | None = Field(default=None, description="Reciprocal Rank Fusion score")
    reranker_score: float | None = Field(default=None, description="Reranker score")
    rerank_tier: str | None = Field(default=None, description="Reranking tier used")
    payload: dict[str, Any] = Field(description="Result payload with content and metadata")
    degraded: bool = Field(
        default=False, description="Whether result is from degraded/fallback mode"
    )


class SearchResponse(BaseModel):
    """Search response containing list of results."""

    results: list[SearchResult] = Field(description="Search results")
    total: int = Field(description="Total number of results")
    took_ms: int = Field(description="Time taken in milliseconds")


class EmbedRequest(BaseModel):
    """Embedding request payload."""

    text: str = Field(description="Text to embed")
    embedder_type: str = Field(
        default="text", description="Embedder type: 'text', 'code', 'sparse', or 'colbert'"
    )
    is_query: bool = Field(default=True, description="Whether this is a query (vs document)")


class EmbedResponse(BaseModel):
    """Embedding response."""

    embedding: list[float] = Field(description="Dense embedding vector")
    dimensions: int = Field(description="Number of dimensions in embedding")
    embedder_type: str = Field(description="Embedder type used")
    took_ms: int = Field(description="Time taken in milliseconds")


class MultiQueryRequest(BaseModel):
    """Multi-query search request payload."""

    text: str = Field(description="Search query text")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum number of results")
    threshold: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Minimum similarity score threshold"
    )
    filters: SearchFilters | None = Field(default=None, description="Optional search filters")
    strategy: str | None = Field(
        default=None, description="Search strategy: 'hybrid', 'dense', or 'sparse'"
    )
    rerank: bool = Field(default=False, description="Whether to apply reranking")
    rerank_tier: str | None = Field(
        default=None, description="Reranking tier: 'fast', 'accurate', 'code', or 'llm'"
    )
    rerank_depth: int = Field(default=30, ge=1, le=100, description="Number of results to rerank")
    num_variations: int = Field(default=3, ge=1, le=10, description="Number of query variations")
    strategies: list[str] = Field(
        default=["paraphrase", "keyword", "stepback"],
        description="Query expansion strategies",
    )
    include_original: bool = Field(default=True, description="Include original query")
    rrf_k: int = Field(default=60, ge=1, description="RRF fusion constant")


class SessionAwareRequest(BaseModel):
    """Session-aware search request payload."""

    query: str = Field(description="Search query text")
    top_sessions: int = Field(default=5, ge=1, le=20, description="Number of sessions to retrieve")
    turns_per_session: int = Field(
        default=3, ge=1, le=10, description="Number of turns per session"
    )
    final_top_k: int = Field(default=10, ge=1, le=100, description="Final top-K after reranking")


class SessionAwareResult(BaseModel):
    """Session-aware search result."""

    id: str = Field(description="Result ID")
    score: float = Field(description="Similarity score")
    payload: dict[str, Any] = Field(description="Result payload with content and metadata")
    session_id: str = Field(description="Session ID")
    session_summary: str | None = Field(default=None, description="Session summary")
    session_score: float | None = Field(default=None, description="Session-level score")
    rrf_score: float | None = Field(default=None, description="RRF score")
    reranker_score: float | None = Field(default=None, description="Reranker score")


class SessionAwareResponse(BaseModel):
    """Session-aware search response."""

    results: list[SessionAwareResult] = Field(description="Search results with session context")
    total: int = Field(description="Total number of results")
    took_ms: int = Field(description="Time taken in milliseconds")


class MemoryIndexRequest(BaseModel):
    """Memory indexing request payload."""

    id: str = Field(description="Memory node ID (ULID)")
    content: str = Field(description="Memory content to embed and index")
    type: str = Field(
        default="context",
        description="Memory type: decision, context, insight, preference, fact",
    )
    tags: list[str] = Field(default_factory=list, description="Tags for categorization")
    project: str | None = Field(default=None, description="Project name")
    source_session_id: str | None = Field(default=None, description="Source session ID")


class MemoryIndexResponse(BaseModel):
    """Memory indexing response."""

    id: str = Field(description="Indexed memory ID")
    indexed: bool = Field(description="Whether indexing succeeded")
    took_ms: int = Field(description="Time taken in milliseconds")


class ConflictCandidateResponse(BaseModel):
    """Conflict candidate response for memory deduplication."""

    id: str = Field(description="Memory node ID")
    content: str = Field(description="Memory content")
    type: str = Field(description="Memory type (decision/context/insight/preference/fact)")
    score: float = Field(description="Similarity score")
    vt_start: int = Field(description="Valid time start timestamp (milliseconds since epoch)")
