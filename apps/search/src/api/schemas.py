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
