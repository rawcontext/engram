"""
QA accuracy metrics with optional LLM evaluation.

Implements QA correctness checking with:
- Exact string matching (normalized)
- LLM-based evaluation for complex answers
- Per-ability breakdown (IE, MR, TR, KU, ABS)
"""

from collections import defaultdict

from litellm import acompletion

from engram_benchmark.longmemeval.types import (
    AbilityMetrics,
    EvaluatedResult,
    MemoryAbility,
    QuestionType,
)


async def evaluate_qa(
    predictions: list[str],
    ground_truth: list[str],
    question_types: list[MemoryAbility],
    question_ids: list[str],
    use_llm_eval: bool = False,
    llm_model: str = "openai/gpt-4o",
) -> dict[str, AbilityMetrics]:
    """
    Evaluate QA accuracy with optional LLM-based evaluation.

    Args:
            predictions: List of predicted answers
            ground_truth: List of ground truth answers
            question_types: List of memory abilities for each question
            question_ids: List of question IDs
            use_llm_eval: Whether to use LLM for evaluation (default: False)
            llm_model: LLM model to use for evaluation (default: gpt-4o)

    Returns:
            Dictionary mapping memory ability to AbilityMetrics
            Includes "overall" key for aggregate metrics

    Example:
            ```python
            predictions = ["Paris", "42", "I don't know"]
            ground_truth = ["Paris", "42", "Cannot answer"]
            question_types = ["IE", "MR", "ABS"]
            question_ids = ["q1", "q2", "q3"]

            metrics = await evaluate_qa(
                    predictions, ground_truth, question_types, question_ids
            )
            print(f"Overall accuracy: {metrics['overall'].accuracy:.1%}")
            print(f"IE accuracy: {metrics['IE'].accuracy:.1%}")
            ```
    """
    if len(predictions) != len(ground_truth):
        raise ValueError("predictions and ground_truth must have same length")
    if len(predictions) != len(question_types):
        raise ValueError("predictions and question_types must have same length")
    if len(predictions) != len(question_ids):
        raise ValueError("predictions and question_ids must have same length")

    # Evaluate each prediction
    results: list[EvaluatedResult] = []

    if use_llm_eval:
        import asyncio

        # Use semaphore to limit concurrent LLM calls (avoid rate limits)
        semaphore = asyncio.Semaphore(3)

        async def evaluate_one(
            pred: str, truth: str, qtype: MemoryAbility, qid: str
        ) -> EvaluatedResult:
            async with semaphore:
                correct = await _llm_evaluate(pred, truth, llm_model)
                qtype_enum = _memory_ability_to_question_type(qtype)
                return EvaluatedResult(
                    question_id=qid,
                    hypothesis=pred,
                    answer=truth,
                    question_type=qtype_enum,
                    memory_ability=qtype,
                    correct=correct,
                    reasoning=None,
                )

        tasks = [
            evaluate_one(pred, truth, qtype, qid)
            for pred, truth, qtype, qid in zip(
                predictions, ground_truth, question_types, question_ids, strict=True
            )
        ]
        results = await asyncio.gather(*tasks)
    else:
        for pred, truth, qtype, qid in zip(
            predictions, ground_truth, question_types, question_ids, strict=True
        ):
            correct = _exact_match(pred, truth)

            # Map MemoryAbility to QuestionType
            qtype_enum = _memory_ability_to_question_type(qtype)

            results.append(
                EvaluatedResult(
                    question_id=qid,
                    hypothesis=pred,
                    answer=truth,
                    question_type=qtype_enum,
                    memory_ability=qtype,
                    correct=correct,
                    reasoning=None,
                )
            )

    # Aggregate by ability
    return _aggregate_metrics(results)


def _memory_ability_to_question_type(ability: MemoryAbility) -> QuestionType:
    """
    Map MemoryAbility to a representative QuestionType.

    Note: ABS (Abstention) is a cross-cutting ability that can apply to any
    underlying question type. It's identified by the _abs suffix on question_id,
    not by a distinct QuestionType in the dataset schema. We map it to
    SINGLE_SESSION_USER as most abstention questions in LongMemEval are based
    on single-session IE scenarios. The actual abstention evaluation is handled
    separately via AbstentionMetrics, not through question_type classification.
    """
    ability_map: dict[str, QuestionType] = {
        "IE": QuestionType.SINGLE_SESSION_USER,
        "MR": QuestionType.MULTI_SESSION,
        "TR": QuestionType.TEMPORAL_REASONING,
        "KU": QuestionType.KNOWLEDGE_UPDATE,
        "ABS": QuestionType.SINGLE_SESSION_USER,
    }
    return ability_map[ability]


def _exact_match(prediction: str, ground_truth: str) -> bool:
    """
    Check if prediction matches ground truth (normalized).

    Normalization:
    - Convert to lowercase
    - Strip whitespace
    - Remove common punctuation
    """

    def normalize(text: str) -> str:
        return text.lower().strip().rstrip(".!?,;:")

    return normalize(prediction) == normalize(ground_truth)


async def _llm_evaluate(prediction: str, ground_truth: str, model: str) -> bool:
    """
    Use LLM to evaluate if prediction is correct.

    This is useful for:
    - Paraphrased answers
    - Multi-part answers
    - Complex reasoning
    """
    import asyncio

    prompt = f"""You are evaluating a question-answering system.

Ground truth answer: {ground_truth}
System prediction: {prediction}

Is the prediction correct? Consider:
- Semantic equivalence (not just exact match)
- Paraphrases and synonyms
- Partial credit for multi-part answers

Respond with ONLY "yes" or "no"."""

    max_retries = 5
    base_delay = 1.0

    for attempt in range(max_retries):
        try:
            response = await acompletion(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=10,
                temperature=0.0,
            )

            content = response.choices[0].message.content
            if content is None:
                return False
            answer: str = str(content).strip().lower()
            result: bool = answer == "yes"
            return result
        except Exception as e:
            if "429" in str(e) or "rate" in str(e).lower() or "quota" in str(e).lower():
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
            raise

    return False  # Fallback if all retries fail


def _aggregate_metrics(results: list[EvaluatedResult]) -> dict[str, AbilityMetrics]:
    """
    Aggregate evaluation results by memory ability.

    Returns metrics for each ability plus "overall" aggregate.
    """
    # Group by ability
    by_ability: dict[str, list[bool]] = defaultdict(list)
    all_results: list[bool] = []

    for result in results:
        # memory_ability is a MemoryAbility (Literal type), treat as str for dict key
        ability: str = str(result.memory_ability)
        correct = result.correct

        by_ability[ability].append(correct)
        all_results.append(correct)

    # Compute metrics for each ability
    metrics: dict[str, AbilityMetrics] = {}

    for ability, correctness in by_ability.items():
        total_count = len(correctness)
        correct_count = sum(1 for c in correctness if c)
        accuracy = correct_count / total_count if total_count > 0 else 0.0

        metrics[ability] = AbilityMetrics(
            total=total_count, correct=correct_count, accuracy=accuracy
        )

    # Compute overall metrics
    total_count = len(all_results)
    correct_count = sum(1 for c in all_results if c)
    accuracy = correct_count / total_count if total_count > 0 else 0.0

    metrics["overall"] = AbilityMetrics(total=total_count, correct=correct_count, accuracy=accuracy)

    return metrics


def evaluate_qa_sync(
    predictions: list[str],
    ground_truth: list[str],
    question_types: list[MemoryAbility],
    question_ids: list[str],
) -> dict[str, AbilityMetrics]:
    """
    Synchronous version of evaluate_qa (no LLM evaluation).

    This is a convenience function for simple exact-match evaluation.

    Args:
            predictions: List of predicted answers
            ground_truth: List of ground truth answers
            question_types: List of memory abilities for each question
            question_ids: List of question IDs

    Returns:
            Dictionary mapping memory ability to AbilityMetrics
    """
    if len(predictions) != len(ground_truth):
        raise ValueError("predictions and ground_truth must have same length")
    if len(predictions) != len(question_types):
        raise ValueError("predictions and question_types must have same length")
    if len(predictions) != len(question_ids):
        raise ValueError("predictions and question_ids must have same length")

    results: list[EvaluatedResult] = []
    for pred, truth, qtype, qid in zip(
        predictions, ground_truth, question_types, question_ids, strict=True
    ):
        correct = _exact_match(pred, truth)

        # Map MemoryAbility to QuestionType
        qtype_enum = _memory_ability_to_question_type(qtype)

        results.append(
            EvaluatedResult(
                question_id=qid,
                hypothesis=pred,
                answer=truth,
                question_type=qtype_enum,
                memory_ability=qtype,
                correct=correct,
                reasoning=None,
            )
        )

    return _aggregate_metrics(results)
