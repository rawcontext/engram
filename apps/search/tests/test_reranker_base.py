"""Comprehensive tests for base reranker module."""


import pytest

from src.rerankers.base import BaseReranker, RankedResult


class MockReranker(BaseReranker):
    """Mock implementation of BaseReranker for testing."""

    def __init__(self, fail_on_empty: bool = False) -> None:
        """Initialize mock reranker.

        Args:
            fail_on_empty: If True, raise error on empty documents.
        """
        self.fail_on_empty = fail_on_empty
        self.rerank_called = False
        self.rerank_async_called = False

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Mock rerank implementation."""
        self.rerank_called = True

        if self.fail_on_empty and not documents:
            raise ValueError("Empty documents")

        # Create results with decreasing scores
        results = [
            RankedResult(
                text=doc,
                score=1.0 - (i * 0.1),
                original_index=i,
            )
            for i, doc in enumerate(documents)
        ]

        # Sort by score descending
        results.sort(key=lambda x: x.score, reverse=True)

        if top_k is not None:
            results = results[:top_k]

        return results

    async def rerank_async(
        self,
        query: str,
        documents: list[str],
        top_k: int | None = None,
    ) -> list[RankedResult]:
        """Mock async rerank implementation."""
        self.rerank_async_called = True

        if self.fail_on_empty and not documents:
            raise ValueError("Empty documents")

        # Same logic as sync version
        results = [
            RankedResult(
                text=doc,
                score=1.0 - (i * 0.1),
                original_index=i,
            )
            for i, doc in enumerate(documents)
        ]

        results.sort(key=lambda x: x.score, reverse=True)

        if top_k is not None:
            results = results[:top_k]

        return results


class TestRankedResult:
    """Tests for RankedResult dataclass."""

    def test_initialization(self) -> None:
        """Test RankedResult initialization."""
        result = RankedResult(
            text="Sample document",
            score=0.85,
            original_index=0,
        )

        assert result.text == "Sample document"
        assert result.score == 0.85
        assert result.original_index == 0

    def test_initialization_without_index(self) -> None:
        """Test RankedResult initialization without original index."""
        result = RankedResult(
            text="Sample document",
            score=0.85,
        )

        assert result.text == "Sample document"
        assert result.score == 0.85
        assert result.original_index is None

    def test_equality(self) -> None:
        """Test RankedResult equality comparison."""
        result1 = RankedResult(text="doc", score=0.9, original_index=0)
        result2 = RankedResult(text="doc", score=0.9, original_index=0)

        assert result1 == result2

    def test_inequality(self) -> None:
        """Test RankedResult inequality comparison."""
        result1 = RankedResult(text="doc", score=0.9, original_index=0)
        result2 = RankedResult(text="doc", score=0.8, original_index=0)

        assert result1 != result2

    def test_repr(self) -> None:
        """Test RankedResult string representation."""
        result = RankedResult(text="Sample", score=0.75, original_index=5)
        repr_str = repr(result)

        assert "Sample" in repr_str
        assert "0.75" in repr_str
        assert "5" in repr_str


class TestBaseReranker:
    """Tests for BaseReranker abstract base class."""

    def test_cannot_instantiate_abstract_class(self) -> None:
        """Test that BaseReranker cannot be instantiated directly."""
        with pytest.raises(TypeError):
            BaseReranker()

    def test_mock_reranker_initialization(self) -> None:
        """Test that mock implementation can be instantiated."""
        reranker = MockReranker()
        assert reranker is not None

    def test_rerank_basic(self) -> None:
        """Test basic rerank functionality."""
        reranker = MockReranker()
        query = "test query"
        documents = ["doc1", "doc2", "doc3"]

        results = reranker.rerank(query, documents)

        assert len(results) == 3
        assert all(isinstance(r, RankedResult) for r in results)
        assert reranker.rerank_called

    def test_rerank_with_top_k(self) -> None:
        """Test rerank with top_k limit."""
        reranker = MockReranker()
        query = "test query"
        documents = ["doc1", "doc2", "doc3", "doc4", "doc5"]

        results = reranker.rerank(query, documents, top_k=3)

        assert len(results) == 3

    def test_rerank_with_empty_documents(self) -> None:
        """Test rerank with empty document list."""
        reranker = MockReranker()
        query = "test query"
        documents = []

        results = reranker.rerank(query, documents)

        assert results == []

    async def test_rerank_async_basic(self) -> None:
        """Test basic async rerank functionality."""
        reranker = MockReranker()
        query = "test query"
        documents = ["doc1", "doc2", "doc3"]

        results = await reranker.rerank_async(query, documents)

        assert len(results) == 3
        assert all(isinstance(r, RankedResult) for r in results)
        assert reranker.rerank_async_called

    async def test_rerank_async_with_top_k(self) -> None:
        """Test async rerank with top_k limit."""
        reranker = MockReranker()
        query = "test query"
        documents = ["doc1", "doc2", "doc3", "doc4"]

        results = await reranker.rerank_async(query, documents, top_k=2)

        assert len(results) == 2

    async def test_rerank_async_empty_documents(self) -> None:
        """Test async rerank with empty document list."""
        reranker = MockReranker()
        query = "test query"
        documents = []

        results = await reranker.rerank_async(query, documents)

        assert results == []

    def test_rerank_batch_basic(self) -> None:
        """Test batch reranking."""
        reranker = MockReranker()
        queries = ["query1", "query2", "query3"]
        documents_batch = [
            ["doc1", "doc2"],
            ["doc3", "doc4"],
            ["doc5", "doc6"],
        ]

        results = reranker.rerank_batch(queries, documents_batch)

        assert len(results) == 3
        assert all(len(r) == 2 for r in results)

    def test_rerank_batch_with_top_k(self) -> None:
        """Test batch reranking with top_k."""
        reranker = MockReranker()
        queries = ["query1", "query2"]
        documents_batch = [
            ["doc1", "doc2", "doc3"],
            ["doc4", "doc5", "doc6"],
        ]

        results = reranker.rerank_batch(queries, documents_batch, top_k=2)

        assert len(results) == 2
        assert all(len(r) == 2 for r in results)

    def test_rerank_batch_empty_batch(self) -> None:
        """Test batch reranking with empty batch."""
        reranker = MockReranker()
        queries = []
        documents_batch = []

        results = reranker.rerank_batch(queries, documents_batch)

        assert results == []

    def test_rerank_batch_mixed_sizes(self) -> None:
        """Test batch reranking with different document list sizes."""
        reranker = MockReranker()
        queries = ["query1", "query2", "query3"]
        documents_batch = [
            ["doc1"],
            ["doc2", "doc3"],
            ["doc4", "doc5", "doc6"],
        ]

        results = reranker.rerank_batch(queries, documents_batch)

        assert len(results) == 3
        assert len(results[0]) == 1
        assert len(results[1]) == 2
        assert len(results[2]) == 3

    async def test_rerank_batch_async_basic(self) -> None:
        """Test async batch reranking."""
        reranker = MockReranker()
        queries = ["query1", "query2"]
        documents_batch = [
            ["doc1", "doc2"],
            ["doc3", "doc4"],
        ]

        results = await reranker.rerank_batch_async(queries, documents_batch)

        assert len(results) == 2
        assert all(len(r) == 2 for r in results)

    async def test_rerank_batch_async_with_top_k(self) -> None:
        """Test async batch reranking with top_k."""
        reranker = MockReranker()
        queries = ["query1", "query2"]
        documents_batch = [
            ["doc1", "doc2", "doc3", "doc4"],
            ["doc5", "doc6", "doc7", "doc8"],
        ]

        results = await reranker.rerank_batch_async(queries, documents_batch, top_k=2)

        assert len(results) == 2
        assert all(len(r) == 2 for r in results)

    async def test_rerank_batch_async_empty(self) -> None:
        """Test async batch reranking with empty batch."""
        reranker = MockReranker()
        queries = []
        documents_batch = []

        results = await reranker.rerank_batch_async(queries, documents_batch)

        assert results == []

    def test_rerank_batch_strict_zip(self) -> None:
        """Test that batch reranking enforces strict zip (same length)."""
        reranker = MockReranker()
        queries = ["query1", "query2"]
        documents_batch = [["doc1"]]  # Mismatched length

        with pytest.raises(ValueError):
            reranker.rerank_batch(queries, documents_batch)

    async def test_rerank_batch_async_strict_zip(self) -> None:
        """Test that async batch reranking enforces strict zip."""
        reranker = MockReranker()
        queries = ["query1", "query2", "query3"]
        documents_batch = [["doc1"], ["doc2"]]  # Mismatched length

        with pytest.raises(ValueError):
            await reranker.rerank_batch_async(queries, documents_batch)

    def test_results_sorted_by_score(self) -> None:
        """Test that results are sorted by score descending."""
        reranker = MockReranker()
        documents = ["doc1", "doc2", "doc3", "doc4"]

        results = reranker.rerank("query", documents)

        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_original_index_preserved(self) -> None:
        """Test that original_index is preserved in results."""
        reranker = MockReranker()
        documents = ["doc1", "doc2", "doc3"]

        results = reranker.rerank("query", documents)

        # Check that all original indices are present
        indices = [r.original_index for r in results]
        assert set(indices) == {0, 1, 2}

    def test_rerank_with_single_document(self) -> None:
        """Test reranking with single document."""
        reranker = MockReranker()
        documents = ["single doc"]

        results = reranker.rerank("query", documents)

        assert len(results) == 1
        assert results[0].text == "single doc"

    async def test_rerank_async_with_single_document(self) -> None:
        """Test async reranking with single document."""
        reranker = MockReranker()
        documents = ["single doc"]

        results = await reranker.rerank_async("query", documents)

        assert len(results) == 1
        assert results[0].text == "single doc"

    def test_rerank_error_handling(self) -> None:
        """Test error handling in rerank."""
        reranker = MockReranker(fail_on_empty=True)

        with pytest.raises(ValueError):
            reranker.rerank("query", [])

    async def test_rerank_async_error_handling(self) -> None:
        """Test error handling in async rerank."""
        reranker = MockReranker(fail_on_empty=True)

        with pytest.raises(ValueError):
            await reranker.rerank_async("query", [])

    def test_top_k_zero(self) -> None:
        """Test rerank with top_k=0."""
        reranker = MockReranker()
        documents = ["doc1", "doc2", "doc3"]

        results = reranker.rerank("query", documents, top_k=0)

        assert results == []

    def test_top_k_larger_than_documents(self) -> None:
        """Test rerank with top_k larger than document count."""
        reranker = MockReranker()
        documents = ["doc1", "doc2"]

        results = reranker.rerank("query", documents, top_k=10)

        # Should return all available documents
        assert len(results) == 2

    def test_ranked_result_with_negative_score(self) -> None:
        """Test RankedResult with negative score."""
        result = RankedResult(text="doc", score=-0.5, original_index=0)

        assert result.score == -0.5

    def test_ranked_result_with_large_score(self) -> None:
        """Test RankedResult with score > 1.0."""
        result = RankedResult(text="doc", score=100.0, original_index=0)

        assert result.score == 100.0

    def test_ranked_result_with_empty_text(self) -> None:
        """Test RankedResult with empty text."""
        result = RankedResult(text="", score=0.5, original_index=0)

        assert result.text == ""
        assert result.score == 0.5
