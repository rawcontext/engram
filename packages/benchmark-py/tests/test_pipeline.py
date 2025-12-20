"""Tests for benchmark pipeline."""

import pytest

from engram_benchmark.longmemeval.pipeline import PipelineConfig, PipelineResult
from engram_benchmark.longmemeval.reader import LongMemEvalReaderOutput
from engram_benchmark.longmemeval.retriever import RetrievalResult, RetrievedContext


def test_pipeline_config_defaults() -> None:
    """Test PipelineConfig default values."""
    config = PipelineConfig(dataset_path="data/test.json")

    assert config.dataset_path == "data/test.json"
    assert config.output_dir == "./results"
    assert config.limit is None
    assert config.concurrency == 5
    assert config.granularity == "turn"
    assert config.top_k == 10
    assert config.use_llm_eval is False
    assert config.llm_eval_model == "openai/gpt-4o"


def test_pipeline_config_custom_values() -> None:
    """Test PipelineConfig with custom values."""
    config = PipelineConfig(
        dataset_path="data/custom.json",
        output_dir="./custom_results",
        limit=50,
        concurrency=10,
        granularity="session",
        top_k=20,
        use_llm_eval=True,
        llm_eval_model="anthropic/claude-3-5-sonnet-20241022",
    )

    assert config.dataset_path == "data/custom.json"
    assert config.output_dir == "./custom_results"
    assert config.limit == 50
    assert config.concurrency == 10
    assert config.granularity == "session"
    assert config.top_k == 20
    assert config.use_llm_eval is True
    assert config.llm_eval_model == "anthropic/claude-3-5-sonnet-20241022"


def test_pipeline_config_validation() -> None:
    """Test PipelineConfig validation."""
    # Concurrency must be >= 1
    with pytest.raises(ValueError):
        PipelineConfig(dataset_path="data/test.json", concurrency=0)

    # Concurrency must be <= 50
    with pytest.raises(ValueError):
        PipelineConfig(dataset_path="data/test.json", concurrency=100)

    # Top-K must be >= 1
    with pytest.raises(ValueError):
        PipelineConfig(dataset_path="data/test.json", top_k=0)

    # Top-K must be <= 100
    with pytest.raises(ValueError):
        PipelineConfig(dataset_path="data/test.json", top_k=200)


def test_pipeline_result_creation() -> None:
    """Test PipelineResult creation."""
    retrieval = RetrievalResult(
        question_id="q1",
        contexts=[
            RetrievedContext(
                content="Test context",
                score=0.9,
                session_id="s1",
                turn_index=0,
                has_answer=True,
            )
        ],
        total_retrieved=1,
        turn_recall=1.0,
        session_recall=1.0,
    )

    reader_output = LongMemEvalReaderOutput(
        question_id="q1",
        answer="Test answer",
        reasoning="Test reasoning",
    )

    result = PipelineResult(
        question_id="q1",
        retrieval=retrieval,
        reader_output=reader_output,
        ground_truth="Test answer",
    )

    assert result.question_id == "q1"
    assert result.retrieval.total_retrieved == 1
    assert result.reader_output.answer == "Test answer"
    assert result.ground_truth == "Test answer"


@pytest.mark.skip(reason="Requires actual retriever and reader instances")
@pytest.mark.asyncio
async def test_benchmark_pipeline_run() -> None:
    """Test running the full benchmark pipeline."""
    # This would require setting up actual retriever and reader
    # Skipped for now as it's more of an integration test
    pass
