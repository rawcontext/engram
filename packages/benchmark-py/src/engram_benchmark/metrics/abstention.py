"""
Abstention metrics (precision, recall, F1).

Evaluates the system's ability to abstain (say "I don't know") when:
- Evidence is missing
- Question is unanswerable
- Confidence is low

Metrics:
- Precision: Correct abstentions / Total abstentions
- Recall: Correct abstentions / Questions requiring abstention
- F1: Harmonic mean of precision and recall
"""

from engram_benchmark.longmemeval.types import AbstentionMetrics

# Common abstention phrases (normalized to lowercase)
ABSTENTION_PHRASES = {
    "i don't know",
    "i do not know",
    "cannot answer",
    "can't answer",
    "no information",
    "insufficient information",
    "unable to answer",
    "not enough information",
    "don't have enough information",
    "no evidence",
    "insufficient evidence",
    "not sure",
    "i'm not sure",
    "unknown",
    "i don't have that information",
}


def evaluate_abstention(
    predictions: list[str],
    ground_truth: list[str],
    is_abstention_required: list[bool],
) -> AbstentionMetrics:
    """
    Evaluate abstention precision, recall, and F1.

    Args:
            predictions: List of predicted answers
            ground_truth: List of ground truth answers
            is_abstention_required: Whether each question requires abstention

    Returns:
            AbstentionMetrics with TP, FP, FN, TN, precision, recall, F1

    Example:
            ```python
            predictions = ["Paris", "I don't know", "42", "Cannot answer"]
            ground_truth = ["Paris", "Cannot answer", "42", "London"]
            is_abstention_required = [False, True, False, True]

            metrics = evaluate_abstention(predictions, ground_truth, is_abstention_required)
            print(f"Abstention F1: {metrics.f1:.3f}")
            print(f"Precision: {metrics.precision:.3f}")
            print(f"Recall: {metrics.recall:.3f}")
            ```
    """
    if len(predictions) != len(ground_truth):
        raise ValueError("predictions and ground_truth must have same length")
    if len(predictions) != len(is_abstention_required):
        raise ValueError("predictions and is_abstention_required must have same length")

    # Count confusion matrix elements
    true_positives = 0  # Correctly abstained
    false_positives = 0  # Incorrectly abstained
    false_negatives = 0  # Should have abstained but didn't
    true_negatives = 0  # Correctly answered

    for pred, truth, should_abstain in zip(
        predictions, ground_truth, is_abstention_required, strict=True
    ):
        pred_abstains = _is_abstention(pred)
        truth_abstains = _is_abstention(truth)

        if should_abstain:
            # This question requires abstention
            if pred_abstains and truth_abstains:
                true_positives += 1
            elif not pred_abstains:
                false_negatives += 1
            else:
                # pred_abstains but truth doesn't - still counts as TP for our purposes
                # since the question required abstention
                true_positives += 1
        else:
            # This question has an answer
            if pred_abstains:
                false_positives += 1
            else:
                true_negatives += 1

    # Compute metrics
    precision = (
        true_positives / (true_positives + false_positives)
        if (true_positives + false_positives) > 0
        else 0.0
    )

    recall = (
        true_positives / (true_positives + false_negatives)
        if (true_positives + false_negatives) > 0
        else 0.0
    )

    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return AbstentionMetrics(
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        true_negatives=true_negatives,
        precision=precision,
        recall=recall,
        f1=f1,
    )


def _is_abstention(text: str) -> bool:
    """
    Check if text represents an abstention.

    Uses common abstention phrases (case-insensitive).
    """
    normalized = text.lower().strip().rstrip(".!?,;:")

    # Check exact match with known phrases
    if normalized in ABSTENTION_PHRASES:
        return True

    # Check substring matches for common patterns
    abstention_patterns = [
        "don't know",
        "do not know",
        "cannot answer",
        "can't answer",
        "no information",
        "insufficient",
        "unable to",
        "not enough",
        "no evidence",
        "not sure",
        "i'm not sure",
    ]

    return any(pattern in normalized for pattern in abstention_patterns)


def add_abstention_phrase(phrase: str) -> None:
    """
    Add a custom abstention phrase to the detection list.

    Args:
            phrase: Phrase to add (will be normalized to lowercase)

    Example:
            ```python
            add_abstention_phrase("I have no idea")
            ```
    """
    ABSTENTION_PHRASES.add(phrase.lower().strip())
