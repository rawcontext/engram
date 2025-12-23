"""
Extended tests for QA metrics.

Tests LLM evaluation, exact matching, and edge cases for QA accuracy metrics.
"""

from unittest.mock import AsyncMock, patch

import pytest

from engram_benchmark.longmemeval.types import MemoryAbility
from engram_benchmark.metrics.qa import (
    _aggregate_metrics,
    _exact_match,
    _llm_evaluate,
    _memory_ability_to_question_type,
    evaluate_qa,
    evaluate_qa_sync,
)


class TestExactMatch:
    """Test exact match functionality."""

    def test_exact_match_same(self) -> None:
        """Test exact match with identical strings."""
        assert _exact_match("Paris", "Paris")

    def test_exact_match_case_insensitive(self) -> None:
        """Test exact match is case-insensitive."""
        assert _exact_match("Paris", "paris")
        assert _exact_match("PARIS", "paris")

    def test_exact_match_whitespace(self) -> None:
        """Test exact match strips whitespace."""
        assert _exact_match("  Paris  ", "Paris")
        assert _exact_match("Paris\n", "Paris")

    def test_exact_match_punctuation(self) -> None:
        """Test exact match removes trailing punctuation."""
        assert _exact_match("Paris.", "Paris")
        assert _exact_match("Paris!", "Paris")
        assert _exact_match("Paris?", "Paris")
        assert _exact_match("Paris,", "Paris")
        assert _exact_match("Paris;", "Paris")
        assert _exact_match("Paris:", "Paris")

    def test_exact_match_different(self) -> None:
        """Test exact match with different strings."""
        assert not _exact_match("Paris", "London")
        assert not _exact_match("Paris", "Paris is nice")


class TestLLMEvaluate:
    """Test LLM-based evaluation."""

    @pytest.mark.asyncio
    async def test_llm_evaluate_correct(self) -> None:
        """Test LLM evaluation returns correct."""
        with patch("engram_benchmark.metrics.qa.acompletion") as mock_completion:
            # Mock LLM response
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = "yes"
            mock_completion.return_value = mock_response

            result = await _llm_evaluate(
                "The capital of France is Paris",
                "Paris",
                "openai/gpt-4o",
            )

            assert result is True
            mock_completion.assert_called_once()

    @pytest.mark.asyncio
    async def test_llm_evaluate_incorrect(self) -> None:
        """Test LLM evaluation returns incorrect."""
        with patch("engram_benchmark.metrics.qa.acompletion") as mock_completion:
            # Mock LLM response
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = "no"
            mock_completion.return_value = mock_response

            result = await _llm_evaluate(
                "The capital of France is London",
                "Paris",
                "openai/gpt-4o",
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_llm_evaluate_none_content(self) -> None:
        """Test LLM evaluation handles None content."""
        with patch("engram_benchmark.metrics.qa.acompletion") as mock_completion:
            # Mock LLM response with None content
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = None
            mock_completion.return_value = mock_response

            result = await _llm_evaluate(
                "Some answer",
                "Paris",
                "openai/gpt-4o",
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_llm_evaluate_unexpected_response(self) -> None:
        """Test LLM evaluation handles unexpected responses."""
        with patch("engram_benchmark.metrics.qa.acompletion") as mock_completion:
            # Mock LLM response with unexpected content
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = "maybe"
            mock_completion.return_value = mock_response

            result = await _llm_evaluate(
                "Some answer",
                "Paris",
                "openai/gpt-4o",
            )

            # "maybe" != "yes", so should return False
            assert result is False


class TestMemoryAbilityMapping:
    """Test memory ability to question type mapping."""

    def test_map_ie(self) -> None:
        """Test IE mapping."""
        from engram_benchmark.longmemeval.types import QuestionType

        result = _memory_ability_to_question_type("IE")
        assert result == QuestionType.SINGLE_SESSION_USER

    def test_map_mr(self) -> None:
        """Test MR mapping."""
        from engram_benchmark.longmemeval.types import QuestionType

        result = _memory_ability_to_question_type("MR")
        assert result == QuestionType.MULTI_SESSION

    def test_map_tr(self) -> None:
        """Test TR mapping."""
        from engram_benchmark.longmemeval.types import QuestionType

        result = _memory_ability_to_question_type("TR")
        assert result == QuestionType.TEMPORAL_REASONING

    def test_map_ku(self) -> None:
        """Test KU mapping."""
        from engram_benchmark.longmemeval.types import QuestionType

        result = _memory_ability_to_question_type("KU")
        assert result == QuestionType.KNOWLEDGE_UPDATE

    def test_map_abs(self) -> None:
        """Test ABS mapping."""
        from engram_benchmark.longmemeval.types import QuestionType

        result = _memory_ability_to_question_type("ABS")
        assert result == QuestionType.SINGLE_SESSION_USER


class TestAggregateMetrics:
    """Test metric aggregation."""

    def test_aggregate_single_ability(self) -> None:
        """Test aggregation with single ability."""
        from engram_benchmark.longmemeval.types import EvaluatedResult, QuestionType

        results = [
            EvaluatedResult(
                question_id="q1",
                hypothesis="Paris",
                answer="Paris",
                question_type=QuestionType.SINGLE_SESSION_USER,
                memory_ability="IE",
                correct=True,
                reasoning=None,
            ),
            EvaluatedResult(
                question_id="q2",
                hypothesis="London",
                answer="Paris",
                question_type=QuestionType.SINGLE_SESSION_USER,
                memory_ability="IE",
                correct=False,
                reasoning=None,
            ),
        ]

        metrics = _aggregate_metrics(results)

        assert "IE" in metrics
        assert metrics["IE"].total == 2
        assert metrics["IE"].correct == 1
        assert metrics["IE"].accuracy == 0.5

        assert "overall" in metrics
        assert metrics["overall"].total == 2
        assert metrics["overall"].correct == 1
        assert metrics["overall"].accuracy == 0.5

    def test_aggregate_multiple_abilities(self) -> None:
        """Test aggregation with multiple abilities."""
        from engram_benchmark.longmemeval.types import EvaluatedResult, QuestionType

        results = [
            EvaluatedResult(
                question_id="q1",
                hypothesis="Paris",
                answer="Paris",
                question_type=QuestionType.SINGLE_SESSION_USER,
                memory_ability="IE",
                correct=True,
                reasoning=None,
            ),
            EvaluatedResult(
                question_id="q2",
                hypothesis="42",
                answer="42",
                question_type=QuestionType.MULTI_SESSION,
                memory_ability="MR",
                correct=True,
                reasoning=None,
            ),
        ]

        metrics = _aggregate_metrics(results)

        assert "IE" in metrics
        assert metrics["IE"].accuracy == 1.0

        assert "MR" in metrics
        assert metrics["MR"].accuracy == 1.0

        assert "overall" in metrics
        assert metrics["overall"].accuracy == 1.0


class TestEvaluateQA:
    """Test QA evaluation."""

    @pytest.mark.asyncio
    async def test_evaluate_qa_exact_match(self) -> None:
        """Test QA evaluation with exact matching."""
        predictions = ["Paris", "London", "42"]
        ground_truth = ["Paris", "Paris", "42"]
        question_types: list[MemoryAbility] = ["IE", "IE", "MR"]
        question_ids = ["q1", "q2", "q3"]

        metrics = await evaluate_qa(
            predictions=predictions,
            ground_truth=ground_truth,
            question_types=question_types,
            question_ids=question_ids,
            use_llm_eval=False,
        )

        assert "overall" in metrics
        assert metrics["overall"].total == 3
        assert metrics["overall"].correct == 2
        assert metrics["overall"].accuracy == pytest.approx(2 / 3)

    @pytest.mark.asyncio
    async def test_evaluate_qa_with_llm(self) -> None:
        """Test QA evaluation with LLM evaluation."""
        with patch("engram_benchmark.metrics.qa._llm_evaluate") as mock_llm_eval:
            # Mock LLM to say all are correct
            mock_llm_eval.return_value = True

            predictions = ["The capital is Paris", "London", "Forty-two"]
            ground_truth = ["Paris", "Paris", "42"]
            question_types: list[MemoryAbility] = ["IE", "IE", "MR"]
            question_ids = ["q1", "q2", "q3"]

            metrics = await evaluate_qa(
                predictions=predictions,
                ground_truth=ground_truth,
                question_types=question_types,
                question_ids=question_ids,
                use_llm_eval=True,
                llm_model="openai/gpt-4o",
            )

            assert metrics["overall"].accuracy == 1.0
            assert mock_llm_eval.call_count == 3

    @pytest.mark.asyncio
    async def test_evaluate_qa_mismatched_lengths(self) -> None:
        """Test QA evaluation with mismatched input lengths."""
        with pytest.raises(ValueError, match="same length"):
            await evaluate_qa(
                predictions=["Paris"],
                ground_truth=["Paris", "London"],  # Different length
                question_types=["IE"],
                question_ids=["q1"],
            )

    @pytest.mark.asyncio
    async def test_evaluate_qa_empty_inputs(self) -> None:
        """Test QA evaluation with empty inputs."""
        metrics = await evaluate_qa(
            predictions=[],
            ground_truth=[],
            question_types=[],
            question_ids=[],
        )

        assert metrics["overall"].total == 0
        assert metrics["overall"].correct == 0
        assert metrics["overall"].accuracy == 0.0


class TestEvaluateQASync:
    """Test synchronous QA evaluation."""

    def test_evaluate_qa_sync(self) -> None:
        """Test synchronous QA evaluation."""
        predictions = ["Paris", "London", "42"]
        ground_truth = ["Paris", "Paris", "42"]
        question_types: list[MemoryAbility] = ["IE", "IE", "MR"]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(
            predictions=predictions,
            ground_truth=ground_truth,
            question_types=question_types,
            question_ids=question_ids,
        )

        assert "overall" in metrics
        assert metrics["overall"].total == 3
        assert metrics["overall"].correct == 2
        assert metrics["overall"].accuracy == pytest.approx(2 / 3)

    def test_evaluate_qa_sync_mismatched_lengths(self) -> None:
        """Test sync QA evaluation with mismatched lengths."""
        with pytest.raises(ValueError, match="same length"):
            evaluate_qa_sync(
                predictions=["Paris"],
                ground_truth=["Paris", "London"],
                question_types=["IE"],
                question_ids=["q1"],
            )

    def test_evaluate_qa_sync_all_correct(self) -> None:
        """Test sync QA evaluation with all correct answers."""
        predictions = ["Paris", "London", "42"]
        ground_truth = ["Paris", "London", "42"]
        question_types: list[MemoryAbility] = ["IE", "MR", "TR"]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(
            predictions=predictions,
            ground_truth=ground_truth,
            question_types=question_types,
            question_ids=question_ids,
        )

        assert metrics["overall"].accuracy == 1.0
        assert metrics["IE"].accuracy == 1.0
        assert metrics["MR"].accuracy == 1.0
        assert metrics["TR"].accuracy == 1.0

    def test_evaluate_qa_sync_all_incorrect(self) -> None:
        """Test sync QA evaluation with all incorrect answers."""
        predictions = ["London", "Paris", "24"]
        ground_truth = ["Paris", "London", "42"]
        question_types: list[MemoryAbility] = ["IE", "MR", "TR"]
        question_ids = ["q1", "q2", "q3"]

        metrics = evaluate_qa_sync(
            predictions=predictions,
            ground_truth=ground_truth,
            question_types=question_types,
            question_ids=question_ids,
        )

        assert metrics["overall"].accuracy == 0.0
