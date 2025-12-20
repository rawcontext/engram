"""Base abstract class for rerankers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RankedResult:
    """A single reranked result with text and score.

    Attributes:
        text: The document text that was reranked.
        score: The reranking score (higher is better).
        original_index: Optional index in the original result list.
    """

    text: str
    score: float
    original_index: int | None = None


class BaseReranker(ABC):
    """Abstract base class for all reranker implementations.

    Rerankers take a query and a list of candidate documents,
    and return the documents reordered by relevance with new scores.

    All rerankers must implement:
    - rerank(): Main reranking method
    - rerank_batch(): Batch reranking for efficiency
    """

    @abstractmethod
    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Rerank documents by relevance to query.

        Args:
            query: The search query.
            documents: List of candidate document texts.
            top_k: Optional number of top results to return. If None, returns all.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        pass

    @abstractmethod
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
            top_k: Optional number of top results to return. If None, returns all.

        Returns:
            List of RankedResult objects sorted by score (descending).
        """
        pass

    def rerank_batch(
        self,
        queries: list[str],
        documents_batch: list[list[str]],
        top_k: int | None = None,
    ) -> list[list[RankedResult]]:
        """Rerank multiple query-document pairs in batch.

        Default implementation calls rerank() sequentially.
        Subclasses can override for true batching.

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

        Default implementation calls rerank_async() sequentially.
        Subclasses can override for true batching.

        Args:
            queries: List of search queries.
            documents_batch: List of document lists (one per query).
            top_k: Optional number of top results to return per query.

        Returns:
            List of ranked results lists (one per query).
        """
        results = []
        for query, documents in zip(queries, documents_batch, strict=True):
            result = await self.rerank_async(query, documents, top_k)
            results.append(result)
        return results
