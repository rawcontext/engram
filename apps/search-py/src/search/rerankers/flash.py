"""FlashRank reranker for fast, lightweight reranking.

FlashRank is an ultra-lite reranker (~4MB ONNX model) that runs on CPU
with ~10ms latency. No torch/transformers dependencies required.

Ideal for the 'fast' reranking tier.
"""

import asyncio
import logging
from typing import Any

from flashrank import Ranker, RerankRequest

from search.rerankers.base import BaseReranker, RankedResult

logger = logging.getLogger(__name__)


class FlashRankReranker(BaseReranker):
    """FlashRank-based reranker for fast tier.

    Uses ONNX runtime for CPU inference with minimal overhead.

    Attributes:
        model_name: FlashRank model name (default: ms-marco-MiniLM-L-6-v2).
        ranker: FlashRank Ranker instance.
    """

    def __init__(
        self,
        model_name: str = "ms-marco-MiniLM-L-6-v2",
        cache_dir: str | None = None,
    ) -> None:
        """Initialize FlashRank reranker.

        Args:
            model_name: FlashRank model name.
            cache_dir: Optional cache directory for model files.
        """
        self.model_name = model_name
        self._cache_dir = cache_dir

        logger.info(f"Initializing FlashRank reranker with model: {model_name}")

        # Initialize ranker
        self.ranker = Ranker(model_name=model_name, cache_dir=cache_dir)

        logger.info("FlashRank reranker initialized successfully")

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents using FlashRank.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        if not documents:
            return []

        # Prepare passages for FlashRank
        passages = [{"text": doc} for doc in documents]

        # Create rerank request
        rerank_request = RerankRequest(query=query, passages=passages)

        # Perform reranking
        results = self.ranker.rerank(rerank_request)

        # Convert to RankedResult
        ranked_results = [
            RankedResult(
                text=result["text"],
                score=float(result["score"]),
                original_index=result.get("index"),
            )
            for result in results
        ]

        # Apply top_k if specified
        if top_k is not None:
            ranked_results = ranked_results[:top_k]

        return ranked_results

    async def rerank_async(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Async version of rerank.

        FlashRank is CPU-bound, so we run in executor to avoid blocking.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.rerank, query, documents, top_k)

    def rerank_batch(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        top_k: int | None = None,
    ) -> list[list[RankedResult]]:
        """Rerank multiple query-document pairs.

        FlashRank doesn't have native batch support, so we process sequentially.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        return [
            self.rerank(query, documents, top_k)
            for query, documents in zip(queries, documents_batch, strict=True)
        ]

    async def rerank_batch_async(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        top_k: int | None = None,
    ) -> list[list[RankedResult]]:
        """Async version of rerank_batch.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        # Process all queries concurrently
        tasks = [
            self.rerank_async(query, documents, top_k)
            for query, documents in zip(queries, documents_batch, strict=True)
        ]
        return await asyncio.gather(*tasks)
