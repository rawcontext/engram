"""ColBERT reranker using PyLate for late interaction MaxSim.

ColBERT uses late interaction between query and document token embeddings,
computing MaxSim scores for more nuanced relevance. Provides a good balance
between speed and accuracy.

Expected latency: ~30ms per query.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from src.rerankers.base import BaseReranker, RankedResult

logger = logging.getLogger(__name__)


class ColBERTReranker(BaseReranker):
    """ColBERT-based reranker using PyLate.

    Uses late interaction (MaxSim) between query and document tokens
    for efficient yet accurate reranking.

    Attributes:
        model_name: ColBERT model name (default: answerdotai/answerai-colbert-small-v1).
        model: PyLate ColBERT model instance.
    """

    def __init__(
        self,
        model_name: str = "answerdotai/answerai-colbert-small-v1",
        device: str = "cpu",
        **kwargs: Any,
    ) -> None:
        """Initialize ColBERT reranker.

        Args:
            model_name: ColBERT model name from HuggingFace.
            device: Device for inference (cpu, cuda).
            **kwargs: Additional PyLate arguments.
        """
        self.model_name = model_name
        self.device = device
        self._kwargs = kwargs
        self.model: Any = None

        logger.info(f"Initializing ColBERT reranker with model: {model_name}")

        # Lazy import to avoid issues at module load
        from pylate import models, rank  # type: ignore

        self._rank_module = rank

        # Initialize PyLate ColBERT model
        self.model = models.ColBERT(
            model_name_or_path=model_name,
            device=device,
            **kwargs,
        )

        logger.info("ColBERT reranker initialized successfully")

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents using ColBERT MaxSim.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        if not documents:
            return []

        # Use PyLate's rerank function
        # It computes MaxSim between query and document embeddings
        reranked = self._rank_module.rerank(
            documents=documents,
            queries=[query],
            model=self.model,
            batch_size=min(len(documents), 32),
        )

        # reranked is a list (one per query) of list of tuples (doc_index, score)
        query_results = reranked[0] if reranked else []

        # Convert to RankedResult
        results = []
        for doc_idx, score in query_results:
            if doc_idx < len(documents):
                results.append(
                    RankedResult(
                        text=documents[doc_idx],
                        score=float(score),
                        original_index=doc_idx,
                    )
                )

        # Sort by score descending (should already be sorted, but ensure it)
        results.sort(key=lambda x: x.score, reverse=True)

        # Apply top_k if specified
        if top_k is not None:
            results = results[:top_k]

        return results

    async def rerank_async(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Async version of rerank.

        Runs ColBERT inference in executor to avoid blocking.

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

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        # Process each query-documents pair
        # PyLate rerank expects aligned queries and documents for batch processing
        # For now, process sequentially (could be optimized)
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

        Processes queries concurrently in executor.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        tasks = [
            self.rerank_async(query, documents, top_k)
            for query, documents in zip(queries, documents_batch, strict=True)
        ]
        return await asyncio.gather(*tasks)
