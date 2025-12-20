"""ColBERT reranker using RAGatouille for late interaction MaxSim.

ColBERT uses late interaction between query and document token embeddings,
computing MaxSim scores for more nuanced relevance. Provides a good balance
between speed and accuracy.

Expected latency: ~30ms per query.
"""

import asyncio
import logging
from typing import Any

from ragatouille import RAGPretrainedModel

from search.rerankers.base import BaseReranker, RankedResult

logger = logging.getLogger(__name__)


class ColBERTReranker(BaseReranker):
    """ColBERT-based reranker using RAGatouille.

    Uses late interaction (MaxSim) between query and document tokens
    for efficient yet accurate reranking.

    Attributes:
        model_name: ColBERT model name (default: colbert-ir/colbertv2.0).
        model: RAGPretrainedModel instance.
    """

    def __init__(
        self,
        model_name: str = "colbert-ir/colbertv2.0",
        device: str = "cpu",
        n_gpu: int = 0,
    ) -> None:
        """Initialize ColBERT reranker.

        Args:
            model_name: ColBERT model name from HuggingFace.
            device: Device for inference (cpu, cuda).
            n_gpu: Number of GPUs to use (0 for CPU).
        """
        self.model_name = model_name
        self.device = device
        self.n_gpu = n_gpu

        logger.info(f"Initializing ColBERT reranker with model: {model_name}")

        # Initialize RAGatouille model
        self.model = RAGPretrainedModel.from_pretrained(
            model_name,
            n_gpu=n_gpu,
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

        # Use RAGatouille's rerank method
        # Returns list of dicts with 'content', 'score', 'rank'
        reranked = self.model.rerank(
            query=query,
            documents=documents,
            k=top_k if top_k is not None else len(documents),
        )

        # Convert to RankedResult
        results = [
            RankedResult(
                text=result["content"],
                score=float(result["score"]),
                original_index=None,  # RAGatouille doesn't preserve original index
            )
            for result in reranked
        ]

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

        RAGatouille doesn't have native batch support, so we process sequentially.

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
