"""
HTTP client for Engram search-py service.

Provides async HTTP client for:
- Vector search with hybrid strategies
- Multi-tier reranking
- Session and temporal filtering
- Health checks and monitoring

Connects to the search-py FastAPI service for production-grade retrieval.
"""

import logging
from typing import Any, Literal

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SearchFilters(BaseModel):
    """Search filter parameters."""

    session_id: str | None = None
    type: str | None = None
    time_range: dict[str, int] | None = None


class SearchRequest(BaseModel):
    """Search request payload."""

    text: str
    limit: int = 10
    threshold: float = 0.5
    filters: SearchFilters | None = None
    strategy: Literal["hybrid", "dense", "sparse"] | None = None
    rerank: bool = False
    rerank_tier: Literal["fast", "accurate", "code", "llm"] | None = None
    rerank_depth: int = 30


class SearchResult(BaseModel):
    """Individual search result."""

    id: str
    score: float
    rrf_score: float | None = None
    reranker_score: float | None = None
    rerank_tier: str | None = None
    payload: dict[str, Any]
    degraded: bool = False


class SearchResponse(BaseModel):
    """Search response containing list of results."""

    results: list[SearchResult]
    total: int
    took_ms: int


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    qdrant_connected: bool


class EngramSearchClient:
    """
    Async HTTP client for Engram search-py service.

    Examples:
        >>> client = EngramSearchClient(base_url="http://localhost:5002")
        >>> health = await client.health()
        >>> print(health.status)
        'healthy'

        >>> response = await client.search(
        ...     text="What did I say about Paris?",
        ...     limit=5,
        ...     strategy="hybrid",
        ...     rerank=True
        ... )
        >>> len(response.results)
        5
    """

    def __init__(
        self,
        base_url: str = "http://localhost:6176",
        timeout: float = 30.0,
        max_retries: int = 3,
    ) -> None:
        """
        Initialize Engram search client.

        Args:
            base_url: Base URL of the search-py service
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            transport=httpx.AsyncHTTPTransport(retries=max_retries),
        )
        logger.info(f"Initialized EngramSearchClient with base_url={self.base_url}")

    async def health(self) -> HealthResponse:
        """
        Check service health.

        Returns:
            Health status including Qdrant connectivity

        Raises:
            httpx.HTTPError: On HTTP errors
        """
        response = await self._client.get("/health")
        response.raise_for_status()
        return HealthResponse.model_validate(response.json())

    async def ready(self) -> dict[str, str]:
        """
        Check service readiness.

        Returns:
            Readiness status

        Raises:
            httpx.HTTPError: On HTTP errors
        """
        response = await self._client.get("/ready")
        response.raise_for_status()
        result: dict[str, str] = response.json()
        return result

    async def search(
        self,
        text: str,
        limit: int = 10,
        threshold: float = 0.5,
        filters: SearchFilters | None = None,
        strategy: Literal["hybrid", "dense", "sparse"] | None = None,
        rerank: bool = False,
        rerank_tier: Literal["fast", "accurate", "code", "llm"] | None = None,
        rerank_depth: int = 30,
    ) -> SearchResponse:
        """
        Perform vector search with optional reranking.

        Args:
            text: Search query text
            limit: Maximum number of results
            threshold: Minimum similarity score threshold
            filters: Optional search filters (session, type, time range)
            strategy: Search strategy (hybrid, dense, sparse)
            rerank: Whether to apply reranking
            rerank_tier: Reranking tier (fast, accurate, code, llm)
            rerank_depth: Number of results to rerank

        Returns:
            Search results with scores and metadata

        Raises:
            httpx.HTTPError: On HTTP errors
        """
        request = SearchRequest(
            text=text,
            limit=limit,
            threshold=threshold,
            filters=filters,
            strategy=strategy,
            rerank=rerank,
            rerank_tier=rerank_tier,
            rerank_depth=rerank_depth,
        )

        logger.debug(
            f"Search request: query='{text[:50]}...', limit={limit}, "
            f"strategy={strategy}, rerank={rerank}"
        )

        response = await self._client.post(
            "/search",
            json=request.model_dump(exclude_none=True),
        )
        response.raise_for_status()

        search_response = SearchResponse.model_validate(response.json())

        logger.debug(
            f"Search completed: results={search_response.total}, took_ms={search_response.took_ms}"
        )

        return search_response

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
        logger.debug("EngramSearchClient closed")

    async def __aenter__(self) -> "EngramSearchClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit."""
        await self.close()
