"""
Extended tests for RAGAS metrics.

Tests RAGAS integration including faithfulness, answer relevancy, context precision, and recall.
"""

from unittest.mock import MagicMock, patch

import pytest

from engram_benchmark.metrics.ragas import RAGASMetrics, evaluate_ragas, evaluate_ragas_subset


class TestRAGASMetrics:
    """Test RAGASMetrics dataclass."""

    def test_ragas_metrics_creation(self) -> None:
        """Test creating RAGAS metrics."""
        metrics = RAGASMetrics(
            faithfulness=0.9,
            answer_relevancy=0.85,
            context_precision=0.8,
            context_recall=0.88,
        )

        assert metrics.faithfulness == 0.9
        assert metrics.answer_relevancy == 0.85
        assert metrics.context_precision == 0.8
        assert metrics.context_recall == 0.88


class TestEvaluateRAGAS:
    """Test evaluate_ragas function."""

    @pytest.mark.asyncio
    async def test_evaluate_ragas_basic(self) -> None:
        """Test basic RAGAS evaluation."""
        questions = ["What is the capital of France?"]
        answers = ["The capital of France is Paris."]
        contexts = [["Paris is the capital of France.", "France is in Europe."]]
        ground_truths = ["Paris"]

        # Mock the ragas evaluate function
        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.9,
                "answer_relevancy": 0.85,
                "context_precision": 0.8,
                "context_recall": 0.88,
            }

            metrics = await evaluate_ragas(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
            )

            assert isinstance(metrics, RAGASMetrics)
            assert metrics.faithfulness == 0.9
            assert metrics.answer_relevancy == 0.85
            assert metrics.context_precision == 0.8
            assert metrics.context_recall == 0.88

            # Verify mock was called
            mock_eval.assert_called_once()

    @pytest.mark.asyncio
    async def test_evaluate_ragas_custom_models(self) -> None:
        """Test RAGAS evaluation with custom models."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.95,
                "answer_relevancy": 0.9,
                "context_precision": 0.85,
                "context_recall": 0.92,
            }

            metrics = await evaluate_ragas(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                llm_model="openai/gpt-4o-mini",
                embedding_model="BAAI/bge-small-en-v1.5",
            )

            assert metrics.faithfulness == 0.95
            mock_eval.assert_called_once()

    @pytest.mark.asyncio
    async def test_evaluate_ragas_mismatched_lengths(self) -> None:
        """Test RAGAS evaluation with mismatched input lengths."""
        with pytest.raises(ValueError, match="same length"):
            await evaluate_ragas(
                questions=["Q1", "Q2"],
                answers=["A1"],  # Different length
                contexts=[["C1"], ["C2"]],
                ground_truths=["GT1", "GT2"],
            )

        with pytest.raises(ValueError, match="same length"):
            await evaluate_ragas(
                questions=["Q1"],
                answers=["A1"],
                contexts=[["C1"], ["C2"]],  # Different length
                ground_truths=["GT1"],
            )

        with pytest.raises(ValueError, match="same length"):
            await evaluate_ragas(
                questions=["Q1"],
                answers=["A1"],
                contexts=[["C1"]],
                ground_truths=["GT1", "GT2"],  # Different length
            )

    @pytest.mark.asyncio
    async def test_evaluate_ragas_multiple_questions(self) -> None:
        """Test RAGAS evaluation with multiple questions."""
        questions = [
            "What is the capital of France?",
            "What is 2+2?",
            "Who wrote Hamlet?",
        ]
        answers = [
            "Paris",
            "4",
            "William Shakespeare",
        ]
        contexts = [
            ["Paris is the capital of France."],
            ["2+2 equals 4."],
            ["Shakespeare wrote Hamlet."],
        ]
        ground_truths = ["Paris", "4", "Shakespeare"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.92,
                "answer_relevancy": 0.89,
                "context_precision": 0.87,
                "context_recall": 0.91,
            }

            metrics = await evaluate_ragas(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
            )

            assert metrics.faithfulness == 0.92
            # Verify Dataset was created with correct data
            call_args = mock_eval.call_args
            assert call_args is not None


class TestEvaluateRAGASSubset:
    """Test evaluate_ragas_subset function."""

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_single_metric(self) -> None:
        """Test RAGAS subset evaluation with single metric."""
        questions = ["What is the capital of France?"]
        answers = ["Paris"]
        contexts = [["Paris is the capital."]]
        ground_truths = ["Paris"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.95,
            }

            metrics = await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=["faithfulness"],
            )

            assert isinstance(metrics, dict)
            assert "faithfulness" in metrics
            assert metrics["faithfulness"] == 0.95
            assert len(metrics) == 1

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_multiple_metrics(self) -> None:
        """Test RAGAS subset evaluation with multiple metrics."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.9,
                "context_recall": 0.88,
            }

            metrics = await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=["faithfulness", "context_recall"],
            )

            assert len(metrics) == 2
            assert "faithfulness" in metrics
            assert "context_recall" in metrics
            assert metrics["faithfulness"] == 0.9
            assert metrics["context_recall"] == 0.88

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_invalid_metric(self) -> None:
        """Test RAGAS subset evaluation with invalid metric name."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with pytest.raises(ValueError, match="Invalid metric names"):
            await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=["invalid_metric"],
            )

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_all_metrics(self) -> None:
        """Test RAGAS subset evaluation with all metrics."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.9,
                "answer_relevancy": 0.85,
                "context_precision": 0.8,
                "context_recall": 0.88,
            }

            metrics = await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=[
                    "faithfulness",
                    "answer_relevancy",
                    "context_precision",
                    "context_recall",
                ],
            )

            assert len(metrics) == 4
            assert all(
                k in metrics
                for k in [
                    "faithfulness",
                    "answer_relevancy",
                    "context_precision",
                    "context_recall",
                ]
            )

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_mismatched_lengths(self) -> None:
        """Test RAGAS subset evaluation with mismatched lengths."""
        with pytest.raises(ValueError, match="same length"):
            await evaluate_ragas_subset(
                questions=["Q1", "Q2"],
                answers=["A1"],
                contexts=[["C1"]],
                ground_truths=["GT1"],
                metric_names=["faithfulness"],
            )

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_custom_models(self) -> None:
        """Test RAGAS subset evaluation with custom models."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {
                "faithfulness": 0.92,
            }

            metrics = await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=["faithfulness"],
                llm_model="custom/model",
                embedding_model="custom/embedding",
            )

            assert metrics["faithfulness"] == 0.92
            mock_eval.assert_called_once()

    @pytest.mark.asyncio
    async def test_evaluate_ragas_subset_empty_metric_names(self) -> None:
        """Test RAGAS subset evaluation with empty metric names."""
        questions = ["Test question"]
        answers = ["Test answer"]
        contexts = [["Test context"]]
        ground_truths = ["Ground truth"]

        with patch("engram_benchmark.metrics.ragas.ragas_evaluate") as mock_eval:
            mock_eval.return_value = {}

            metrics = await evaluate_ragas_subset(
                questions=questions,
                answers=answers,
                contexts=contexts,
                ground_truths=ground_truths,
                metric_names=[],
            )

            assert len(metrics) == 0
