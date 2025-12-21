"""
MTEB (Massive Text Embedding Benchmark) wrapper.

Provides integration with the mteb library for evaluating embedding models across
a variety of tasks including retrieval, clustering, classification, and more.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


class MTEBConfig(BaseModel):
    """Configuration for MTEB benchmark evaluation."""

    model_name: str = Field(
        description="Model identifier (HuggingFace model name or sentence-transformers model)"
    )
    tasks: list[str] = Field(
        default_factory=lambda: ["Banking77Classification"],
        description="List of MTEB task names to evaluate",
    )
    languages: list[str] = Field(
        default_factory=lambda: ["en"],
        description="Languages to evaluate (e.g., ['en', 'es', 'de'])",
    )
    output_folder: Path = Field(
        default=Path("./results/mteb"),
        description="Output directory for results",
    )
    batch_size: int = Field(
        default=32,
        ge=1,
        le=512,
        description="Batch size for encoding",
    )
    overwrite_results: bool = Field(
        default=False,
        description="Whether to overwrite existing results",
    )
    device: str = Field(
        default="cpu",
        description="Device for inference (cpu, cuda, mps, auto)",
    )
    verbosity: int = Field(
        default=2,
        ge=0,
        le=3,
        description="Verbosity level (0-3)",
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)


@dataclass
class MTEBResults:
    """Results from MTEB evaluation."""

    model_name: str
    tasks: list[str]
    scores: dict[str, dict[str, float]]
    metadata: dict[str, Any] = field(default_factory=dict)

    def get_average_score(self, metric: str = "main_score") -> float:
        """
        Calculate average score across all tasks.

        Args:
            metric: Metric to average (default: main_score)

        Returns:
            Average score
        """
        scores = []
        for task_scores in self.scores.values():
            if metric in task_scores:
                scores.append(task_scores[metric])

        return sum(scores) / len(scores) if scores else 0.0

    def to_dict(self) -> dict[str, Any]:
        """
        Convert results to dictionary.

        Returns:
            Dictionary representation
        """
        return {
            "model_name": self.model_name,
            "tasks": self.tasks,
            "scores": self.scores,
            "metadata": self.metadata,
            "average_score": self.get_average_score(),
        }


class MTEBBenchmark:
    """
    Wrapper for MTEB benchmark evaluation.

    Provides a simple interface to evaluate embedding models using MTEB.
    Supports both quick tests (single task) and full evaluation (all tasks).

    Examples:
        >>> # Quick test with single task
        >>> config = MTEBConfig(
        ...     model_name="BAAI/bge-base-en-v1.5",
        ...     tasks=["Banking77Classification"],
        ... )
        >>> benchmark = MTEBBenchmark(config)
        >>> results = benchmark.run()
        >>> print(f"Average score: {results.get_average_score():.4f}")

        >>> # Full evaluation
        >>> config = MTEBConfig(
        ...     model_name="sentence-transformers/all-MiniLM-L6-v2",
        ...     tasks=["Banking77Classification", "AmazonReviewsClassification"],
        ... )
        >>> benchmark = MTEBBenchmark(config)
        >>> results = benchmark.run()
    """

    def __init__(self, config: MTEBConfig) -> None:
        """
        Initialize MTEB benchmark.

        Args:
            config: MTEB configuration
        """
        self.config = config
        self._model: Any = None
        self._tasks: list[Any] = []

        # Ensure output directory exists
        self.config.output_folder.mkdir(parents=True, exist_ok=True)

    def _load_model(self) -> Any:
        """
        Load the embedding model using mteb.

        Returns:
            Loaded model

        Raises:
            ImportError: If mteb is not installed
        """
        try:
            import mteb
        except ImportError as e:
            raise ImportError(
                "mteb is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        logger.info(f"Loading model: {self.config.model_name}")
        model = mteb.get_model(self.config.model_name, device=self.config.device)

        return model

    def _load_tasks(self) -> list[Any]:
        """
        Load MTEB tasks.

        Returns:
            List of MTEB task objects

        Raises:
            ImportError: If mteb is not installed
        """
        try:
            import mteb
        except ImportError as e:
            raise ImportError(
                "mteb is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        logger.info(f"Loading tasks: {self.config.tasks}")
        tasks = mteb.get_tasks(tasks=self.config.tasks, languages=self.config.languages)

        return tasks

    def run(self) -> MTEBResults:
        """
        Run MTEB evaluation.

        Returns:
            MTEB evaluation results

        Raises:
            ImportError: If mteb is not installed
        """
        try:
            import mteb
        except ImportError as e:
            raise ImportError(
                "mteb is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        # Load model and tasks
        self._model = self._load_model()
        self._tasks = self._load_tasks()

        logger.info(f"Running MTEB evaluation on {len(self._tasks)} tasks")

        # Run evaluation
        evaluation = mteb.MTEB(tasks=self._tasks, task_langs=self.config.languages)
        results = evaluation.run(
            self._model,
            output_folder=str(self.config.output_folder),
            overwrite_results=self.config.overwrite_results,
            batch_size=self.config.batch_size,
            verbosity=self.config.verbosity,
        )

        # Parse results
        scores: dict[str, dict[str, float]] = {}
        for task_result in results:
            task_name = task_result.task_name
            # Extract main score and other metrics
            scores[task_name] = {
                "main_score": task_result.get_main_score(),
                **task_result.scores,
            }

        logger.info(f"MTEB evaluation complete. Results saved to {self.config.output_folder}")

        return MTEBResults(
            model_name=self.config.model_name,
            tasks=self.config.tasks,
            scores=scores,
            metadata={
                "languages": self.config.languages,
                "batch_size": self.config.batch_size,
                "device": self.config.device,
            },
        )

    @staticmethod
    def get_available_tasks(task_type: str | None = None) -> list[str]:
        """
        Get list of available MTEB tasks.

        Args:
            task_type: Optional task type filter (Retrieval, Classification, etc.)

        Returns:
            List of task names

        Raises:
            ImportError: If mteb is not installed
        """
        try:
            import mteb
        except ImportError as e:
            raise ImportError(
                "mteb is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        tasks = mteb.get_tasks()

        if task_type:
            tasks = [t for t in tasks if t.metadata.type == task_type]

        return [t.metadata.name for t in tasks]

    @staticmethod
    def get_task_types() -> list[str]:
        """
        Get list of available MTEB task types.

        Returns:
            List of task type names

        Raises:
            ImportError: If mteb is not installed
        """
        try:
            import mteb
        except ImportError as e:
            raise ImportError(
                "mteb is not installed. Install with: pip install 'engram-benchmark[mteb]'"
            ) from e

        tasks = mteb.get_tasks()
        task_types = {t.metadata.type for t in tasks}

        return sorted(task_types)
