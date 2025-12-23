"""
Extended tests for retrieval metrics.

Tests retrieval evaluation, NDCG, MRR, and recall computation.
"""

import pytest

from engram_benchmark.longmemeval.retriever import RetrievalResult, RetrievedContext
from engram_benchmark.metrics.retrieval import (
    _compute_mrr,
    _compute_ndcg,
    _compute_session_recall,
    _compute_turn_recall,
    compute_retrieval_metrics,
    evaluate_retrieval,
)


class TestEvaluateRetrieval:
    """Test evaluate_retrieval function."""

    def test_perfect_retrieval(self) -> None:
        """Test metrics with perfect retrieval.

        Note: recall@1 is 0.75 because q1 has 2 relevant docs but only 1 can be
        retrieved at k=1 (50% recall), while q2 has 1 relevant doc (100% recall).
        Average = (0.5 + 1.0) / 2 = 0.75
        """
        qrels = {
            "q1": {"doc1": 1, "doc2": 1},
            "q2": {"doc3": 1},
        }
        runs = {
            "q1": {"doc1": 1.0, "doc2": 0.9},
            "q2": {"doc3": 1.0},
        }

        metrics = evaluate_retrieval(qrels, runs, k_values=[1, 5, 10])

        # At k=1, q1 can only retrieve 1/2 docs, so recall is (0.5 + 1.0) / 2 = 0.75
        assert metrics.recall_at_k[1] == 0.75
        assert metrics.recall_at_k[5] == 1.0
        assert metrics.recall_at_k[10] == 1.0
        assert metrics.ndcg_at_k[10] == 1.0
        assert metrics.mrr == 1.0

    def test_partial_retrieval(self) -> None:
        """Test metrics with partial retrieval."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1, "doc3": 1},
        }
        runs = {
            "q1": {"doc1": 1.0, "doc4": 0.9},  # Only 1/3 relevant docs retrieved
        }

        metrics = evaluate_retrieval(qrels, runs, k_values=[1, 5, 10])

        assert metrics.recall_at_k[10] < 1.0
        assert metrics.mrr == 1.0  # First result is relevant

    def test_no_retrieval(self) -> None:
        """Test metrics when no relevant docs are retrieved."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1},
        }
        runs = {
            "q1": {"doc3": 1.0, "doc4": 0.9},  # No relevant docs
        }

        metrics = evaluate_retrieval(qrels, runs, k_values=[1, 5, 10])

        assert metrics.recall_at_k[10] == 0.0
        assert metrics.mrr == 0.0

    def test_custom_k_values(self) -> None:
        """Test with custom K values."""
        qrels = {
            "q1": {"doc1": 1},
        }
        runs = {
            "q1": {"doc1": 1.0},
        }

        metrics = evaluate_retrieval(qrels, runs, k_values=[3, 7, 15])

        assert 3 in metrics.recall_at_k
        assert 7 in metrics.recall_at_k
        assert 15 in metrics.recall_at_k

    def test_default_k_values(self) -> None:
        """Test with default K values."""
        qrels = {
            "q1": {"doc1": 1},
        }
        runs = {
            "q1": {"doc1": 1.0},
        }

        metrics = evaluate_retrieval(qrels, runs)

        # Default K values are [1, 5, 10]
        assert 1 in metrics.recall_at_k
        assert 5 in metrics.recall_at_k
        assert 10 in metrics.recall_at_k


class TestTurnRecall:
    """Test turn recall computation."""

    def test_turn_recall_perfect(self) -> None:
        """Test turn recall with all relevant docs retrieved."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1},
            "q2": {"doc3": 1},
        }
        runs = {
            "q1": {"doc1": 1.0, "doc2": 0.9},
            "q2": {"doc3": 1.0},
        }

        recall = _compute_turn_recall(qrels, runs)
        assert recall == 1.0

    def test_turn_recall_partial(self) -> None:
        """Test turn recall with partial retrieval."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1, "doc3": 1},
        }
        runs = {
            "q1": {"doc1": 1.0},  # Only 1/3 retrieved
        }

        recall = _compute_turn_recall(qrels, runs)
        assert recall == pytest.approx(1 / 3)

    def test_turn_recall_none(self) -> None:
        """Test turn recall with no relevant docs retrieved."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1},
        }
        runs = {
            "q1": {"doc3": 1.0, "doc4": 0.9},
        }

        recall = _compute_turn_recall(qrels, runs)
        assert recall == 0.0

    def test_turn_recall_no_relevant_docs(self) -> None:
        """Test turn recall when no relevant docs exist."""
        qrels = {
            "q1": {"doc1": 0, "doc2": 0},
        }
        runs = {
            "q1": {"doc1": 1.0},
        }

        recall = _compute_turn_recall(qrels, runs)
        assert recall == 0.0

    def test_turn_recall_missing_query(self) -> None:
        """Test turn recall when query is not in runs."""
        qrels = {
            "q1": {"doc1": 1},
            "q2": {"doc2": 1},
        }
        runs = {
            "q1": {"doc1": 1.0},
            # q2 missing
        }

        recall = _compute_turn_recall(qrels, runs)
        assert recall == 0.5  # 1/2 queries have relevant docs retrieved


class TestSessionRecall:
    """Test session recall computation."""

    def test_session_recall_perfect(self) -> None:
        """Test session recall with all sessions retrieved."""
        qrels = {
            "q1": {"session1:turn0": 1, "session1:turn1": 1},
            "q2": {"session2:turn0": 1},
        }
        runs = {
            "q1": {"session1:turn0": 1.0},
            "q2": {"session2:turn0": 1.0},
        }

        recall = _compute_session_recall(qrels, runs)
        assert recall == 1.0

    def test_session_recall_partial(self) -> None:
        """Test session recall with partial session retrieval."""
        qrels = {
            "q1": {"session1:turn0": 1, "session2:turn0": 1},
        }
        runs = {
            "q1": {"session1:turn0": 1.0},  # Only session1 retrieved
        }

        recall = _compute_session_recall(qrels, runs)
        assert recall == 0.5

    def test_session_recall_none(self) -> None:
        """Test session recall with no sessions retrieved."""
        qrels = {
            "q1": {"session1:turn0": 1},
        }
        runs = {
            "q1": {"session2:turn0": 1.0},  # Different session
        }

        recall = _compute_session_recall(qrels, runs)
        assert recall == 0.0

    def test_session_recall_no_relevant_sessions(self) -> None:
        """Test session recall when no relevant sessions exist."""
        qrels = {
            "q1": {"session1:turn0": 0},
        }
        runs = {
            "q1": {"session1:turn0": 1.0},
        }

        recall = _compute_session_recall(qrels, runs)
        assert recall == 0.0


class TestComputeRetrievalMetrics:
    """Test compute_retrieval_metrics function."""

    def test_empty_results(self) -> None:
        """Test with empty results."""
        metrics = compute_retrieval_metrics([])

        assert metrics.turn_recall == 0.0
        assert metrics.session_recall == 0.0
        assert metrics.recall_at_k[1] == 0.0
        assert metrics.mrr == 0.0

    def test_single_result_perfect(self) -> None:
        """Test with single perfect result."""
        results = [
            RetrievalResult(
                question_id="q1",
                contexts=[
                    RetrievedContext(
                        content="context",
                        session_id="session1",
                        turn_index=0,
                        score=1.0,
                        has_answer=True,
                    )
                ],
                total_retrieved=1,
                turn_recall=1.0,
                session_recall=1.0,
            )
        ]

        metrics = compute_retrieval_metrics(results)

        assert metrics.turn_recall == 1.0
        assert metrics.session_recall == 1.0
        assert metrics.recall_at_k[1] == 1.0

    def test_multiple_results(self) -> None:
        """Test with multiple results."""
        results = [
            RetrievalResult(
                question_id="q1",
                contexts=[
                    RetrievedContext(
                        content="context",
                        session_id="session1",
                        turn_index=0,
                        score=1.0,
                        has_answer=True,
                    )
                ],
                total_retrieved=1,
                turn_recall=1.0,
                session_recall=1.0,
            ),
            RetrievalResult(
                question_id="q2",
                contexts=[
                    RetrievedContext(
                        content="context",
                        session_id="session2",
                        turn_index=0,
                        score=0.9,
                        has_answer=False,
                    )
                ],
                total_retrieved=1,
                turn_recall=0.0,
                session_recall=0.0,
            ),
        ]

        metrics = compute_retrieval_metrics(results)

        assert metrics.turn_recall == 0.5
        assert metrics.session_recall == 0.5


class TestComputeNDCG:
    """Test NDCG computation."""

    def test_ndcg_perfect_ranking(self) -> None:
        """Test NDCG with perfect ranking."""
        relevance = [1, 1, 1, 0, 0]
        ndcg = _compute_ndcg(relevance, k=5)
        assert ndcg == 1.0

    def test_ndcg_reversed_ranking(self) -> None:
        """Test NDCG with reversed ranking."""
        relevance = [0, 0, 1, 1, 1]
        ndcg = _compute_ndcg(relevance, k=5)
        assert ndcg < 1.0
        assert ndcg > 0.0

    def test_ndcg_empty(self) -> None:
        """Test NDCG with empty relevance."""
        relevance: list[int] = []
        ndcg = _compute_ndcg(relevance, k=5)
        assert ndcg == 0.0

    def test_ndcg_no_relevant(self) -> None:
        """Test NDCG with no relevant documents."""
        relevance = [0, 0, 0, 0, 0]
        ndcg = _compute_ndcg(relevance, k=5)
        assert ndcg == 0.0

    def test_ndcg_k_larger_than_list(self) -> None:
        """Test NDCG when K is larger than list."""
        relevance = [1, 1]
        ndcg = _compute_ndcg(relevance, k=10)
        assert ndcg == 1.0

    def test_ndcg_partial_relevance(self) -> None:
        """Test NDCG with partial relevance."""
        relevance = [1, 0, 1, 0, 1]
        ndcg = _compute_ndcg(relevance, k=5)
        assert 0.0 < ndcg < 1.0


class TestComputeMRR:
    """Test MRR computation."""

    def test_mrr_first_position(self) -> None:
        """Test MRR when first result is relevant."""
        relevance = [1, 0, 0, 0, 0]
        mrr = _compute_mrr(relevance)
        assert mrr == 1.0

    def test_mrr_second_position(self) -> None:
        """Test MRR when second result is relevant."""
        relevance = [0, 1, 0, 0, 0]
        mrr = _compute_mrr(relevance)
        assert mrr == 0.5

    def test_mrr_third_position(self) -> None:
        """Test MRR when third result is relevant."""
        relevance = [0, 0, 1, 0, 0]
        mrr = _compute_mrr(relevance)
        assert mrr == pytest.approx(1 / 3)

    def test_mrr_no_relevant(self) -> None:
        """Test MRR when no results are relevant."""
        relevance = [0, 0, 0, 0, 0]
        mrr = _compute_mrr(relevance)
        assert mrr == 0.0

    def test_mrr_empty(self) -> None:
        """Test MRR with empty relevance."""
        relevance: list[int] = []
        mrr = _compute_mrr(relevance)
        assert mrr == 0.0

    def test_mrr_multiple_relevant(self) -> None:
        """Test MRR with multiple relevant docs (uses first)."""
        relevance = [0, 1, 1, 1, 1]
        mrr = _compute_mrr(relevance)
        assert mrr == 0.5  # First relevant at position 2


class TestRetrievalMetricsEdgeCases:
    """Test edge cases for retrieval metrics."""

    def test_results_with_no_contexts(self) -> None:
        """Test metrics when results have no contexts."""
        results = [
            RetrievalResult(
                question_id="q1",
                contexts=[],
                total_retrieved=0,
                turn_recall=0.0,
                session_recall=0.0,
            )
        ]

        metrics = compute_retrieval_metrics(results)

        assert metrics.turn_recall == 0.0
        assert metrics.session_recall == 0.0

    def test_results_with_mixed_relevance(self) -> None:
        """Test metrics with mixed relevance scores."""
        results = [
            RetrievalResult(
                question_id="q1",
                contexts=[
                    RetrievedContext(
                        content="ctx1",
                        session_id="s1",
                        turn_index=0,
                        score=1.0,
                        has_answer=True,
                    ),
                    RetrievedContext(
                        content="ctx2",
                        session_id="s1",
                        turn_index=1,
                        score=0.9,
                        has_answer=False,
                    ),
                    RetrievedContext(
                        content="ctx3",
                        session_id="s2",
                        turn_index=0,
                        score=0.8,
                        has_answer=True,
                    ),
                ],
                total_retrieved=3,
                turn_recall=1.0,
                session_recall=1.0,
            )
        ]

        metrics = compute_retrieval_metrics(results)

        # Should compute recall at different K values
        assert 1 in metrics.recall_at_k
        assert 5 in metrics.recall_at_k
        assert 10 in metrics.recall_at_k
