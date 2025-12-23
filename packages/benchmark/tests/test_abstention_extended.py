"""
Extended tests for abstention metrics.

Tests abstention detection, precision, recall, F1, and phrase management.
"""

import pytest

from engram_benchmark.metrics.abstention import (
    ABSTENTION_PHRASES,
    _is_abstention,
    add_abstention_phrase,
    compute_abstention_metrics,
    evaluate_abstention,
)


class TestIsAbstention:
    """Test _is_abstention function."""

    def test_exact_match_phrases(self) -> None:
        """Test exact match with known phrases."""
        assert _is_abstention("I don't know")
        assert _is_abstention("I do not know")
        assert _is_abstention("Cannot answer")
        assert _is_abstention("Can't answer")
        assert _is_abstention("No information")
        assert _is_abstention("Insufficient information")
        assert _is_abstention("Unable to answer")

    def test_case_insensitive(self) -> None:
        """Test case insensitivity."""
        assert _is_abstention("I DON'T KNOW")
        assert _is_abstention("i don't know")
        assert _is_abstention("CaNnOt AnSwEr")

    def test_whitespace_handling(self) -> None:
        """Test whitespace stripping."""
        assert _is_abstention("  I don't know  ")
        assert _is_abstention("\tCannot answer\n")

    def test_punctuation_handling(self) -> None:
        """Test trailing punctuation removal."""
        assert _is_abstention("I don't know.")
        assert _is_abstention("Cannot answer!")
        assert _is_abstention("No information?")
        assert _is_abstention("Insufficient information,")

    def test_substring_matches(self) -> None:
        """Test substring pattern matching."""
        assert _is_abstention("I don't know the answer")
        assert _is_abstention("I cannot answer that question")
        assert _is_abstention("There is insufficient information")
        assert _is_abstention("I'm not sure about this")

    def test_non_abstention_phrases(self) -> None:
        """Test phrases that are not abstentions."""
        assert not _is_abstention("Paris")
        assert not _is_abstention("The answer is 42")
        assert not _is_abstention("I know the answer")
        assert not _is_abstention("I can answer that")


class TestAddAbstentionPhrase:
    """Test add_abstention_phrase function."""

    def test_add_custom_phrase(self) -> None:
        """Test adding a custom abstention phrase."""
        # Store original length
        original_length = len(ABSTENTION_PHRASES)

        # Add custom phrase
        custom_phrase = "I have no idea about this"
        add_abstention_phrase(custom_phrase)

        # Verify it was added
        assert custom_phrase.lower().strip() in ABSTENTION_PHRASES
        assert len(ABSTENTION_PHRASES) > original_length

        # Verify it's now detected
        assert _is_abstention(custom_phrase)

    def test_add_phrase_with_whitespace(self) -> None:
        """Test adding phrase with whitespace."""
        phrase = "  No clue  "
        add_abstention_phrase(phrase)
        assert "no clue" in ABSTENTION_PHRASES

    def test_add_duplicate_phrase(self) -> None:
        """Test adding duplicate phrase (should not increase size)."""
        original_length = len(ABSTENTION_PHRASES)
        add_abstention_phrase("I don't know")  # Already exists
        assert len(ABSTENTION_PHRASES) == original_length


class TestEvaluateAbstention:
    """Test evaluate_abstention function."""

    def test_all_correct(self) -> None:
        """Test when all predictions are correct."""
        predictions = ["I don't know", "Paris", "Cannot answer", "42"]
        ground_truth = ["I don't know", "Paris", "Cannot answer", "42"]
        is_abstention_required = [True, False, True, False]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.true_positives == 2  # Correctly abstained
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 2  # Correctly answered
        assert metrics.precision == 1.0
        assert metrics.recall == 1.0
        assert metrics.f1 == 1.0

    def test_false_positives(self) -> None:
        """Test when model abstains when it shouldn't."""
        predictions = ["I don't know", "I don't know"]
        ground_truth = ["Paris", "London"]
        is_abstention_required = [False, False]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 2  # Incorrectly abstained
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0

    def test_false_negatives(self) -> None:
        """Test when model answers when it should abstain."""
        predictions = ["Paris", "London"]
        ground_truth = ["I don't know", "Cannot answer"]
        is_abstention_required = [True, True]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 2  # Should have abstained
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0

    def test_mixed_results(self) -> None:
        """Test with mixed correct and incorrect predictions."""
        predictions = ["I don't know", "Paris", "London", "Cannot answer"]
        ground_truth = ["I don't know", "Paris", "I don't know", "42"]
        is_abstention_required = [True, False, True, False]

        metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)

        assert metrics.true_positives == 1  # q1: correctly abstained
        assert metrics.false_positives == 1  # q4: incorrectly abstained
        assert metrics.false_negatives == 1  # q3: should have abstained
        assert metrics.true_negatives == 1  # q2: correctly answered

        # Precision: TP / (TP + FP) = 1 / 2 = 0.5
        assert metrics.precision == 0.5
        # Recall: TP / (TP + FN) = 1 / 2 = 0.5
        assert metrics.recall == 0.5
        # F1: 2 * (0.5 * 0.5) / (0.5 + 0.5) = 0.5
        assert metrics.f1 == 0.5

    def test_mismatched_lengths(self) -> None:
        """Test with mismatched input lengths."""
        with pytest.raises(ValueError, match="same length"):
            evaluate_abstention(
                predictions=["Paris"],
                ground_truth=["Paris", "London"],
                is_abstention_required=[False],
            )

        with pytest.raises(ValueError, match="same length"):
            evaluate_abstention(
                predictions=["Paris"],
                ground_truth=["Paris"],
                is_abstention_required=[False, True],
            )

    def test_empty_inputs(self) -> None:
        """Test with empty inputs."""
        metrics = evaluate_abstention(
            predictions=[],
            ground_truth=[],
            is_abstention_required=[],
        )

        assert metrics.true_positives == 0
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0


class TestComputeAbstentionMetrics:
    """Test compute_abstention_metrics function."""

    def test_all_correct(self) -> None:
        """Test with all correct predictions."""
        predictions = [True, False, True, False]
        ground_truth = [True, False, True, False]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 2
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 2
        assert metrics.precision == 1.0
        assert metrics.recall == 1.0
        assert metrics.f1 == 1.0

    def test_all_false_positives(self) -> None:
        """Test with all false positives."""
        predictions = [True, True, True]
        ground_truth = [False, False, False]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 3
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0

    def test_all_false_negatives(self) -> None:
        """Test with all false negatives."""
        predictions = [False, False, False]
        ground_truth = [True, True, True]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 3
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0

    def test_mixed_results(self) -> None:
        """Test with mixed predictions."""
        predictions = [True, False, True, False]
        ground_truth = [True, False, False, True]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 1  # predictions[0]
        assert metrics.false_positives == 1  # predictions[2]
        assert metrics.false_negatives == 1  # predictions[3]
        assert metrics.true_negatives == 1  # predictions[1]

        # Precision: 1 / (1 + 1) = 0.5
        assert metrics.precision == 0.5
        # Recall: 1 / (1 + 1) = 0.5
        assert metrics.recall == 0.5
        # F1: 2 * (0.5 * 0.5) / (0.5 + 0.5) = 0.5
        assert metrics.f1 == 0.5

    def test_perfect_precision_imperfect_recall(self) -> None:
        """Test perfect precision but imperfect recall."""
        predictions = [True, False, False, False]
        ground_truth = [True, False, True, True]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 1
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 2
        assert metrics.true_negatives == 1

        # Precision: 1 / (1 + 0) = 1.0
        assert metrics.precision == 1.0
        # Recall: 1 / (1 + 2) = 0.333...
        assert metrics.recall == pytest.approx(1 / 3)
        # F1: 2 * (1.0 * 0.333) / (1.0 + 0.333) = 0.5
        assert metrics.f1 == pytest.approx(0.5)

    def test_imperfect_precision_perfect_recall(self) -> None:
        """Test imperfect precision but perfect recall."""
        predictions = [True, True, True, False]
        ground_truth = [True, True, False, False]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 2
        assert metrics.false_positives == 1
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 1

        # Precision: 2 / (2 + 1) = 0.666...
        assert metrics.precision == pytest.approx(2 / 3)
        # Recall: 2 / (2 + 0) = 1.0
        assert metrics.recall == 1.0
        # F1: 2 * (0.666 * 1.0) / (0.666 + 1.0) = 0.8
        assert metrics.f1 == pytest.approx(0.8)

    def test_mismatched_lengths(self) -> None:
        """Test with mismatched input lengths."""
        with pytest.raises(ValueError, match="same length"):
            compute_abstention_metrics(
                predictions=[True, False],
                ground_truth=[True],
            )

    def test_empty_inputs(self) -> None:
        """Test with empty inputs."""
        metrics = compute_abstention_metrics(
            predictions=[],
            ground_truth=[],
        )

        assert metrics.true_positives == 0
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 0
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 == 0.0

    def test_no_abstentions_predicted(self) -> None:
        """Test when no abstentions are predicted."""
        predictions = [False, False, False]
        ground_truth = [True, True, False]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 0
        assert metrics.false_negatives == 2
        assert metrics.true_negatives == 1
        assert metrics.precision == 0.0  # No predictions to measure
        assert metrics.recall == 0.0

    def test_no_abstentions_required(self) -> None:
        """Test when no abstentions are required."""
        predictions = [True, True, False]
        ground_truth = [False, False, False]

        metrics = compute_abstention_metrics(predictions, ground_truth)

        assert metrics.true_positives == 0
        assert metrics.false_positives == 2
        assert metrics.false_negatives == 0
        assert metrics.true_negatives == 1
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0  # No ground truth abstentions


class TestAbstentionPhrases:
    """Test ABSTENTION_PHRASES constant."""

    def test_phrases_are_lowercase(self) -> None:
        """Test that all phrases in the set are lowercase."""
        for phrase in ABSTENTION_PHRASES:
            assert phrase == phrase.lower()

    def test_common_phrases_present(self) -> None:
        """Test that common abstention phrases are present."""
        required_phrases = [
            "i don't know",
            "i do not know",
            "cannot answer",
            "can't answer",
            "insufficient information",
        ]

        for phrase in required_phrases:
            assert phrase in ABSTENTION_PHRASES
