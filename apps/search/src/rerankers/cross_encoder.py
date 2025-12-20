"""Cross-encoder reranker using sentence-transformers.

Cross-encoders jointly encode query and document for more accurate
relevance scoring compared to bi-encoders. Typically used for the
'accurate' and 'code' reranking tiers.

Expected latency: ~50ms per batch.
"""

import asyncio
import logging

from sentence_transformers import CrossEncoder

from src.rerankers.base import BaseReranker, RankedResult

logger = logging.getLogger(__name__)


class CrossEncoderReranker(BaseReranker):
    """Cross-encoder based reranker using sentence-transformers.

    Uses joint encoding of query+document pairs for accurate scoring.
    Supports batch processing and GPU acceleration.

    Attributes:
        model_name: HuggingFace model name (e.g., BAAI/bge-reranker-v2-m3).
        model: Loaded CrossEncoder model.
        device: Device for inference (cuda, cpu, mps).
        batch_size: Maximum batch size for inference.
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-reranker-v2-m3",
        device: str | None = None,
        batch_size: int = 16,
        max_length: int = 512,
    ) -> None:
        """Initialize cross-encoder reranker.

        Args:
            model_name: HuggingFace model name.
            device: Device for inference (cuda, cpu, mps). Auto-detected if None.
            batch_size: Batch size for inference.
            max_length: Maximum sequence length for input.
        """
        self.model_name = model_name
        self.batch_size = batch_size
        self.max_length = max_length

        logger.info(f"Initializing CrossEncoder reranker with model: {model_name}")

        # Load model
        self.model = CrossEncoder(
            model_name,
            device=device,
            max_length=max_length,
        )

        self.device = self.model.device

        logger.info(f"CrossEncoder loaded on device: {self.device}")

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents using cross-encoder.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        if not documents:
            return []

        # Prepare query-document pairs
        pairs = [[query, doc] for doc in documents]

        # Score all pairs in batches
        scores = self.model.predict(
            pairs,
            batch_size=self.batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
        )

        # Create results with original indices
        results = [
            RankedResult(text=doc, score=float(score), original_index=idx)
            for idx, (doc, score) in enumerate(zip(documents, scores, strict=True))
        ]

        # Sort by score descending
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

        Runs cross-encoder inference in executor to avoid blocking.

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
        """Rerank multiple query-document pairs in batch.

        Processes all pairs together for maximum efficiency.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        if not queries or not documents_batch:
            return []

        # Flatten all query-document pairs with metadata
        all_pairs = []
        pair_metadata = []  # (query_idx, doc_idx)

        for query_idx, (query, documents) in enumerate(zip(queries, documents_batch, strict=True)):
            for doc_idx, doc in enumerate(documents):
                all_pairs.append([query, doc])
                pair_metadata.append((query_idx, doc_idx))

        # Score all pairs in batches
        all_scores = self.model.predict(
            all_pairs,
            batch_size=self.batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
        )

        # Group results by query
        results_by_query: list[list[RankedResult]] = [[] for _ in queries]

        for (query_idx, doc_idx), score in zip(pair_metadata, all_scores, strict=True):
            doc_text = documents_batch[query_idx][doc_idx]
            results_by_query[query_idx].append(
                RankedResult(text=doc_text, score=float(score), original_index=doc_idx)
            )

        # Sort each query's results by score descending
        for results in results_by_query:
            results.sort(key=lambda x: x.score, reverse=True)

            # Apply top_k if specified
            if top_k is not None:
                results[:] = results[:top_k]

        return results_by_query

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
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.rerank_batch, queries, documents_batch, top_k)
