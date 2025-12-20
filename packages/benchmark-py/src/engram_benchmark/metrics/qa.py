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
	for pred, truth, qtype, qid in zip(predictions, ground_truth, question_types, question_ids):
		if use_llm_eval:
			correct = await _llm_evaluate(pred, truth, llm_model)
		else:
			correct = _exact_match(pred, truth)

		results.append(
			EvaluatedResult(
				question_id=qid,
				hypothesis=pred,
				answer=truth,
				question_type=qtype,  # type: ignore
				memory_ability=qtype,
				correct=correct,
				reasoning=None,
			)
		)

	# Aggregate by ability
	return _aggregate_metrics(results)


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
	prompt = f"""You are evaluating a question-answering system.

Ground truth answer: {ground_truth}
System prediction: {prediction}

Is the prediction correct? Consider:
- Semantic equivalence (not just exact match)
- Paraphrases and synonyms
- Partial credit for multi-part answers

Respond with ONLY "yes" or "no"."""

	response = await acompletion(
		model=model,
		messages=[{"role": "user", "content": prompt}],
		max_tokens=10,
		temperature=0.0,
	)

	answer = response.choices[0].message.content.strip().lower()
	return answer == "yes"


def _aggregate_metrics(results: list[EvaluatedResult]) -> dict[str, AbilityMetrics]:
	"""
	Aggregate evaluation results by memory ability.

	Returns metrics for each ability plus "overall" aggregate.
	"""
	# Group by ability
	by_ability: dict[str, list[bool]] = defaultdict(list)
	all_results: list[bool] = []

	for result in results:
		ability = result.memory_ability
		correct = result.correct

		by_ability[ability].append(correct)
		all_results.append(correct)

	# Compute metrics for each ability
	metrics: dict[str, AbilityMetrics] = {}

	for ability, correctness in by_ability.items():
		total = len(correctness)
		correct = sum(correctness)
		accuracy = correct / total if total > 0 else 0.0

		metrics[ability] = AbilityMetrics(total=total, correct=correct, accuracy=accuracy)

	# Compute overall metrics
	total = len(all_results)
	correct = sum(all_results)
	accuracy = correct / total if total > 0 else 0.0

	metrics["overall"] = AbilityMetrics(total=total, correct=correct, accuracy=accuracy)

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
	for pred, truth, qtype, qid in zip(predictions, ground_truth, question_types, question_ids):
		correct = _exact_match(pred, truth)

		results.append(
			EvaluatedResult(
				question_id=qid,
				hypothesis=pred,
				answer=truth,
				question_type=qtype,  # type: ignore
				memory_ability=qtype,
				correct=correct,
				reasoning=None,
			)
		)

	return _aggregate_metrics(results)
