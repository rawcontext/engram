"""
Tests for metrics module.

Tests all metric implementations:
- Retrieval metrics (ranx-based)
- QA metrics (exact match + LLM eval)
- Abstention metrics
- RAGAS metrics
- Latency tracking
"""

from typing import cast

import pytest

from engram_benchmark.longmemeval.types import MemoryAbility  # noqa: TCH001
from engram_benchmark.metrics import (
    ABSTENTION_PHRASES,
    LatencyTracker,
    add_abstention_phrase,
    compute_custom_percentiles,
    compute_latency_percentiles,
    evaluate_abstention,
    evaluate_qa_sync,
    evaluate_retrieval,
)


class TestRetrievalMetrics:
    """Test retrieval metrics using ranx."""

    def test_perfect_retrieval(self) -> None:
        """Test metrics when all relevant documents are retrieved."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1, "doc3": 0},
            "q2": {"doc4": 1},
        }
        runs = {
            "q1": {"doc1": 1.0, "doc2": 0.9, "doc3": 0.1},
            "q2": {"doc4": 1.0},
        }

        metrics = evaluate_retrieval(qrels, runs)

        assert metrics.recall_at_k[10] == 1.0  # All relevant docs retrieved
        assert metrics.ndcg_at_k[10] == 1.0  # Perfect ranking
        assert metrics.mrr == 1.0  # First result is relevant

    def test_partial_retrieval(self) -> None:
        """Test metrics with partial retrieval."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1, "doc3": 1},
        }
        runs = {
            "q1": {"doc1": 1.0, "doc4": 0.8},  # Only 1 of 3 relevant retrieved
        }

        metrics = evaluate_retrieval(qrels, runs)

        # Only 1/3 relevant docs retrieved
        assert 0.3 < metrics.recall_at_k[10] < 0.4

    def test_no_relevant_retrieved(self) -> None:
        """Test metrics when no relevant documents are retrieved."""
        qrels = {
            "q1": {"doc1": 1, "doc2": 1},
        }
        runs = {
            "q1": {"doc3": 1.0, "doc4": 0.9},  # None are relevant
        }

        metrics = evaluate_retrieval(qrels, runs)

        assert metrics.recall_at_k[10] == 0.0
        assert metrics.ndcg_at_k[10] == 0.0
        assert metrics.mrr == 0.0

    def test_custom_k_values(self) -> None:
        """Test custom K values for recall and NDCG."""
        qrels = {"q1": {"doc1": 1, "doc2": 1}}
        runs = {"q1": {"doc1": 1.0, "doc2": 0.9}}

        metrics = evaluate_retrieval(qrels, runs, k_values=[1, 3, 5])

        assert 1 in metrics.recall_at_k
        assert 3 in metrics.recall_at_k
        assert 5 in metrics.recall_at_k
        assert 1 in metrics.ndcg_at_k
        assert 3 in metrics.ndcg_at_k
        assert 5 in metrics.ndcg_at_k

    def test_turn_recall(self) -> None:
        """Test turn-level recall computation."""
        qrels = {
            "q1": {"session1:0": 1, "session1:1": 1, "session2:0": 0},
        }
        runs = {
            "q1": {"session1:0": 1.0, "session2:0": 0.5},  # 1/2 relevant retrieved
        }

        metrics = evaluate_retrieval(qrels, runs)

        assert metrics.turn_recall == 0.5

    def test_session_recall(self) -> None:
        """Test session-level recall computation."""
        qrels = {
            "q1": {
                "session1:0": 1,
                "session1:1": 1,
                "session2:0": 1,
            },
        }
        runs = {
            "q1": {"session1:0": 1.0},  # Only session1 retrieved
        }

        metrics = evaluate_retrieval(qrels, runs)

        assert metrics.session_recall == 0.5  # 1 of 2 sessions


class TestQAMetrics:
    """Test QA accuracy metrics."""

    def test_exact_match_perfect(self) -> None:
        """Test perfect exact match accuracy."""
        predictions = ["Paris", "London", "Berlin"]
        ground_truth = ["Paris", "London", "Berlin"]
        question_types: list[MemoryAbility] = [
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
        ]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(predictions, ground_truth, question_types, question_ids)

        assert metrics["overall"].total == 3
        assert metrics["overall"].correct == 3
        assert metrics["overall"].accuracy == 1.0

    def test_exact_match_partial(self) -> None:
        """Test partial exact match accuracy."""
        predictions = ["Paris", "Berlin", "Madrid"]
        ground_truth = ["Paris", "London", "Madrid"]
        question_types: list[MemoryAbility] = [
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
        ]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(predictions, ground_truth, question_types, question_ids)

        assert metrics["overall"].total == 3
        assert metrics["overall"].correct == 2
        assert abs(metrics["overall"].accuracy - 0.667) < 0.01

    def test_case_insensitive_match(self) -> None:
        """Test case-insensitive matching."""
        predictions = ["PARIS", "london", "BeRLiN"]
        ground_truth = ["paris", "London", "berlin"]
        question_types: list[MemoryAbility] = [
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
        ]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(predictions, ground_truth, question_types, question_ids)

        assert metrics["overall"].accuracy == 1.0

    def test_punctuation_normalization(self) -> None:
        """Test punctuation is stripped during matching."""
        predictions = ["Paris.", "London!", "Berlin?"]
        ground_truth = ["Paris", "London", "Berlin"]
        question_types: list[MemoryAbility] = [
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
        ]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(predictions, ground_truth, question_types, question_ids)

        assert metrics["overall"].accuracy == 1.0

    def test_by_ability_breakdown(self) -> None:
        """Test metrics are correctly grouped by ability."""
        predictions = ["A", "B", "C", "D", "E"]
        ground_truth = ["A", "X", "C", "D", "Y"]
        question_types: list[MemoryAbility] = [
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "IE"),
            cast("MemoryAbility", "MR"),
            cast("MemoryAbility", "TR"),
            cast("MemoryAbility", "KU"),
        ]
        question_ids = ["q1", "q2", "q3", "q4", "q5"]

        metrics = evaluate_qa_sync(predictions, ground_truth, question_types, question_ids)

        # Check overall
        assert metrics["overall"].total == 5
        assert metrics["overall"].correct == 3

        # Check IE (2 questions, 1 correct)
        assert metrics["IE"].total == 2
        assert metrics["IE"].correct == 1
        assert metrics["IE"].accuracy == 0.5

        # Check MR (1 question, 1 correct)
        assert metrics["MR"].total == 1
        assert metrics["MR"].correct == 1
        assert metrics["MR"].accuracy == 1.0

        # Check TR (1 question, 1 correct)
        assert metrics["TR"].total == 1
        assert metrics["TR"].correct == 1

        # Check KU (1 question, 0 correct)
        assert metrics["KU"].total == 1
        assert metrics["KU"].correct == 0
        assert metrics["KU"].accuracy == 0.0

    def test_empty_input(self) -> None:
        """Test handling of empty input."""
        metrics = evaluate_qa_sync([], [], [], [])

        assert metrics["overall"].total == 0
        assert metrics["overall"].correct == 0
        assert metrics["overall"].accuracy == 0.0

    def test_mismatched_lengths(self) -> None:
        """Test error on mismatched input lengths."""
        with pytest.raises(ValueError, match="same length"):
            evaluate_qa_sync(["A"], ["A", "B"], [cast("MemoryAbility", "IE")], ["q1"])


class TestAbstentionMetrics:
    """Test abstention metrics."""

    def test_perfect_abstention(self) -> None:
        """Test perfect abstention detection."""
        predictions = ["I don't know", "Paris", "Cannot answer", "London"]
        ground_truth = ["Cannot answer", "Paris", "I don't know", "London"]
        is_abstention_required = [True, False, True, False]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.true_positives == 2  # Correctly abstained
        assert metrics.false_positives == 0  # No incorrect abstentions
        assert metrics.false_negatives == 0  # Didn't miss any
        assert metrics.true_negatives == 2  # Correctly answered
        assert metrics.precision == 1.0
        assert metrics.recall == 1.0
        assert metrics.f1 == 1.0

    def test_false_abstention(self) -> None:
        """Test false abstention (abstained when shouldn't)."""
        predictions = ["I don't know", "Paris"]
        ground_truth = ["Paris", "Paris"]
        is_abstention_required = [False, False]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.false_positives == 1  # Incorrectly abstained
        assert metrics.true_negatives == 1  # Correctly answered
        assert metrics.precision == 0.0  # No correct abstentions
        assert metrics.f1 == 0.0

    def test_missed_abstention(self) -> None:
        """Test missed abstention (should have abstained but didn't)."""
        predictions = ["Paris", "I don't know"]
        ground_truth = ["Cannot answer", "Cannot answer"]
        is_abstention_required = [True, True]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.false_negatives == 1  # Should have abstained
        assert metrics.true_positives == 1  # Correctly abstained
        assert metrics.recall == 0.5

    def test_abstention_phrase_detection(self) -> None:
        """Test various abstention phrases are detected."""
        abstention_predictions = [
            "I don't know",
            "I do not know",
            "Cannot answer",
            "Can't answer",
            "No information",
            "Insufficient information",
            "Unable to answer",
            "Not enough information",
            "I'm not sure",
        ]

        for pred in abstention_predictions:
            metrics = evaluate_abstention(
                [pred],
                ["Cannot answer"],
                [True],
            )
            assert metrics.true_positives == 1, f"Failed to detect: {pred}"

    def test_custom_abstention_phrase(self) -> None:
        """Test adding custom abstention phrases."""
        original_size = len(ABSTENTION_PHRASES)

        add_abstention_phrase("I have no idea")

        assert len(ABSTENTION_PHRASES) == original_size + 1
        assert "i have no idea" in ABSTENTION_PHRASES

        # Test it works
        metrics = evaluate_abstention(
            ["I have no idea"],
            ["Cannot answer"],
            [True],
        )
        assert metrics.true_positives == 1

    def test_partial_phrase_match(self) -> None:
        """Test partial phrase matching."""
        # Should match because contains "don't know"
        metrics = evaluate_abstention(
            ["Well, I don't know the answer"],
            ["Cannot answer"],
            [True],
        )
        assert metrics.true_positives == 1

    def test_empty_input(self) -> None:
        """Test handling of empty input."""
        metrics = evaluate_abstention([], [], [])

        assert metrics.true_positives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0


class TestLatencyMetrics:
    """Test latency tracking and percentile computation."""

    def test_basic_percentiles(self) -> None:
        """Test basic percentile computation."""
        latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]

        metrics = compute_latency_percentiles(latencies)

        assert metrics.count == 10
        assert metrics.min_ms == 100
        assert metrics.max_ms == 1000
        assert metrics.mean_ms == 550
        assert metrics.median_ms == 550
        assert metrics.p50_ms == 550
        assert abs(metrics.p90_ms - 910) < 0.1  # 90th percentile
        assert abs(metrics.p95_ms - 955) < 0.1  # 95th percentile
        assert abs(metrics.p99_ms - 991) < 0.1  # 99th percentile

    def test_single_value(self) -> None:
        """Test percentiles with single value."""
        metrics = compute_latency_percentiles([100])

        assert metrics.count == 1
        assert metrics.mean_ms == 100
        assert metrics.p50_ms == 100
        assert metrics.p90_ms == 100
        assert metrics.p95_ms == 100
        assert metrics.p99_ms == 100

    def test_empty_input(self) -> None:
        """Test handling of empty input."""
        metrics = compute_latency_percentiles([])

        assert metrics.count == 0
        assert metrics.mean_ms == 0.0
        assert metrics.p50_ms == 0.0

    def test_custom_percentiles(self) -> None:
        """Test custom percentile computation."""
        latencies = list(range(1, 101))  # 1-100

        percentiles = compute_custom_percentiles(latencies, [25, 50, 75, 90, 99.9])

        assert abs(percentiles["p25"] - 25.75) < 0.01
        assert abs(percentiles["p50"] - 50.5) < 0.01
        assert abs(percentiles["p75"] - 75.25) < 0.01
        assert abs(percentiles["p90"] - 90.1) < 0.01
        assert "p99.9" in percentiles

    def test_invalid_percentile(self) -> None:
        """Test error on invalid percentile."""
        with pytest.raises(ValueError, match="between 0 and 100"):
            compute_custom_percentiles([100], [150])

        with pytest.raises(ValueError, match="between 0 and 100"):
            compute_custom_percentiles([100], [-10])

    def test_latency_tracker(self) -> None:
        """Test LatencyTracker class."""
        tracker = LatencyTracker()

        assert len(tracker) == 0

        # Add some latencies
        tracker.add(100)
        tracker.add(200)
        tracker.add(300)

        assert len(tracker) == 3

        metrics = tracker.get_metrics()
        assert metrics.count == 3
        assert metrics.mean_ms == 200

        # Add multiple
        tracker.add_multiple([400, 500])
        assert len(tracker) == 5

        # Reset
        tracker.reset()
        assert len(tracker) == 0

    def test_latency_tracker_validation(self) -> None:
        """Test LatencyTracker validates input."""
        tracker = LatencyTracker()

        with pytest.raises(ValueError, match="non-negative"):
            tracker.add(-100)

    def test_latency_tracker_copy(self) -> None:
        """Test latency tracker returns copy."""
        tracker = LatencyTracker()
        tracker.add(100)

        latencies = tracker.latencies
        latencies.append(200)

        # Original should not be modified
        assert len(tracker) == 1
        assert tracker.latencies == [100]


# Note: RAGAS tests are excluded because they require LLM API calls
# and would be slow/expensive. These should be tested manually or in
# integration tests with mocked LLM responses.
