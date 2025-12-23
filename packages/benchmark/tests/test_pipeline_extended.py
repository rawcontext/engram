"""
Extended tests for pipeline orchestration.

Tests the full BenchmarkPipeline with mocked components to improve coverage.
"""

from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from engram_benchmark.longmemeval.pipeline import (
    BenchmarkPipeline,
    IndexableRetriever,
    PipelineConfig,
    PipelineResult,
    run_benchmark,
)
from engram_benchmark.longmemeval.reader import LongMemEvalReader, LongMemEvalReaderOutput
from engram_benchmark.longmemeval.retriever import BaseRetriever, RetrievalResult, RetrievedContext
from engram_benchmark.longmemeval.types import (
    AbilityMetrics,
    AbstentionMetrics,
    ParsedInstance,
    ParsedSession,
    ParsedTurn,
    QuestionType,
    RetrievalMetrics,
)


@pytest.fixture
def sample_parsed_instance() -> ParsedInstance:
    """Create a sample parsed instance."""
    return ParsedInstance(
        question_id="test_001",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="IE",
        question="What is the capital of France?",
        answer="Paris",
        question_date=datetime(2023, 4, 10, 23, 7),
        sessions=[
            ParsedSession(
                session_id="session_001",
                timestamp=datetime(2023, 4, 10, 17, 50),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="I love Paris.",
                        has_answer=True,
                        sequence_index=0,
                    ),
                ],
            )
        ],
        answer_session_ids=["session_001"],
        is_abstention=False,
    )


@pytest.fixture
def sample_abstention_instance() -> ParsedInstance:
    """Create a sample abstention instance."""
    return ParsedInstance(
        question_id="test_002_abs",
        question_type=QuestionType.SINGLE_SESSION_USER,
        memory_ability="ABS",
        question="What did I never tell you?",
        answer="ABSTAIN",
        question_date=datetime(2023, 4, 10, 23, 7),
        sessions=[
            ParsedSession(
                session_id="session_001",
                timestamp=datetime(2023, 4, 10, 17, 50),
                turns=[
                    ParsedTurn(
                        role="user",
                        content="Hello!",
                        has_answer=False,
                        sequence_index=0,
                    ),
                ],
            )
        ],
        answer_session_ids=[],
        is_abstention=True,
    )


@pytest.fixture
def mock_retriever() -> MagicMock:
    """Mock BaseRetriever."""
    retriever = MagicMock(spec=BaseRetriever)
    retriever.retrieve = AsyncMock(
        return_value=RetrievalResult(
            question_id="test_001",
            contexts=[
                RetrievedContext(
                    content="Paris is the capital of France.",
                    session_id="session_001",
                    turn_index=0,
                    score=0.95,
                    has_answer=True,
                )
            ],
            total_retrieved=1,
            turn_recall=1.0,
            session_recall=1.0,
        )
    )
    return retriever


@pytest.fixture
def mock_indexable_retriever(mock_retriever: MagicMock) -> MagicMock:
    """Mock IndexableRetriever with index_instance method."""
    # Add index_instance method to make it indexable
    mock_retriever.index_instance = AsyncMock()
    return mock_retriever


@pytest.fixture
def mock_reader() -> MagicMock:
    """Mock LongMemEvalReader."""
    reader = MagicMock(spec=LongMemEvalReader)
    reader.generate_answer = AsyncMock(
        return_value=LongMemEvalReaderOutput(
            question_id="test_001",
            answer="Paris",
            reasoning="Based on the context, Paris is the capital.",
            is_abstention=False,
            abstention_confidence=0.1,
            contexts_used=["Paris is the capital of France."],
        )
    )
    return reader


@pytest.fixture
def pipeline_config(tmp_path: Path) -> PipelineConfig:
    """Create a test pipeline configuration."""
    dataset_path = tmp_path / "test_dataset.json"
    output_dir = tmp_path / "results"

    # Create a minimal dataset file
    import json

    with open(dataset_path, "w", encoding="utf-8") as f:
        json.dump(
            [
                {
                    "question_id": "test_001",
                    "question_type": "single-session-user",
                    "question": "What is the capital of France?",
                    "answer": "Paris",
                    "question_date": "2023/04/10 23:07",
                    "haystack_dates": ["2023/04/10 17:50"],
                    "haystack_session_ids": ["session_001"],
                    "haystack_sessions": [
                        [
                            {
                                "role": "user",
                                "content": "I love Paris.",
                                "has_answer": True,
                            }
                        ]
                    ],
                    "answer_session_ids": ["session_001"],
                }
            ],
            f,
        )

    return PipelineConfig(
        dataset_path=str(dataset_path),
        output_dir=str(output_dir),
        limit=1,
        concurrency=1,
        granularity="turn",
        top_k=10,
        use_llm_eval=False,
        ragas_enabled=False,
    )


class TestPipelineConfig:
    """Test PipelineConfig validation."""

    def test_valid_config(self, tmp_path: Path) -> None:
        """Test valid configuration."""
        config = PipelineConfig(
            dataset_path="data/test.json",
            output_dir=str(tmp_path),
            limit=10,
            concurrency=5,
        )
        assert config.limit == 10
        assert config.concurrency == 5

    def test_invalid_concurrency(self) -> None:
        """Test invalid concurrency values."""
        with pytest.raises(ValueError):
            PipelineConfig(
                dataset_path="data/test.json",
                concurrency=0,  # Too low
            )

        with pytest.raises(ValueError):
            PipelineConfig(
                dataset_path="data/test.json",
                concurrency=100,  # Too high
            )

    def test_invalid_limit(self) -> None:
        """Test invalid limit values."""
        with pytest.raises(ValueError):
            PipelineConfig(
                dataset_path="data/test.json",
                limit=0,  # Too low
            )


class TestPipelineResult:
    """Test PipelineResult model."""

    def test_valid_result(self, sample_parsed_instance: ParsedInstance) -> None:
        """Test valid pipeline result."""
        result = PipelineResult(
            question_id="test_001",
            retrieval=RetrievalResult(
                question_id="test_001",
                contexts=[],
                total_retrieved=0,
                turn_recall=1.0,
                session_recall=1.0,
            ),
            reader_output=LongMemEvalReaderOutput(
                question_id="test_001",
                answer="Paris",
            ),
            ground_truth="Paris",
            retrieval_latency_ms=50.5,
            reader_latency_ms=100.2,
        )
        assert result.question_id == "test_001"
        assert result.retrieval_latency_ms == 50.5


class TestBenchmarkPipeline:
    """Test BenchmarkPipeline orchestration."""

    @pytest.mark.asyncio
    async def test_pipeline_initialization(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
    ) -> None:
        """Test pipeline initialization."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)

        assert pipeline.config == pipeline_config
        assert pipeline.retriever == mock_retriever
        assert pipeline.reader == mock_reader
        assert len(pipeline.dataset) == 0
        assert len(pipeline.parsed_instances) == 0
        assert len(pipeline.results) == 0

    @pytest.mark.asyncio
    async def test_load_dataset(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
    ) -> None:
        """Test dataset loading stage."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        dataset = await pipeline._load_dataset()

        assert len(dataset) == 1
        assert dataset[0].question_id == "test_001"

    @pytest.mark.asyncio
    async def test_map_instances(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
    ) -> None:
        """Test instance mapping stage."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        pipeline.dataset = await pipeline._load_dataset()

        parsed = await pipeline._map_instances()

        assert len(parsed) == 1
        assert parsed[0].question_id == "test_001"
        assert parsed[0].question == "What is the capital of France?"

    @pytest.mark.asyncio
    async def test_index_documents_with_indexable_retriever(
        self,
        pipeline_config: PipelineConfig,
        mock_indexable_retriever: MagicMock,
        mock_reader: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test document indexing with IndexableRetriever."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_indexable_retriever, mock_reader)
        pipeline.parsed_instances = [sample_parsed_instance]

        await pipeline._index_documents()

        # Verify index_instance was called
        mock_indexable_retriever.index_instance.assert_called_once_with(sample_parsed_instance)

    @pytest.mark.asyncio
    async def test_index_documents_with_non_indexable_retriever(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test document indexing skips non-indexable retriever."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        pipeline.parsed_instances = [sample_parsed_instance]

        # Should not raise, just skip indexing
        await pipeline._index_documents()

        # Verify no index_instance call was attempted
        assert not hasattr(mock_retriever, "index_instance") or not mock_retriever.index_instance.called

    @pytest.mark.asyncio
    async def test_retrieve_and_read(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
        sample_parsed_instance: ParsedInstance,
    ) -> None:
        """Test retrieve and read stage."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        pipeline.parsed_instances = [sample_parsed_instance]

        results = await pipeline._retrieve_and_read()

        assert len(results) == 1
        assert results[0].question_id == "test_001"
        assert results[0].retrieval_latency_ms >= 0
        assert results[0].reader_latency_ms >= 0

        # Verify calls
        mock_retriever.retrieve.assert_called_once()
        mock_reader.generate_answer.assert_called_once()

    @pytest.mark.asyncio
    async def test_full_pipeline_run(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
    ) -> None:
        """Test full pipeline execution."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)

        with patch(
            "engram_benchmark.longmemeval.pipeline.compute_retrieval_metrics"
        ) as mock_retrieval_metrics, patch(
            "engram_benchmark.longmemeval.pipeline.evaluate_qa"
        ) as mock_qa_eval, patch(
            "engram_benchmark.longmemeval.pipeline.compute_abstention_metrics"
        ) as mock_abstention:
            # Setup mock returns
            mock_qa_eval.return_value = {
                "overall": AbilityMetrics(total=1, correct=1, accuracy=1.0),
                "IE": AbilityMetrics(total=1, correct=1, accuracy=1.0),
            }
            mock_retrieval_metrics.return_value = RetrievalMetrics(
                turn_recall=1.0,
                session_recall=1.0,
                recall_at_k={1: 1.0, 5: 1.0, 10: 1.0},
                ndcg_at_k={1: 1.0, 5: 1.0, 10: 1.0},
                mrr=1.0,
                map=1.0,
            )
            mock_abstention.return_value = None

            report = await pipeline.run()

            # Verify report structure
            assert report.total_instances == 1
            assert report.dataset_path == pipeline_config.dataset_path
            assert report.metrics.overall.accuracy == 1.0

            # Verify all stages ran
            assert len(pipeline.dataset) == 1
            assert len(pipeline.parsed_instances) == 1
            assert len(pipeline.results) == 1

    @pytest.mark.asyncio
    async def test_pipeline_with_abstention_metrics(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
        sample_abstention_instance: ParsedInstance,
    ) -> None:
        """Test pipeline computes abstention metrics when needed."""
        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        pipeline.dataset = await pipeline._load_dataset()
        pipeline.parsed_instances = [sample_abstention_instance]

        # Mock reader to return abstention
        mock_reader.generate_answer.return_value = LongMemEvalReaderOutput(
            question_id="test_002_abs",
            answer="I don't know",
            is_abstention=True,
            abstention_confidence=0.9,
        )

        # Mock retriever
        mock_retriever.retrieve.return_value = RetrievalResult(
            question_id="test_002_abs",
            contexts=[],
            total_retrieved=0,
            turn_recall=0.0,
            session_recall=0.0,
        )

        with patch(
            "engram_benchmark.longmemeval.pipeline.evaluate_qa"
        ) as mock_qa_eval, patch(
            "engram_benchmark.longmemeval.pipeline.compute_retrieval_metrics"
        ) as mock_retrieval_metrics, patch(
            "engram_benchmark.longmemeval.pipeline.compute_abstention_metrics"
        ) as mock_abstention:
            # Setup mocks
            mock_qa_eval.return_value = {
                "overall": AbilityMetrics(total=1, correct=1, accuracy=1.0),
                "ABS": AbilityMetrics(total=1, correct=1, accuracy=1.0),
            }
            mock_retrieval_metrics.return_value = RetrievalMetrics(
                turn_recall=0.0,
                session_recall=0.0,
                recall_at_k={1: 0.0, 5: 0.0, 10: 0.0},
                ndcg_at_k={1: 0.0, 5: 0.0, 10: 0.0},
                mrr=0.0,
                map=0.0,
            )
            mock_abstention.return_value = AbstentionMetrics(
                true_positives=1,
                false_positives=0,
                false_negatives=0,
                true_negatives=0,
                precision=1.0,
                recall=1.0,
                f1=1.0,
            )

            results = await pipeline._retrieve_and_read()
            await pipeline._evaluate()

            # Verify abstention metrics were computed
            mock_abstention.assert_called_once()

    @pytest.mark.asyncio
    async def test_pipeline_with_ragas_enabled(
        self,
        pipeline_config: PipelineConfig,
        mock_retriever: MagicMock,
        mock_reader: MagicMock,
    ) -> None:
        """Test pipeline with RAGAS metrics enabled."""
        # Enable RAGAS in config
        pipeline_config.ragas_enabled = True
        pipeline_config.ragas_llm_model = "openai/gpt-4o"
        pipeline_config.ragas_embedding_model = "BAAI/bge-base-en-v1.5"

        pipeline = BenchmarkPipeline(pipeline_config, mock_retriever, mock_reader)
        pipeline.dataset = await pipeline._load_dataset()
        pipeline.parsed_instances = await pipeline._map_instances()

        with patch(
            "engram_benchmark.longmemeval.pipeline.evaluate_qa"
        ) as mock_qa_eval, patch(
            "engram_benchmark.longmemeval.pipeline.compute_retrieval_metrics"
        ) as mock_retrieval_metrics, patch(
            "engram_benchmark.metrics.ragas.evaluate_ragas"
        ) as mock_ragas:
            # Setup mocks
            mock_qa_eval.return_value = {
                "overall": AbilityMetrics(total=1, correct=1, accuracy=1.0)
            }
            mock_retrieval_metrics.return_value = RetrievalMetrics(
                turn_recall=1.0,
                session_recall=1.0,
                recall_at_k={1: 1.0, 5: 1.0, 10: 1.0},
                ndcg_at_k={1: 1.0, 5: 1.0, 10: 1.0},
                mrr=1.0,
                map=1.0,
            )
            mock_ragas.return_value = MagicMock(
                faithfulness=0.9,
                answer_relevancy=0.85,
                context_precision=0.8,
                context_recall=0.88,
            )

            results = await pipeline._retrieve_and_read()
            await pipeline._evaluate()

            # Verify RAGAS evaluation was called
            mock_ragas.assert_called_once()


@pytest.mark.asyncio
async def test_run_benchmark_convenience_function(
    pipeline_config: PipelineConfig,
    mock_retriever: MagicMock,
    mock_reader: MagicMock,
) -> None:
    """Test run_benchmark convenience function."""
    with patch(
        "engram_benchmark.longmemeval.pipeline.BenchmarkPipeline.run"
    ) as mock_run:
        mock_run.return_value = MagicMock()

        await run_benchmark(pipeline_config, mock_retriever, mock_reader)

        mock_run.assert_called_once()
