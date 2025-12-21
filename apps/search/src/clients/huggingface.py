"""Async HuggingFace Inference API client for embeddings and reranking."""

import asyncio
import logging
from typing import Any

import httpx
import numpy as np
from huggingface_hub import AsyncInferenceClient

from src.rerankers.base import BaseReranker, RankedResult

logger = logging.getLogger(__name__)


class HuggingFaceEmbedder:
    """Async HuggingFace Inference API client for embedding generation.

    Supports text and code embedding models via the HuggingFace Inference API.
    Uses AsyncInferenceClient for async operations with automatic retries and rate limiting.
    """

    # Model configurations with dimensions and query prefixes
    MODEL_CONFIGS = {
        "BAAI/bge-small-en-v1.5": {
            "dimensions": 384,
            "query_prefix": "Represent this sentence for searching relevant passages: ",
        },
        "nomic-ai/nomic-embed-text-v1.5": {
            "dimensions": 768,
            "query_prefix": "search_query: ",
        },
    }

    def __init__(
        self,
        model_id: str,
        api_token: str,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ) -> None:
        """Initialize the HuggingFace embedder client.

        Args:
            model_id: HuggingFace model identifier (e.g., "BAAI/bge-small-en-v1.5").
            api_token: HuggingFace API token for authentication.
            timeout: Request timeout in seconds.
            max_retries: Maximum number of retry attempts on failure.
            retry_delay: Base delay between retries in seconds (exponential backoff).
        """
        self.model_id = model_id
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        # Get model configuration
        self.config = self.MODEL_CONFIGS.get(model_id, {"dimensions": 768, "query_prefix": ""})

        # Initialize async client
        self._client = AsyncInferenceClient(token=api_token, timeout=timeout)

        logger.info(
            f"Initialized HuggingFaceEmbedder with model '{model_id}' "
            f"({self.config['dimensions']} dimensions)"
        )

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions for the model.

        Returns:
            Number of dimensions in the embedding vector.
        """
        return self.config["dimensions"]

    async def embed(self, text: str, is_query: bool = True) -> list[float]:
        """Generate embedding for a single text.

        Args:
            text: Text to embed.
            is_query: Whether this is a query (vs document). Queries may use special prefixes.

        Returns:
            Embedding vector as list of floats.

        Raises:
            httpx.HTTPError: If the API request fails after all retries.
        """
        # Apply query prefix if needed
        if is_query and self.config["query_prefix"]:
            text = self.config["query_prefix"] + text

        # Retry loop with exponential backoff
        for attempt in range(self.max_retries):
            try:
                # Call HuggingFace Inference API
                embedding = await self._client.feature_extraction(text=text, model=self.model_id)

                # Handle different return formats
                if isinstance(embedding, np.ndarray):
                    # HuggingFace API returns numpy arrays - convert to list
                    if embedding.ndim == 1:
                        return embedding.tolist()
                    elif embedding.ndim == 2:
                        # Batch result with single item
                        return embedding[0].tolist()
                    else:
                        raise ValueError(f"Unexpected numpy array shape: {embedding.shape}")

                if isinstance(embedding, list):
                    # Check if it's a nested list (batch result with single item)
                    if embedding and isinstance(embedding[0], list):
                        return embedding[0]
                    return embedding

                # Unexpected format
                logger.error(f"Unexpected embedding format: {type(embedding)}")
                raise ValueError(f"Unexpected embedding format from API: {type(embedding)}")

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:  # Rate limit
                    delay = self.retry_delay * (2**attempt)
                    logger.warning(
                        f"Rate limited by HuggingFace API "
                        f"(attempt {attempt + 1}/{self.max_retries}). Retrying in {delay:.1f}s..."
                    )
                    await asyncio.sleep(delay)
                    continue

                # Non-retryable error
                logger.error(f"HTTP error from HuggingFace API: {e}")
                raise

            except httpx.TimeoutException:
                delay = self.retry_delay * (2**attempt)
                logger.warning(
                    f"Request timeout (attempt {attempt + 1}/{self.max_retries}). "
                    f"Retrying in {delay:.1f}s..."
                )
                await asyncio.sleep(delay)
                continue

            except Exception as e:
                logger.error(f"Unexpected error during embedding: {e}")
                raise

        # All retries exhausted
        raise httpx.HTTPError(f"Failed to generate embedding after {self.max_retries} attempts")

    async def embed_batch(self, texts: list[str], is_query: bool = True) -> list[list[float]]:
        """Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed.
            is_query: Whether these are queries (vs documents).

        Returns:
            List of embedding vectors.

        Raises:
            httpx.HTTPError: If any API request fails after all retries.
        """
        # Process each text individually (API doesn't support true batching for feature_extraction)
        # Use asyncio.gather for concurrent requests
        tasks = [self.embed(text, is_query=is_query) for text in texts]
        return await asyncio.gather(*tasks)

    async def close(self) -> None:
        """Close the underlying HTTP client.

        Should be called when the embedder is no longer needed to free resources.
        """
        if self._client is not None:
            # AsyncInferenceClient uses httpx internally, close it
            # Note: As of huggingface_hub 0.20+, AsyncInferenceClient has proper cleanup
            try:
                # Try to access the internal client if available
                if hasattr(self._client, "_client") and self._client._client is not None:
                    await self._client._client.aclose()
            except Exception as e:
                logger.debug(f"Error closing AsyncInferenceClient: {e}")

    async def __aenter__(self) -> "HuggingFaceEmbedder":
        """Async context manager entry.

        Returns:
            Self for context manager protocol.
        """
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit.

        Args:
            exc_type: Exception type if an exception was raised.
            exc_val: Exception value if an exception was raised.
            exc_tb: Exception traceback if an exception was raised.
        """
        await self.close()


class HuggingFaceReranker(BaseReranker):
    """HuggingFace API-based reranker.

    Uses the HuggingFace Inference API to rerank documents by relevance.
    Supports models like BAAI/bge-reranker-v2-m3 and jinaai/jina-reranker-v2-base-multilingual.

    The API returns results sorted by relevance score in descending order.

    Attributes:
        model_id: HuggingFace model ID (e.g., BAAI/bge-reranker-v2-m3).
        api_token: HuggingFace API token for authentication.
        api_url: Full API endpoint URL.
        max_retries: Maximum number of retry attempts for rate limiting.
        retry_delay: Initial delay between retries in seconds.
        timeout: Request timeout in seconds.
    """

    def __init__(
        self,
        model_id: str,
        api_token: str,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        timeout: float = 30.0,
    ) -> None:
        """Initialize HuggingFace reranker.

        Args:
            model_id: HuggingFace model ID.
            api_token: HuggingFace API token.
            max_retries: Maximum retry attempts for rate limiting.
            retry_delay: Initial delay between retries (exponential backoff).
            timeout: Request timeout in seconds.
        """
        self.model_id = model_id
        self.api_token = api_token
        self.api_url = f"https://api-inference.huggingface.co/models/{model_id}"
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.timeout = timeout

        logger.info(f"Initialized HuggingFace reranker with model: {model_id}")

    def _create_client(self) -> httpx.Client:
        """Create synchronous HTTP client with auth headers.

        Returns:
            Configured httpx.Client instance.
        """
        return httpx.Client(
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
        )

    def _create_async_client(self) -> httpx.AsyncClient:
        """Create async HTTP client with auth headers.

        Returns:
            Configured httpx.AsyncClient instance.
        """
        return httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            },
            timeout=self.timeout,
        )

    def _parse_response(
        self, response_data: list[dict[str, Any]], documents: list[str]
    ) -> list[RankedResult]:
        """Parse HuggingFace API response into RankedResult objects.

        Args:
            response_data: API response containing index and score for each document.
            documents: Original document texts.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        results = [
            RankedResult(
                text=documents[item["index"]],
                score=float(item["score"]),
                original_index=item["index"],
            )
            for item in response_data
        ]

        # Sort by score descending (should already be sorted by API, but ensure it)
        results.sort(key=lambda x: x.score, reverse=True)

        return results

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents using HuggingFace Inference API.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).

        Raises:
            httpx.HTTPStatusError: If API request fails after retries.
        """
        if not documents:
            return []

        payload = {
            "inputs": {"query": query, "texts": documents},
            "options": {"wait_for_model": True},
        }

        with self._create_client() as client:
            for attempt in range(self.max_retries):
                try:
                    response = client.post(self.api_url, json=payload)
                    response.raise_for_status()

                    # Parse response
                    response_data = response.json()
                    results = self._parse_response(response_data, documents)

                    # Apply top_k if specified
                    if top_k is not None:
                        results = results[:top_k]

                    return results

                except httpx.HTTPStatusError as e:
                    # Retry on rate limiting (503) or server errors (5xx)
                    if (
                        e.response.status_code in (503, 500, 502, 504)
                        and attempt < self.max_retries - 1
                    ):
                        delay = self.retry_delay * (2**attempt)
                        logger.warning(
                            f"HuggingFace API error {e.response.status_code}, "
                            f"retrying in {delay}s (attempt {attempt + 1}/{self.max_retries})"
                        )
                        asyncio.sleep(delay)
                        continue
                    # Re-raise for non-retryable errors or final attempt
                    logger.error(f"HuggingFace API request failed: {e}")
                    raise

        # Should never reach here, but for type safety
        return []

    async def rerank_async(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Async version of rerank.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).

        Raises:
            httpx.HTTPStatusError: If API request fails after retries.
        """
        if not documents:
            return []

        payload = {
            "inputs": {"query": query, "texts": documents},
            "options": {"wait_for_model": True},
        }

        async with self._create_async_client() as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(self.api_url, json=payload)
                    response.raise_for_status()

                    # Parse response
                    response_data = response.json()
                    results = self._parse_response(response_data, documents)

                    # Apply top_k if specified
                    if top_k is not None:
                        results = results[:top_k]

                    return results

                except httpx.HTTPStatusError as e:
                    # Retry on rate limiting (503) or server errors (5xx)
                    if (
                        e.response.status_code in (503, 500, 502, 504)
                        and attempt < self.max_retries - 1
                    ):
                        delay = self.retry_delay * (2**attempt)
                        logger.warning(
                            f"HuggingFace API error {e.response.status_code}, "
                            f"retrying in {delay}s (attempt {attempt + 1}/{self.max_retries})"
                        )
                        await asyncio.sleep(delay)
                        continue
                    # Re-raise for non-retryable errors or final attempt
                    logger.error(f"HuggingFace API request failed: {e}")
                    raise

        # Should never reach here, but for type safety
        return []
