"""
Benchmark pipeline orchestration for LongMemEval evaluation.

Provides end-to-end pipeline for running LongMemEval benchmarks:
1. Load dataset
2. Map instances to documents
3. Index documents in vector store
4. Retrieve relevant contexts
5. Generate answers with reader
6. Evaluate results

Supports async execution with configurable concurrency and progress tracking.
"""

import asyncio
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from engram_benchmark.longmemeval.loader import load_dataset
from engram_benchmark.longmemeval.mapper import DocumentMapper, parse_batch
from engram_benchmark.longmemeval.reader import LongMemEvalReader, LongMemEvalReaderOutput
from engram_benchmark.longmemeval.retriever import BaseRetriever, RetrievalResult
from engram_benchmark.longmemeval.types import (
    EvaluationMetrics,
    LongMemEvalDataset,
    ParsedInstance,
)
from engram_benchmark.metrics.abstention import compute_abstention_metrics
from engram_benchmark.metrics.qa import evaluate_qa
from engram_benchmark.metrics.retrieval import compute_retrieval_metrics
from engram_benchmark.utils.progress import ProgressTracker
from engram_benchmark.utils.reporting import (
    BenchmarkReport,
    generate_json_report,
    generate_markdown_report,
)


@runtime_checkable
class IndexableRetriever(Protocol):
    """Protocol for retrievers that support indexing."""

    async def index_instance(self, instance: ParsedInstance) -> None:
        """Index a single instance."""
        ...


class PipelineConfig(BaseModel):
    """Configuration for benchmark pipeline."""

    dataset_path: str
    output_dir: str = Field(default="./results")
    limit: int | None = Field(default=None, ge=1)
    concurrency: int = Field(default=5, ge=1, le=50)
    granularity: Literal["turn", "session"] = Field(default="turn")
    top_k: int = Field(default=10, ge=1, le=100)
    use_llm_eval: bool = Field(default=False)
    llm_eval_model: str = Field(default="openai/gpt-4o")


class PipelineResult(BaseModel):
    """Result from a single pipeline run for one instance."""

    question_id: str
    retrieval: RetrievalResult
    reader_output: LongMemEvalReaderOutput
    ground_truth: str


class BenchmarkPipeline:
    """
    End-to-end benchmark pipeline orchestrator.

    Stages:
    1. Load: Load dataset from disk
    2. Map: Parse and map instances to documents
    3. Index: Index documents in vector store (retriever-dependent)
    4. Retrieve: Retrieve relevant contexts for each question
    5. Read: Generate answers using LLM reader
    6. Evaluate: Compute metrics and generate reports

    Examples:
            >>> config = PipelineConfig(
            ...     dataset_path="data/longmemeval_oracle.json",
            ...     limit=10,
            ... )
            >>> retriever = ChromaRetriever(embedder)
            >>> reader = LongMemEvalReader(llm)
            >>> pipeline = BenchmarkPipeline(config, retriever, reader)
            >>> report = await pipeline.run()
            >>> print(f"Accuracy: {report.metrics.overall.accuracy:.1%}")
    """

    def __init__(
        self,
        config: PipelineConfig,
        retriever: BaseRetriever,
        reader: LongMemEvalReader,
    ) -> None:
        """
        Initialize benchmark pipeline.

        Args:
                config: Pipeline configuration
                retriever: Retriever implementation (Chroma or Engram)
                reader: LLM reader for answer generation
        """
        self.config = config
        self.retriever = retriever
        self.reader = reader
        self.mapper = DocumentMapper(granularity=config.granularity)

        # Results storage
        self.dataset: LongMemEvalDataset = []
        self.parsed_instances: list[ParsedInstance] = []
        self.results: list[PipelineResult] = []

    async def run(self) -> BenchmarkReport:
        """
        Run the full benchmark pipeline.

        Returns:
                BenchmarkReport with metrics and metadata
        """
        # Stage 1: Load dataset
        self.dataset = await self._load_dataset()

        # Stage 2: Parse and map instances
        self.parsed_instances = await self._map_instances()

        # Stage 3: Index documents (if using ChromaDB)
        await self._index_documents()

        # Stage 4-5: Retrieve and read (combined for efficiency)
        self.results = await self._retrieve_and_read()

        # Stage 6: Evaluate and generate report
        report = await self._evaluate()

        return report

    async def _load_dataset(self) -> LongMemEvalDataset:
        """Load dataset from disk."""
        dataset = load_dataset(
            self.config.dataset_path,
            limit=self.config.limit,
            validate=True,
        )
        return dataset

    async def _map_instances(self) -> list[ParsedInstance]:
        """Parse instances to normalized format."""
        # Use sync parsing (fast)
        parsed = parse_batch(self.dataset, self.mapper)
        return parsed

    async def _index_documents(self) -> None:
        """Index documents in vector store (ChromaDB only)."""
        # Check if retriever supports indexing
        if not isinstance(self.retriever, IndexableRetriever):
            return

        total = len(self.parsed_instances)
        tracker = ProgressTracker(total_instances=total)

        with tracker.start(), tracker.stage("Indexing documents", total=total) as stage_id:
            for instance in self.parsed_instances:
                # Index instance (ChromaRetriever method)
                await self.retriever.index_instance(instance)
                tracker.update(stage_id, advance=1)

    async def _retrieve_and_read(self) -> list[PipelineResult]:
        """Retrieve contexts and generate answers with concurrency control."""
        total = len(self.parsed_instances)
        tracker = ProgressTracker(total_instances=total)
        results: list[PipelineResult] = []

        # Create semaphore for concurrency control
        semaphore = asyncio.Semaphore(self.config.concurrency)

        async def process_instance(instance: ParsedInstance) -> PipelineResult:
            async with semaphore:
                # Retrieve
                retrieval = await self.retriever.retrieve(
                    instance,
                    top_k=self.config.top_k,
                )

                # Format contexts for reader
                contexts = [ctx.content for ctx in retrieval.contexts]

                # Read (generate answer)
                reader_output = await self.reader.generate_answer(
                    instance=instance,
                    contexts=contexts,
                )

                tracker.complete_instance(success=True)

                return PipelineResult(
                    question_id=instance.question_id,
                    retrieval=retrieval,
                    reader_output=reader_output,
                    ground_truth=instance.answer,
                )

        with tracker.start(), tracker.stage("Retrieving and generating answers", total=total):
            # Run all instances concurrently with semaphore
            tasks = [process_instance(instance) for instance in self.parsed_instances]
            results = await asyncio.gather(*tasks)

        return results

    async def _evaluate(self) -> BenchmarkReport:
        """Evaluate results and generate report."""
        # Extract data for evaluation
        predictions = [r.reader_output.answer for r in self.results]
        ground_truth = [r.ground_truth for r in self.results]
        question_types = [inst.memory_ability for inst in self.parsed_instances]
        question_ids = [inst.question_id for inst in self.parsed_instances]

        # Compute QA metrics
        qa_metrics = await evaluate_qa(
            predictions=predictions,
            ground_truth=ground_truth,
            question_types=question_types,
            question_ids=question_ids,
            use_llm_eval=self.config.use_llm_eval,
            llm_model=self.config.llm_eval_model,
        )

        # Compute retrieval metrics
        retrieval_results = [r.retrieval for r in self.results]
        retrieval_metrics = compute_retrieval_metrics(retrieval_results)

        # Compute abstention metrics (if applicable)
        abstention_ground_truth = [inst.is_abstention for inst in self.parsed_instances]
        abstention_predictions = [r.reader_output.is_abstention for r in self.results]

        abstention_metrics = None
        if any(abstention_ground_truth):
            abstention_metrics = compute_abstention_metrics(
                predictions=abstention_predictions,
                ground_truth=abstention_ground_truth,
            )

        # Build evaluation metrics
        metrics = EvaluationMetrics(
            overall=qa_metrics["overall"],
            by_ability=qa_metrics,
            retrieval=retrieval_metrics,
            abstention=abstention_metrics,
        )

        # Create report
        report = BenchmarkReport(
            dataset_path=self.config.dataset_path,
            total_instances=len(self.dataset),
            metrics=metrics,
            config=self.config.model_dump(),
        )

        # Save reports
        self._save_reports(report)

        return report

    def _save_reports(self, report: BenchmarkReport) -> None:
        """Save reports to output directory."""
        output_dir = Path(self.config.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate timestamp for filenames
        timestamp = report.timestamp.strftime("%Y%m%d_%H%M%S")

        # Save Markdown report
        md_path = output_dir / f"report_{timestamp}.md"
        generate_markdown_report(report, md_path)

        # Save JSON report
        json_path = output_dir / f"report_{timestamp}.json"
        generate_json_report(report, json_path)

        # Save detailed results (JSONL)
        results_path = output_dir / f"results_{timestamp}.jsonl"
        with open(results_path, "w", encoding="utf-8") as f:
            for result in self.results:
                f.write(result.model_dump_json() + "\n")


async def run_benchmark(
    config: PipelineConfig,
    retriever: BaseRetriever,
    reader: LongMemEvalReader,
) -> BenchmarkReport:
    """
    Convenience function to run a benchmark.

    Args:
            config: Pipeline configuration
            retriever: Retriever implementation
            reader: Reader implementation

    Returns:
            BenchmarkReport with results

    Example:
            >>> config = PipelineConfig(dataset_path="data/longmemeval_oracle.json")
            >>> report = await run_benchmark(config, retriever, reader)
    """
    pipeline = BenchmarkPipeline(config, retriever, reader)
    return await pipeline.run()
