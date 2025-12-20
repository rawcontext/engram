"""
RAGAS integration for RAG evaluation.

Implements RAG-specific metrics using the RAGAS framework:
- Faithfulness: How well the answer is grounded in the retrieved context
- Context Recall: How much of the ground truth is covered by retrieved context
- Context Precision: How relevant the retrieved context is
- Answer Relevancy: How relevant the answer is to the question

Based on RAGAS: https://docs.ragas.io/en/stable/

Note: RAGAS API may require actual LLM/embedding objects instead of strings.
This implementation uses string model names which may need adaptation based on
the installed RAGAS version.
"""

from dataclasses import dataclass
from typing import Any

from datasets import Dataset
from ragas import evaluate as ragas_evaluate
from ragas.metrics import (
    AnswerRelevancy,
    ContextPrecision,
    ContextRecall,
    Faithfulness,
)


@dataclass
class RAGASMetrics:
    """RAGAS evaluation metrics."""

    faithfulness: float
    answer_relevancy: float
    context_precision: float
    context_recall: float


async def evaluate_ragas(
    questions: list[str],
    answers: list[str],
    contexts: list[list[str]],
    ground_truths: list[str],
    llm_model: str = "openai/gpt-4o",
    embedding_model: str = "BAAI/bge-base-en-v1.5",
) -> RAGASMetrics:
    """
    Evaluate using RAGAS metrics.

    Args:
            questions: List of questions
            answers: List of generated answers
            contexts: List of retrieved context lists (each is list of strings)
            ground_truths: List of ground truth answers
            llm_model: LLM model for evaluation (default: gpt-4o)
            embedding_model: Embedding model for similarity (default: bge-base-en-v1.5)

    Returns:
            RAGASMetrics with faithfulness, relevancy, precision, recall

    Example:
            ```python
            questions = ["What is the capital of France?"]
            answers = ["The capital of France is Paris."]
            contexts = [["Paris is the capital of France.", "It has 2M people."]]
            ground_truths = ["Paris"]

            metrics = await evaluate_ragas(
                    questions, answers, contexts, ground_truths
            )
            print(f"Faithfulness: {metrics.faithfulness:.3f}")
            print(f"Context recall: {metrics.context_recall:.3f}")
            ```
    """
    if len(questions) != len(answers):
        raise ValueError("questions and answers must have same length")
    if len(questions) != len(contexts):
        raise ValueError("questions and contexts must have same length")
    if len(questions) != len(ground_truths):
        raise ValueError("questions and ground_truths must have same length")

    # Create HuggingFace dataset
    dataset = Dataset.from_dict(
        {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
            "ground_truth": ground_truths,
        }
    )

    # Configure RAGAS metrics
    metrics = [
        Faithfulness(),
        AnswerRelevancy(),
        ContextPrecision(),
        ContextRecall(),
    ]

    # Run evaluation
    # Note: This may fail with current RAGAS version if it expects LLM objects
    # instead of strings. The type: ignore is added because the RAGAS API
    # is not fully typed in our mypy configuration.
    result = ragas_evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=llm_model,  # type: ignore[arg-type]
        embeddings=embedding_model,  # type: ignore[arg-type]
    )

    # Extract scores
    # RAGAS returns a dict-like object, but types are not precise
    result_dict: dict[str, Any] = result  # type: ignore[assignment]
    return RAGASMetrics(
        faithfulness=float(result_dict["faithfulness"]),
        answer_relevancy=float(result_dict["answer_relevancy"]),
        context_precision=float(result_dict["context_precision"]),
        context_recall=float(result_dict["context_recall"]),
    )


async def evaluate_ragas_subset(
    questions: list[str],
    answers: list[str],
    contexts: list[list[str]],
    ground_truths: list[str],
    metric_names: list[str],
    llm_model: str = "openai/gpt-4o",
    embedding_model: str = "BAAI/bge-base-en-v1.5",
) -> dict[str, float]:
    """
    Evaluate using a subset of RAGAS metrics.

    This is useful when you only need specific metrics and want to save time.

    Args:
            questions: List of questions
            answers: List of generated answers
            contexts: List of retrieved context lists
            ground_truths: List of ground truth answers
            metric_names: Names of metrics to compute
                                      Options: "faithfulness", "answer_relevancy",
                                                      "context_precision", "context_recall"
            llm_model: LLM model for evaluation
            embedding_model: Embedding model for similarity

    Returns:
            Dictionary mapping metric name to score

    Example:
            ```python
            # Only compute faithfulness and context recall
            metrics = await evaluate_ragas_subset(
                    questions, answers, contexts, ground_truths,
                    metric_names=["faithfulness", "context_recall"]
            )
            ```
    """
    if len(questions) != len(answers):
        raise ValueError("questions and answers must have same length")
    if len(questions) != len(contexts):
        raise ValueError("questions and contexts must have same length")
    if len(questions) != len(ground_truths):
        raise ValueError("questions and ground_truths must have same length")

    # Map metric names to classes
    metric_map = {
        "faithfulness": Faithfulness(),
        "answer_relevancy": AnswerRelevancy(),
        "context_precision": ContextPrecision(),
        "context_recall": ContextRecall(),
    }

    # Validate metric names
    invalid_metrics = [name for name in metric_names if name not in metric_map]
    if invalid_metrics:
        raise ValueError(f"Invalid metric names: {invalid_metrics}")

    # Select metrics
    metrics = [metric_map[name] for name in metric_names]

    # Create dataset
    dataset = Dataset.from_dict(
        {
            "question": questions,
            "answer": answers,
            "contexts": contexts,
            "ground_truth": ground_truths,
        }
    )

    # Run evaluation
    result = ragas_evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=llm_model,  # type: ignore[arg-type]
        embeddings=embedding_model,  # type: ignore[arg-type]
    )

    # Return only requested metrics
    result_dict: dict[str, Any] = result  # type: ignore[assignment]
    return {name: float(result_dict[name]) for name in metric_names}
