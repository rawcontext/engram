"""Tests for benchmark reporting."""

from datetime import datetime

import pytest

from engram_benchmark.longmemeval.types import (
    AbilityMetrics,
    AbstentionMetrics,
    EvaluationMetrics,
    RetrievalMetrics,
)
from engram_benchmark.utils.reporting import (
    BenchmarkReport,
    generate_json_report,
    generate_markdown_report,
)


@pytest.fixture
def sample_metrics() -> EvaluationMetrics:
    """Create sample evaluation metrics."""
    return EvaluationMetrics(
        overall=AbilityMetrics(total=100, correct=75, accuracy=0.75),
        by_ability={
            "IE": AbilityMetrics(total=30, correct=25, accuracy=0.833),
            "MR": AbilityMetrics(total=25, correct=20, accuracy=0.80),
            "TR": AbilityMetrics(total=20, correct=15, accuracy=0.75),
            "KU": AbilityMetrics(total=15, correct=10, accuracy=0.667),
            "ABS": AbilityMetrics(total=10, correct=5, accuracy=0.50),
        },
        retrieval=RetrievalMetrics(
            turn_recall=0.85,
            session_recall=0.90,
            recall_at_k={1: 0.5, 5: 0.8, 10: 0.9},
            ndcg_at_k={1: 0.6, 5: 0.75, 10: 0.82},
            mrr=0.72,
        ),
        abstention=AbstentionMetrics(
            true_positives=8,
            false_positives=2,
            false_negatives=3,
            true_negatives=87,
            precision=0.80,
            recall=0.727,
            f1=0.762,
        ),
    )


@pytest.fixture
def sample_report(sample_metrics: EvaluationMetrics) -> BenchmarkReport:
    """Create a sample benchmark report."""
    return BenchmarkReport(
        timestamp=datetime(2024, 1, 15, 12, 0, 0),
        dataset_path="data/longmemeval_oracle.json",
        total_instances=100,
        model_name="openai/gpt-4o-mini",
        embedding_model="BAAI/bge-base-en-v1.5",
        reranker_model="colbert-v2",
        retrieval_strategy="hybrid",
        metrics=sample_metrics,
    )


def test_benchmark_report_creation(sample_report: BenchmarkReport) -> None:
    """Test BenchmarkReport creation."""
    assert sample_report.total_instances == 100
    assert sample_report.model_name == "openai/gpt-4o-mini"
    assert sample_report.metrics.overall.accuracy == 0.75


def test_generate_markdown_report(
    sample_report: BenchmarkReport, tmp_path: pytest.TempPathFactory
) -> None:  # type: ignore
    """Test Markdown report generation."""
    output_path = tmp_path / "report.md"  # type: ignore
    markdown = generate_markdown_report(sample_report, output_path)

    # Check content
    assert "# LongMemEval Benchmark Report" in markdown
    assert "Overall Performance" in markdown
    assert "Performance by Memory Ability" in markdown
    assert "Retrieval Metrics" in markdown
    assert "Abstention Metrics" in markdown
    assert "75.0%" in markdown  # Overall accuracy

    # Check file was created
    assert output_path.exists()  # type: ignore
    content = output_path.read_text()  # type: ignore
    assert content == markdown


def test_generate_json_report(
    sample_report: BenchmarkReport, tmp_path: pytest.TempPathFactory
) -> None:  # type: ignore
    """Test JSON report generation."""
    import json

    output_path = tmp_path / "report.json"  # type: ignore
    json_str = generate_json_report(sample_report, output_path)

    # Parse and verify
    data = json.loads(json_str)
    assert data["total_instances"] == 100
    assert data["model_name"] == "openai/gpt-4o-mini"
    assert data["metrics"]["overall"]["accuracy"] == 0.75
    assert data["metrics"]["retrieval"]["mrr"] == 0.72

    # Check file was created
    assert output_path.exists()  # type: ignore
    content = output_path.read_text()  # type: ignore
    assert json.loads(content) == data


def test_markdown_report_sections(sample_report: BenchmarkReport) -> None:
    """Test that all required sections are in the Markdown report."""
    markdown = generate_markdown_report(sample_report)

    # Check sections
    assert "## Configuration" in markdown
    assert "## Overall Performance" in markdown
    assert "## Performance by Memory Ability" in markdown
    assert "## Retrieval Metrics" in markdown
    assert "## Abstention Metrics" in markdown

    # Check ability names are expanded
    assert "Information Extraction" in markdown
    assert "Multi-Session Reasoning" in markdown
    assert "Temporal Reasoning" in markdown
    assert "Knowledge Update" in markdown
    assert "Abstention" in markdown


def test_markdown_retrieval_tables(sample_report: BenchmarkReport) -> None:
    """Test retrieval metrics tables in Markdown."""
    markdown = generate_markdown_report(sample_report)

    # Check Recall@K table
    assert "### Recall@K" in markdown
    assert "| K | Recall |" in markdown
    assert "| 1 | 50.0% |" in markdown
    assert "| 5 | 80.0% |" in markdown
    assert "| 10 | 90.0% |" in markdown

    # Check NDCG@K table
    assert "### NDCG@K" in markdown
    assert "| K | NDCG |" in markdown


def test_markdown_abstention_confusion_matrix(sample_report: BenchmarkReport) -> None:
    """Test abstention confusion matrix in Markdown."""
    markdown = generate_markdown_report(sample_report)

    assert "### Confusion Matrix" in markdown
    assert "8 (TP)" in markdown  # True positives
    assert "2 (FP)" in markdown  # False positives
    assert "3 (FN)" in markdown  # False negatives
    assert "87 (TN)" in markdown  # True negatives
